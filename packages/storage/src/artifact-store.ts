import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type {
  DrizzleClient,
  StorageArtifact,
  StorageArtifactKind,
  StorageOwnerKind,
} from "@repo/db";
import { loadStorageConfig, type DriveConfig } from "./config.js";
import { classifyThrown, storageError, type StorageError } from "./errors.js";
import {
  ARTIFACT_FILENAMES,
  planClipForgeFolder,
  planJobFolder,
  type FolderPlan,
  type JobFolderInput,
} from "./folder-scheme.js";
import { DriveClient, type DriveClientDeps } from "./drive/client.js";
import { resumableUpload } from "./drive/resumable-upload.js";
import {
  ensureArtifactRow,
  markBudgetDeferred,
  markFailed,
  markSkipped,
  markUploaded,
  markUploading,
  recordProgress,
  getArtifactById,
  markDeletedFromDrive,
} from "./repository.js";
import { checkBudget, recordUsage } from "./daily-budget.js";
import { realRetryDeps, type BackoffOptions, type RetryDeps } from "./retry.js";

/**
 * A terminal storage event other subsystems care about (System Health card,
 * Telegram alerts). Storage is a CALLER of these — it must not know about
 * Telegram or the health page. Inject a sink; the default does nothing.
 */
export interface StorageEventSink {
  onUploadFailed?: (e: {
    jobId: string;
    kind: StorageArtifactKind;
    errorKind: string;
    message: string;
  }) => void;
  onBudgetExhausted?: (e: {
    jobId: string;
    kind: StorageArtifactKind;
    usedBytes: number;
    budgetBytes: number;
  }) => void;
}

/**
 * `putFinalArtifact` — the one entry point.
 *
 * Contract:
 *   - The VPS copy is primary and is never touched. This is a copy, not a move.
 *   - Only finished products are accepted (the `kind` union enforces it).
 *   - Idempotent: safe to call repeatedly for the same (jobId, kind).
 *   - Never silently succeeds and never silently skips. Every outcome is both
 *     returned as a discriminated union AND recorded on the artefact row.
 *   - Never throws for an expected failure.
 */

export const MIME_BY_KIND: Record<StorageArtifactKind, string> = {
  final_video: "video/mp4",
  thumbnail: "image/jpeg",
  metadata: "application/json",
  transcript: "application/json",
  subtitles: "application/x-subrip",
  raw_recording: "video/mp4",
  upload_sheet: "text/plain",
};

/** Files at or below this size go via a single multipart request. */
const SMALL_FILE_THRESHOLD_BYTES = 5 * 1024 * 1024;

/** What the transfer produced. Each tag is a single literal so it discriminates. */
interface UploadedShape {
  driveFileId: string;
  driveWebLink: string | null;
  driveFolderId: string;
  driveFolderPath: string;
  bytes: number;
  checksum: string | null;
  driveMd5: string | null;
  verified: boolean;
}

type UploadOutcome =
  | ({ outcome: "uploaded" } & UploadedShape)
  | ({ outcome: "already_uploaded" } & UploadedShape)
  | { outcome: "skipped"; reason: string }
  | {
      outcome: "deferred";
      reason: string;
      usedBytes: number;
      budgetBytes: number;
    }
  | { outcome: "failed"; error: StorageError };

export interface PutFinalArtifactArgs {
  jobId: string;
  channelId: string | null;
  channelName: string | null;
  title: string | null;
  /** When the job actually finished; drives the YYYY-MM folder. */
  completedAt: Date;
  kind: StorageArtifactKind;
  /** Absolute path of the finished file on the VPS. */
  localPath: string;
  /** Override the conventional filename. Rarely needed. */
  filename?: string;
  /** Skip the sha256 pass (it reads the whole file). Default: computed. */
  computeChecksum?: boolean;
  /** Which owner table job_id points at. Default content_job. */
  ownerKind?: StorageOwnerKind;
  /** ISO-639-1 language; null/"en" = English original at the leaf root. */
  language?: string | null;
  /** Parent (English) job id when this is a translated variant. */
  sourceJobId?: string | null;
  /** Original title for a variant's leaf folder name. */
  sourceTitle?: string | null;
  /**
   * `content_jobs.format`. Routes the artefact to a per-format Drive root when
   * one is configured (TECH_COMPARISON -> `_Comparisons/`); otherwise the
   * content root. Ignored when `folderPlan` is supplied.
   */
  format?: string | null;
  /**
   * Pre-computed folder plan. When supplied (tutorials, Clip Forge) it wins
   * over the default content-job plan. Lets those subsystems place artefacts
   * in their own trees without this module knowing their layout.
   */
  folderPlan?: FolderPlan;
  /** Override the content root folder name (rarely needed directly). */
  rootFolderName?: string;
}

export type PutFinalArtifactResult =
  | {
      outcome: "uploaded";
      artifactId: string;
      driveFileId: string;
      driveWebLink: string | null;
      driveFolderPath: string;
      bytes: number;
      checksum: string | null;
    }
  | {
      outcome: "already_uploaded";
      artifactId: string;
      driveFileId: string;
      driveWebLink: string | null;
      driveFolderPath: string | null;
    }
  | { outcome: "disabled"; reason: string }
  | { outcome: "skipped"; artifactId: string; reason: string }
  | {
      outcome: "deferred";
      artifactId: string;
      reason: string;
      usedBytes: number;
      budgetBytes: number;
    }
  | { outcome: "failed"; artifactId: string; error: StorageError };

export interface ArtifactStoreDeps extends DriveClientDeps {
  retryDeps?: RetryDeps;
  /** Injected for tests; production builds one from env. */
  driveClient?: DriveClient;
  config?: DriveConfig;
  /** Terminal-event sink (Telegram / health). Default: no-op. */
  eventSink?: StorageEventSink;
  logger?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

function hashFile(path: string, algorithm: "sha256" | "md5"): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

const sha256File = (path: string): Promise<string> => hashFile(path, "sha256");
const md5File = (path: string): Promise<string> => hashFile(path, "md5");

function backoffFrom(config: DriveConfig): BackoffOptions {
  return {
    baseDelayMs: 1_000,
    maxDelayMs: 60_000,
    maxAttempts: config.maxAttempts,
    jitter: 1,
  };
}

export class ArtifactStore {
  private readonly client: DriveClient;
  private readonly config: DriveConfig;
  private readonly retryDeps: RetryDeps;
  private readonly events: StorageEventSink;
  private readonly logger: NonNullable<ArtifactStoreDeps["logger"]>;

  private constructor(
    private readonly db: DrizzleClient,
    config: DriveConfig,
    deps: ArtifactStoreDeps,
  ) {
    this.config = config;
    this.client = deps.driveClient ?? new DriveClient(config, deps);
    this.retryDeps = deps.retryDeps ?? realRetryDeps;
    this.events = deps.eventSink ?? {};
    this.logger = deps.logger ?? {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };
  }

  /** The Drive client, for callers that need a raw probe (e.g. health). */
  get drive(): DriveClient {
    return this.client;
  }

  get driveConfig(): DriveConfig {
    return this.config;
  }

  /**
   * Build a store, or explain why storage is unavailable. Returning a reason
   * rather than throwing is what keeps an unconfigured Drive from taking down
   * a worker at boot.
   */
  static create(
    db: DrizzleClient,
    deps: ArtifactStoreDeps = {},
  ): { ok: true; store: ArtifactStore } | { ok: false; reason: string } {
    if (deps.config !== undefined) {
      return { ok: true, store: new ArtifactStore(db, deps.config, deps) };
    }
    const configured = loadStorageConfig();
    if (!configured.enabled) return { ok: false, reason: configured.reason };
    return { ok: true, store: new ArtifactStore(db, configured.drive, deps) };
  }

  async putFinalArtifact(
    args: PutFinalArtifactArgs,
  ): Promise<PutFinalArtifactResult> {
    const filename = args.filename ?? ARTIFACT_FILENAMES[args.kind];

    const row = await ensureArtifactRow(this.db, {
      job_id: args.jobId,
      kind: args.kind,
      filename,
      vps_path: args.localPath,
      channel_id: args.channelId,
      owner_kind: args.ownerKind ?? "content_job",
      language: args.language ?? null,
      source_job_id: args.sourceJobId ?? null,
    });

    // Fast path: we already did this. Trust the row, but only when it actually
    // carries a Drive file id — a row that says "uploaded" with no id is a bug
    // we would rather re-upload than paper over.
    if (row.state === "uploaded" && row.drive_file_id !== null) {
      return {
        outcome: "already_uploaded",
        artifactId: row.id,
        driveFileId: row.drive_file_id,
        driveWebLink: row.drive_web_link,
        driveFolderPath: row.drive_folder_path,
      };
    }

    await markUploading(this.db, row.id);

    const result = await this.upload(args, row, filename);

    if (result.outcome === "uploaded") {
      // Count the bytes against today's budget only for a genuinely new upload.
      await recordUsage(this.db, result.bytes);
      await markUploaded(this.db, row.id, {
        drive_file_id: result.driveFileId,
        drive_web_link: result.driveWebLink,
        drive_folder_id: result.driveFolderId,
        drive_folder_path: result.driveFolderPath,
        bytes: result.bytes,
        checksum_sha256: result.checksum,
        drive_md5: result.driveMd5,
        verified: result.verified,
      });
      this.logger.info("storage: artefact uploaded to Drive", {
        job_id: args.jobId,
        kind: args.kind,
        drive_file_id: result.driveFileId,
        bytes: result.bytes,
        verified: result.verified,
      });
      return {
        outcome: "uploaded",
        artifactId: row.id,
        driveFileId: result.driveFileId,
        driveWebLink: result.driveWebLink,
        driveFolderPath: result.driveFolderPath,
        bytes: result.bytes,
        checksum: result.checksum,
      };
    }

    if (result.outcome === "already_uploaded") {
      await markUploaded(this.db, row.id, {
        drive_file_id: result.driveFileId,
        drive_web_link: result.driveWebLink,
        drive_folder_id: result.driveFolderId,
        drive_folder_path: result.driveFolderPath,
        bytes: result.bytes,
        checksum_sha256: result.checksum,
        drive_md5: result.driveMd5,
        verified: result.verified,
      });
      return {
        outcome: "already_uploaded",
        artifactId: row.id,
        driveFileId: result.driveFileId,
        driveWebLink: result.driveWebLink,
        driveFolderPath: result.driveFolderPath,
      };
    }

    if (result.outcome === "skipped") {
      await markSkipped(this.db, row.id, result.reason);
      this.logger.warn("storage: artefact skipped", {
        job_id: args.jobId,
        kind: args.kind,
        reason: result.reason,
      });
      return { outcome: "skipped", artifactId: row.id, reason: result.reason };
    }

    if (result.outcome === "deferred") {
      await markBudgetDeferred(this.db, row.id, result.reason);
      this.events.onBudgetExhausted?.({
        jobId: args.jobId,
        kind: args.kind,
        usedBytes: result.usedBytes,
        budgetBytes: result.budgetBytes,
      });
      this.logger.warn("storage: upload deferred, daily byte budget spent", {
        job_id: args.jobId,
        kind: args.kind,
        used_bytes: result.usedBytes,
        budget_bytes: result.budgetBytes,
      });
      return {
        outcome: "deferred",
        artifactId: row.id,
        reason: result.reason,
        usedBytes: result.usedBytes,
        budgetBytes: result.budgetBytes,
      };
    }

    // Failure. The VPS copy is untouched and still authoritative; the failure
    // is recorded on the row so the Jobs UI and a retry can both see it.
    await markFailed(this.db, row.id, {
      kind: result.error.kind,
      message: result.error.message,
    });
    this.events.onUploadFailed?.({
      jobId: args.jobId,
      kind: args.kind,
      errorKind: result.error.kind,
      message: result.error.message,
    });
    this.logger.error("storage: Drive upload failed", {
      job_id: args.jobId,
      kind: args.kind,
      error_kind: result.error.kind,
      error: result.error.message,
    });
    return { outcome: "failed", artifactId: row.id, error: result.error };
  }

  /**
   * Clip Forge seam (GD-17). Clip Forge owns its own distribution logic; this
   * is just the library surface it calls to put a finished clip into the
   * WHOLLY SEPARATE `Clip Forge/` Drive root (never nested in Content Forge).
   *
   * The caller supplies the clip id, a slug, and an owner (channel/creator)
   * name; the folder tree, idempotency, budget, retry, and checksum machinery
   * are all shared with the content path.
   */
  async putClipForgeArtifact(args: {
    clipId: string;
    slug: string | null;
    ownerName: string | null;
    completedAt: Date;
    localPath: string;
    /** Defaults to final_video (a rendered clip). */
    kind?: StorageArtifactKind;
    filename?: string;
  }): Promise<PutFinalArtifactResult> {
    const plan = planClipForgeFolder({
      clipId: args.clipId,
      slug: args.slug,
      ownerName: args.ownerName,
      completedAt: args.completedAt,
      rootFolderName: this.config.clipForgeRootFolderName,
    });
    return this.putFinalArtifact({
      jobId: args.clipId,
      channelId: null,
      channelName: args.ownerName,
      title: args.slug,
      completedAt: args.completedAt,
      kind: args.kind ?? "final_video",
      localPath: args.localPath,
      ownerKind: "clip_variant",
      folderPlan: plan,
      ...(args.filename !== undefined ? { filename: args.filename } : {}),
    });
  }

  /** The actual transfer. Split out so the DB bookkeeping above stays legible. */
  private async upload(
    args: PutFinalArtifactArgs,
    row: StorageArtifact,
    filename: string,
  ): Promise<UploadOutcome> {
    const stat = await DriveClient.statLocal(args.localPath);
    if (!stat.ok) {
      // A missing local file is a *skip*, not a failure to retry forever: the
      // artefact simply is not there. Recorded, never silent.
      if (stat.error.kind === "local_file") {
        return {
          outcome: "skipped",
          reason: `local file unavailable: ${stat.error.message}`,
        };
      }
      return { outcome: "failed", error: stat.error };
    }
    const bytes = stat.value;

    if (bytes === 0) {
      return { outcome: "skipped", reason: "local file is 0 bytes" };
    }
    if (bytes > this.config.maxFileBytes) {
      return {
        outcome: "skipped",
        reason: `file is ${bytes} bytes, above STORAGE_DRIVE_MAX_FILE_BYTES (${this.config.maxFileBytes})`,
      };
    }

    // Tutorials / Clip Forge supply a pre-computed plan for their own trees;
    // content jobs fall back to the default plan (with language variants).
    let plan: FolderPlan;
    if (args.folderPlan !== undefined) {
      plan = args.folderPlan;
    } else {
      const folderInput: JobFolderInput = {
        jobId: args.jobId,
        title: args.title,
        channelName: args.channelName,
        completedAt: args.completedAt,
        rootFolderName: args.rootFolderName ?? this.config.rootFolderName,
        languageCode: args.language ?? null,
        sourceJobId: args.sourceJobId ?? null,
        sourceTitle: args.sourceTitle ?? null,
        format: args.format ?? null,
        formatRootFolderNames: this.config.formatRootFolderNames,
      };
      plan = planJobFolder(folderInput);
    }

    // Idempotency check #2 (after the DB row): ask Drive whether it already
    // holds a file tagged with this job+kind. This survives a lost DB row.
    const existing = await this.client.findExistingArtifact(
      args.jobId,
      args.kind,
    );
    if (!existing.ok) return { outcome: "failed", error: existing.error };

    const folder = await this.client.ensureFolderPath(plan.segments);
    if (!folder.ok) return { outcome: "failed", error: folder.error };

    if (existing.value !== null) {
      const remoteSize =
        existing.value.size !== undefined ? Number(existing.value.size) : null;
      // Same size => same file, as far as we can cheaply tell. A re-render
      // that changed the video will differ in size and fall through to a
      // re-upload below.
      if (remoteSize === bytes) {
        return {
          outcome: "already_uploaded",
          driveFileId: existing.value.id,
          driveWebLink: existing.value.webViewLink ?? null,
          driveFolderId: folder.value,
          driveFolderPath: plan.path,
          bytes,
          checksum: row.checksum_sha256,
          driveMd5: existing.value.md5Checksum ?? row.drive_md5 ?? null,
          verified: row.verified_at !== null,
        };
      }
      this.logger.warn(
        "storage: Drive already holds a differently-sized copy; uploading a new revision",
        {
          job_id: args.jobId,
          kind: args.kind,
          remote_bytes: remoteSize,
          local_bytes: bytes,
        },
      );
    }

    // Daily byte budget: if pushing this file would blow today's shared budget,
    // park it (visible pause with a reason) rather than uploading. A brand-new
    // day drains the parked rows again.
    const budget = await checkBudget(
      this.db,
      bytes,
      this.config.dailyByteBudget,
    );
    if (!budget.allowed) {
      return {
        outcome: "deferred",
        reason:
          `daily byte budget spent: ${budget.usedBytes} of ` +
          `${budget.budgetBytes} bytes used, this file is ${bytes} bytes`,
        usedBytes: budget.usedBytes,
        budgetBytes: budget.budgetBytes,
      };
    }

    let checksum: string | null = null;
    if (args.computeChecksum !== false) {
      try {
        checksum = await sha256File(args.localPath);
      } catch (err) {
        return { outcome: "failed", error: classifyThrown(err) };
      }
    }

    const mimeType = MIME_BY_KIND[args.kind];

    if (bytes <= SMALL_FILE_THRESHOLD_BYTES) {
      const content = await this.readSmall(args.localPath);
      if (!content.ok) return { outcome: "failed", error: content.error };

      const uploaded =
        existing.value !== null
          ? await this.client.updateSmallFile({
              fileId: existing.value.id,
              mimeType,
              content: content.value,
            })
          : await this.client.uploadSmallFile({
              filename,
              parentId: folder.value,
              mimeType,
              content: content.value,
              jobId: args.jobId,
              kind: args.kind,
            });
      if (!uploaded.ok) return { outcome: "failed", error: uploaded.error };
      const verified = await this.verifyMd5(
        args.localPath,
        uploaded.value.id,
        uploaded.value.md5Checksum,
      );
      if (!verified.ok) return { outcome: "failed", error: verified.error };
      return {
        outcome: "uploaded",
        driveFileId: uploaded.value.id,
        driveWebLink: uploaded.value.webViewLink ?? null,
        driveFolderId: folder.value,
        driveFolderPath: plan.path,
        bytes,
        checksum,
        driveMd5: uploaded.value.md5Checksum ?? null,
        verified: verified.value,
      };
    }

    const uploaded = await resumableUpload(
      this.client,
      {
        localPath: args.localPath,
        totalBytes: bytes,
        sessionUri: row.resumable_session_uri ?? undefined,
        filename,
        parentId: folder.value,
        mimeType,
        jobId: args.jobId,
        kind: args.kind,
        chunkSizeBytes: this.config.chunkSizeBytes,
        onProgress: async (info) => {
          await recordProgress(this.db, row.id, {
            resumable_session_uri: info.sessionUri,
            bytes_uploaded: info.bytesUploaded,
          });
        },
      },
      backoffFrom(this.config),
      this.retryDeps,
    );
    if (!uploaded.ok) return { outcome: "failed", error: uploaded.error };

    // Trust but verify: Drive reports the stored size back to us.
    const remoteSize =
      uploaded.value.size !== undefined ? Number(uploaded.value.size) : null;
    if (remoteSize !== null && remoteSize !== bytes) {
      return {
        outcome: "failed",
        error: storageError(
          "unknown",
          `size mismatch after upload: local ${bytes} bytes, Drive reports ${remoteSize}`,
        ),
      };
    }

    const verified = await this.verifyMd5(
      args.localPath,
      uploaded.value.id,
      uploaded.value.md5Checksum,
    );
    if (!verified.ok) return { outcome: "failed", error: verified.error };

    return {
      outcome: "uploaded",
      driveFileId: uploaded.value.id,
      driveWebLink: uploaded.value.webViewLink ?? null,
      driveFolderId: folder.value,
      driveFolderPath: plan.path,
      bytes,
      checksum,
      driveMd5: uploaded.value.md5Checksum ?? null,
      verified: verified.value,
    };
  }

  /**
   * Delete an artefact's Drive copy and mark the row as no longer in Drive.
   *
   * The ONLY deliberate deletion path in this package. It exists for one
   * caller: the VA's end-of-day review, where "disapprove" means the video must
   * not remain somewhere a person could publish it from.
   *
   * Returns false rather than throwing, and only after the Drive call itself
   * failed — the caller must be able to stop and leave its own state untouched.
   * A job recorded as disapproved whose video is still sitting in Drive is
   * worse than a loud failure, because the entire meaning of the verdict is
   * that the video is gone.
   *
   * An artefact with no `drive_file_id` is already not in Drive, which is
   * success: there is nothing to delete and nothing to report.
   */
  async deleteArtifactFromDrive(artifactId: string): Promise<boolean> {
    const row = await getArtifactById(this.db, artifactId);
    if (!row) return false;
    if (!row.drive_file_id) return true;

    const deleted = await this.client.deleteFile(row.drive_file_id);
    if (!deleted.ok) return false;

    await markDeletedFromDrive(
      this.db,
      artifactId,
      "deleted from Drive by VA review (disapproved)",
    );
    return true;
  }

  /**
   * Compare Drive's reported MD5 with a locally computed one. A mismatch means
   * the stored bytes are corrupt: delete the Drive copy and fail (never leave a
   * bad file behind pretending to be the artefact). When Drive returns no MD5
   * (rare, some content types) verification is skipped, not faked — returns
   * `verified: false`.
   */
  private async verifyMd5(
    localPath: string,
    driveFileId: string,
    driveMd5: string | undefined,
  ): Promise<
    { ok: true; value: boolean } | { ok: false; error: StorageError }
  > {
    if (driveMd5 === undefined || driveMd5 === "") {
      return { ok: true, value: false };
    }
    let localMd5: string;
    try {
      localMd5 = await md5File(localPath);
    } catch (err) {
      return { ok: false, error: classifyThrown(err) };
    }
    if (localMd5.toLowerCase() !== driveMd5.toLowerCase()) {
      await this.client.deleteFile(driveFileId);
      return {
        ok: false,
        error: storageError(
          "unknown",
          `checksum mismatch after upload: local MD5 ${localMd5}, Drive ${driveMd5}. Deleted the corrupt Drive copy.`,
        ),
      };
    }
    return { ok: true, value: true };
  }

  private async readSmall(
    path: string,
  ): Promise<{ ok: true; value: Buffer } | { ok: false; error: StorageError }> {
    try {
      const { readFile } = await import("node:fs/promises");
      return { ok: true, value: await readFile(path) };
    } catch (err) {
      return { ok: false, error: classifyThrown(err) };
    }
  }
}
