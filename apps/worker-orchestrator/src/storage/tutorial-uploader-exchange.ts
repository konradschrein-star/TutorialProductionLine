import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import {
  TUTORIAL_UPLOADER_JOB_VERSION,
  TutorialUploaderAttributesSchema,
  TutorialUploaderJobSchema,
  TutorialUploaderReceiptSchema,
  canonicalTutorialUploaderJob,
  tutorialUploaderReceiptFileName,
  type TutorialUploaderAsset,
  type TutorialUploaderJob,
  type TutorialUploaderReceipt,
} from "@repo/contracts";
import {
  and,
  asc,
  eq,
  isNotNull,
  isNull,
  or,
  tutorialJobs,
  tutorialUploadDispatches,
  tutorialUploadReceipts,
  type DrizzleClient,
} from "@repo/db";
import {
  DRIVE_FOLDER_MIME,
  resumableUpload,
  type Attempt,
  type DriveClient,
  type DriveFile,
  type StorageError,
} from "@repo/storage";

const MANIFEST_FILE_NAME = "job.json";
const MANIFEST_MEDIA_TYPE = "application/json";
const MAX_JSON_BYTES = 1024 * 1024;
const DEFAULT_BATCH_SIZE = 10;
const TERMINAL_RECEIPT_STATES = new Set([
  "succeeded",
  "failed",
  "uncertain",
  "rejected",
]);

export interface TutorialUploaderExchangeOptions {
  inboxFolderId: string;
  receiptFolderId: string;
  batchSize: number;
  maxJobBytes: number;
}

export type TutorialUploaderExchangeConfigResult =
  | { enabled: true; options: TutorialUploaderExchangeOptions }
  | { enabled: false; reason: string };

export interface PublishCandidate {
  dispatchId: string;
  tutorialJobId: string;
  exchangeJobId: string;
  revision: number;
  idempotencyKey: string;
  channelKey: string;
  requestedAt: Date;
  attributes: Record<string, unknown>;
  manifestSha256: string | null;
  manifest: Record<string, unknown> | null;
  videoPath: string;
  thumbnailId: string;
  thumbnailPath: string;
}

export interface ReceiptCandidate {
  dispatchId: string;
  tutorialJobId: string;
  exchangeJobId: string;
  revision: number;
  idempotencyKey: string;
  manifestSha256: string;
  latestSequence: number;
  attributes: Record<string, unknown>;
}

type TutorialJobReceiptProjection = Partial<typeof tutorialJobs.$inferInsert>;

/**
 * Project the immutable exchange journal onto the Tutorial Studio job row.
 *
 * The dispatch/receipt tables remain the source of truth. This compatibility
 * projection keeps the existing Studio upload views honest without weakening
 * the terminal proof gate: only a `succeeded` receipt may mark an upload as
 * verified, and its visibility must come from the frozen dispatch attributes.
 */
export function tutorialJobProjectionForReceipt(
  candidate: ReceiptCandidate,
  receipt: TutorialUploaderReceipt,
): TutorialJobReceiptProjection {
  const happenedAt = new Date(receipt.occurred_at);
  const common: TutorialJobReceiptProjection = {
    uploader_job_id: candidate.exchangeJobId,
    uploader_event_id: `${receipt.job_id}:r${receipt.revision}:s${receipt.sequence}`,
    uploader_last_callback_at: happenedAt,
    updated_at: happenedAt,
  };

  if (receipt.state === "succeeded" && receipt.result !== null) {
    const visibility = candidate.attributes["visibility"];
    if (visibility !== "private" && visibility !== "unlisted") {
      throw new TutorialUploaderExchangeError(
        "receipt_candidate_attributes_invalid",
        "succeeded receipt has no valid frozen visibility",
      );
    }
    return {
      ...common,
      uploader_status: "uploaded",
      youtube_visibility: visibility,
      scheduled_for: null,
      is_uploaded: true,
      uploaded_at: happenedAt,
      youtube_published_at: null,
      uploaded_by: "tutorial-uploader",
      youtube_upload_url: receipt.result.video_url,
      upload_verified_at: happenedAt,
    };
  }

  if (TERMINAL_RECEIPT_STATES.has(receipt.state)) {
    return { ...common, uploader_status: "failed" };
  }

  return {
    ...common,
    uploader_status:
      receipt.state === "active" || receipt.state === "applied_reported"
        ? "uploading"
        : "waiting_to_be_uploaded",
  };
}

export interface PublishRecord {
  dispatchId: string;
  manifest: TutorialUploaderJob;
  manifestSha256: string;
  driveFolderId: string;
}

export interface PublishFailure {
  dispatchId: string;
  code: string;
  message: string;
  retryable: boolean;
}

export type ReceiptRecordResult = "inserted" | "duplicate";

export interface TutorialUploaderExchangeRepository {
  listPublishCandidates(limit: number): Promise<PublishCandidate[]>;
  markPublishing(record: Omit<PublishRecord, "driveFolderId">): Promise<void>;
  markPublished(record: PublishRecord): Promise<void>;
  markPublishFailed(failure: PublishFailure): Promise<void>;
  listReceiptCandidates(limit: number): Promise<ReceiptCandidate[]>;
  recordReceipt(
    candidate: ReceiptCandidate,
    receipt: TutorialUploaderReceipt,
    receiptSha256: string,
  ): Promise<ReceiptRecordResult>;
}

export interface LocalAssetInspection {
  path: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  mediaType: string;
}

export interface TutorialUploaderDrivePort {
  listChildren(folderId: string): Promise<Attempt<DriveFile[]>>;
  createFolder(name: string, parentId: string | null): Promise<Attempt<string>>;
  downloadBytes(
    fileId: string,
    maxBytes: number,
  ): Promise<Attempt<{ content: Buffer; sizeBytes: number; sha256: string }>>;
  inspectContent(
    fileId: string,
    maxBytes: number,
  ): Promise<Attempt<{ sizeBytes: number; sha256: string }>>;
  putLocalFile(args: {
    folderId: string;
    sourcePath: string;
    asset: TutorialUploaderAsset;
    exchangeJobId: string;
    revision: number;
  }): Promise<Attempt<DriveFile>>;
  putBytes(args: {
    folderId: string;
    fileName: string;
    mediaType: string;
    content: Buffer;
    exchangeJobId: string;
    kind: string;
  }): Promise<Attempt<DriveFile>>;
}

export interface TutorialUploaderExchangeDeps {
  inspectLocalAsset?: (
    path: string,
    role: TutorialUploaderAsset["role"],
    maxBytes: number,
  ) => Promise<LocalAssetInspection>;
}

export interface TutorialUploaderExchangeTotals {
  publishAttempted: number;
  published: number;
  publishFailed: number;
  receiptsInserted: number;
  receiptDuplicates: number;
  receiptFailed: number;
}

export class TutorialUploaderExchangeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "TutorialUploaderExchangeError";
  }
}

function envText(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function envPositiveInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const value = Number(env[key]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/**
 * The folder ids intentionally use the uploader's existing environment names.
 * Both products point at the same app-owned exchange without importing one
 * another or sharing credentials through the database.
 */
export function tutorialUploaderExchangeOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TutorialUploaderExchangeConfigResult {
  const inboxFolderId = envText(env, "TUTORIAL_EXCHANGE_DRIVE_INBOX_ID");
  const receiptFolderId = envText(
    env,
    "TUTORIAL_EXCHANGE_DRIVE_RECEIPT_FOLDER_ID",
  );
  if (inboxFolderId === undefined || receiptFolderId === undefined) {
    const missing = [
      inboxFolderId === undefined ? "TUTORIAL_EXCHANGE_DRIVE_INBOX_ID" : null,
      receiptFolderId === undefined
        ? "TUTORIAL_EXCHANGE_DRIVE_RECEIPT_FOLDER_ID"
        : null,
    ].filter((value): value is string => value !== null);
    return {
      enabled: false,
      reason: `tutorial uploader Drive exchange is missing ${missing.join(", ")}`,
    };
  }
  return {
    enabled: true,
    options: {
      inboxFolderId,
      receiptFolderId,
      batchSize: envPositiveInt(
        env,
        "TUTORIAL_EXCHANGE_BATCH_SIZE",
        DEFAULT_BATCH_SIZE,
      ),
      maxJobBytes: envPositiveInt(
        env,
        "TUTORIAL_EXCHANGE_MAX_JOB_BYTES",
        32 * 1024 * 1024 * 1024,
      ),
    },
  };
}

function wholeSecondUtc(date: Date): string {
  return new Date(Math.floor(date.getTime() / 1_000) * 1_000)
    .toISOString()
    .replace(".000Z", "Z");
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function mediaTypeFor(
  path: string,
  role: TutorialUploaderAsset["role"],
): string {
  const extension = extname(path).toLowerCase();
  if (role === "video") {
    const videoTypes: Readonly<Record<string, string>> = {
      ".mp4": "video/mp4",
      ".mov": "video/quicktime",
      ".webm": "video/webm",
    };
    const match = videoTypes[extension];
    if (match !== undefined) return match;
  } else {
    const imageTypes: Readonly<Record<string, string>> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
    };
    const match = imageTypes[extension];
    if (match !== undefined) return match;
  }
  throw new TutorialUploaderExchangeError(
    `unsupported_${role}_type`,
    `${role} source has unsupported extension ${extension || "(none)"}`,
  );
}

export async function inspectTutorialUploaderLocalAsset(
  path: string,
  role: TutorialUploaderAsset["role"],
  maxBytes: number,
): Promise<LocalAssetInspection> {
  let details: Awaited<ReturnType<typeof stat>>;
  try {
    details = await stat(path);
  } catch (error) {
    throw new TutorialUploaderExchangeError(
      `source_${role}_unavailable`,
      `${role} source is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!details.isFile() || details.size <= 0 || details.size > maxBytes) {
    throw new TutorialUploaderExchangeError(
      `source_${role}_invalid`,
      `${role} source must be a non-empty regular file no larger than ${maxBytes} bytes`,
    );
  }

  const digest = createHash("sha256");
  try {
    for await (const chunk of createReadStream(path)) {
      digest.update(chunk as Buffer);
    }
  } catch (error) {
    throw new TutorialUploaderExchangeError(
      `source_${role}_unreadable`,
      `${role} source could not be hashed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    path,
    fileName: basename(path),
    sizeBytes: details.size,
    sha256: digest.digest("hex"),
    mediaType: mediaTypeFor(path, role),
  };
}

function attemptValue<T>(attempt: Attempt<T>, operation: string): T {
  if (attempt.ok) return attempt.value;
  throw driveFailure(operation, attempt.error);
}

function driveFailure(
  operation: string,
  error: StorageError,
): TutorialUploaderExchangeError {
  const retryable = ["rate_limited", "server", "network"].includes(error.kind);
  return new TutorialUploaderExchangeError(
    `drive_${error.kind}`,
    `${operation} failed: ${error.message}`,
    retryable,
  );
}

function oneNamed(children: DriveFile[], name: string): DriveFile | null {
  const matches = children.filter(
    (child) => child.trashed !== true && child.name === name,
  );
  if (matches.length > 1) {
    throw new TutorialUploaderExchangeError(
      "drive_duplicate_name",
      `Drive contains duplicate children named ${name}`,
    );
  }
  return matches[0] ?? null;
}

async function ensureUniqueJobFolder(
  drive: TutorialUploaderDrivePort,
  inboxFolderId: string,
  name: string,
): Promise<string> {
  let children = attemptValue(
    await drive.listChildren(inboxFolderId),
    "Drive inbox listing",
  );
  const existing = oneNamed(children, name);
  if (existing !== null) {
    if (existing.mimeType !== DRIVE_FOLDER_MIME) {
      throw new TutorialUploaderExchangeError(
        "drive_job_folder_conflict",
        "Drive job folder name belongs to a non-folder object",
      );
    }
    return existing.id;
  }

  const createdId = attemptValue(
    await drive.createFolder(name, inboxFolderId),
    "Drive job folder creation",
  );
  children = attemptValue(
    await drive.listChildren(inboxFolderId),
    "Drive inbox verification",
  );
  const created = oneNamed(children, name);
  if (
    created === null ||
    created.id !== createdId ||
    created.mimeType !== DRIVE_FOLDER_MIME
  ) {
    throw new TutorialUploaderExchangeError(
      "drive_job_folder_ambiguous",
      "Drive job folder creation could not be verified uniquely",
    );
  }
  return createdId;
}

async function verifyRemoteAsset(
  drive: TutorialUploaderDrivePort,
  file: DriveFile,
  asset: TutorialUploaderAsset,
): Promise<void> {
  if (file.mimeType === DRIVE_FOLDER_MIME) {
    throw new TutorialUploaderExchangeError(
      "drive_asset_type_conflict",
      `Drive asset ${asset.file_name} is a folder`,
    );
  }
  const remoteSize = file.size === undefined ? null : Number(file.size);
  if (!Number.isSafeInteger(remoteSize) || remoteSize !== asset.size_bytes) {
    throw new TutorialUploaderExchangeError(
      "drive_asset_size_mismatch",
      `Drive asset ${asset.file_name} has different bytes than its manifest`,
    );
  }
  if (file.sha256Checksum !== undefined) {
    if (file.sha256Checksum !== asset.sha256) {
      throw new TutorialUploaderExchangeError(
        "drive_asset_digest_mismatch",
        `Drive asset ${asset.file_name} has a different SHA-256`,
      );
    }
    return;
  }
  const inspected = attemptValue(
    await drive.inspectContent(file.id, asset.size_bytes),
    `Drive asset ${asset.file_name} verification`,
  );
  if (
    inspected.sizeBytes !== asset.size_bytes ||
    inspected.sha256 !== asset.sha256
  ) {
    throw new TutorialUploaderExchangeError(
      "drive_asset_digest_mismatch",
      `Drive asset ${asset.file_name} has different content than its manifest`,
    );
  }
}

async function verifyManifestMarker(
  drive: TutorialUploaderDrivePort,
  marker: DriveFile,
  canonicalBytes: Buffer,
): Promise<void> {
  if (
    marker.size !== undefined &&
    Number(marker.size) !== canonicalBytes.byteLength
  ) {
    throw new TutorialUploaderExchangeError(
      "drive_manifest_conflict",
      "Drive job.json exists with a different size",
    );
  }
  const downloaded = attemptValue(
    await drive.downloadBytes(marker.id, MAX_JSON_BYTES),
    "Drive job.json verification",
  );
  if (!downloaded.content.equals(canonicalBytes)) {
    throw new TutorialUploaderExchangeError(
      "drive_manifest_conflict",
      "Drive job.json exists with different immutable bytes",
    );
  }
}

function buildManifest(
  candidate: PublishCandidate,
  video: LocalAssetInspection,
  thumbnail: LocalAssetInspection,
): {
  manifest: TutorialUploaderJob;
  canonicalBytes: Buffer;
  manifestSha256: string;
} {
  const attributes = TutorialUploaderAttributesSchema.parse(
    candidate.attributes,
  );
  const manifest = TutorialUploaderJobSchema.parse({
    version: TUTORIAL_UPLOADER_JOB_VERSION,
    job_id: candidate.exchangeJobId,
    revision: candidate.revision,
    idempotency_key: candidate.idempotencyKey,
    created_at: wholeSecondUtc(candidate.requestedAt),
    operation: "upload",
    channel_id: candidate.channelKey,
    target_video_id: null,
    assets: [
      {
        key: "video",
        role: "video",
        file_name: video.fileName,
        size_bytes: video.sizeBytes,
        sha256: video.sha256,
        media_type: video.mediaType,
      },
      {
        key: "thumbnail",
        role: "thumbnail",
        file_name: thumbnail.fileName,
        size_bytes: thumbnail.sizeBytes,
        sha256: thumbnail.sha256,
        media_type: thumbnail.mediaType,
      },
    ],
    attributes,
  });
  if (manifest.assets.some((asset) => asset.file_name === MANIFEST_FILE_NAME)) {
    throw new TutorialUploaderExchangeError(
      "reserved_asset_name",
      `${MANIFEST_FILE_NAME} is reserved for the manifest marker`,
    );
  }
  const canonicalBytes = Buffer.from(canonicalTutorialUploaderJob(manifest));
  if (canonicalBytes.byteLength > MAX_JSON_BYTES) {
    throw new TutorialUploaderExchangeError(
      "manifest_too_large",
      "canonical job.json exceeds 1 MiB",
    );
  }
  return {
    manifest,
    canonicalBytes,
    manifestSha256: sha256(canonicalBytes),
  };
}

export async function publishTutorialUploaderCandidate(
  repository: TutorialUploaderExchangeRepository,
  drive: TutorialUploaderDrivePort,
  options: TutorialUploaderExchangeOptions,
  candidate: PublishCandidate,
  deps: TutorialUploaderExchangeDeps = {},
): Promise<void> {
  const inspectLocalAsset =
    deps.inspectLocalAsset ?? inspectTutorialUploaderLocalAsset;
  if (candidate.videoPath.trim() === "") {
    throw new TutorialUploaderExchangeError(
      "source_video_missing",
      "tutorial has no completed final video path",
    );
  }
  if (candidate.thumbnailPath.trim() === "") {
    throw new TutorialUploaderExchangeError(
      "selected_thumbnail_missing",
      "dispatch has no selected completed thumbnail snapshot",
    );
  }

  // Inspect BOTH sources before the first Drive mutation. A bad thumbnail must
  // not leave a multi-GB orphaned video in an incomplete job folder.
  const [video, thumbnail] = await Promise.all([
    inspectLocalAsset(candidate.videoPath, "video", options.maxJobBytes),
    inspectLocalAsset(
      candidate.thumbnailPath,
      "thumbnail",
      options.maxJobBytes,
    ),
  ]);
  if (video.sizeBytes + thumbnail.sizeBytes > options.maxJobBytes) {
    throw new TutorialUploaderExchangeError(
      "source_assets_too_large",
      `video and thumbnail exceed the ${options.maxJobBytes} byte job limit`,
    );
  }
  const built = buildManifest(candidate, video, thumbnail);
  if (
    candidate.manifestSha256 !== null &&
    candidate.manifestSha256 !== built.manifestSha256
  ) {
    throw new TutorialUploaderExchangeError(
      "manifest_revision_conflict",
      "dispatch content changed without a revision increment",
    );
  }
  if (candidate.manifest !== null) {
    const saved = TutorialUploaderJobSchema.safeParse(candidate.manifest);
    if (
      !saved.success ||
      canonicalTutorialUploaderJob(saved.data) !==
        built.canonicalBytes.toString()
    ) {
      throw new TutorialUploaderExchangeError(
        "manifest_revision_conflict",
        "stored dispatch manifest differs from the current canonical manifest",
      );
    }
  }

  // Freeze the exact content identity before the first Drive mutation. If the
  // process dies after uploading only part of the folder, a retry compares the
  // current local bytes with this durable revision instead of silently
  // accepting a changed render under the same idempotency key.
  await repository.markPublishing({
    dispatchId: candidate.dispatchId,
    manifest: built.manifest,
    manifestSha256: built.manifestSha256,
  });

  const folderName = `${candidate.exchangeJobId}.r${candidate.revision}.${built.manifestSha256.slice(0, 12)}`;
  const folderId = await ensureUniqueJobFolder(
    drive,
    options.inboxFolderId,
    folderName,
  );
  let children = attemptValue(
    await drive.listChildren(folderId),
    "Drive job folder listing",
  );
  const existingMarker = oneNamed(children, MANIFEST_FILE_NAME);
  const sources = new Map<string, LocalAssetInspection>([
    ["video", video],
    ["thumbnail", thumbnail],
  ]);

  if (existingMarker !== null) {
    // Once the ready marker exists, the folder is immutable. Never repair a
    // missing asset behind the consumer's back.
    await verifyManifestMarker(drive, existingMarker, built.canonicalBytes);
    for (const asset of built.manifest.assets) {
      const remote = oneNamed(children, asset.file_name);
      if (remote === null) {
        throw new TutorialUploaderExchangeError(
          "drive_ready_job_missing_asset",
          `ready Drive job is missing ${asset.file_name}`,
        );
      }
      await verifyRemoteAsset(drive, remote, asset);
    }
  } else {
    for (const asset of built.manifest.assets) {
      const source = sources.get(asset.key);
      if (source === undefined) {
        throw new TutorialUploaderExchangeError(
          "asset_source_missing",
          `no local source is bound to ${asset.key}`,
        );
      }
      const existing = oneNamed(children, asset.file_name);
      if (existing !== null) {
        await verifyRemoteAsset(drive, existing, asset);
      } else {
        attemptValue(
          await drive.putLocalFile({
            folderId,
            sourcePath: source.path,
            asset,
            exchangeJobId: candidate.exchangeJobId,
            revision: candidate.revision,
          }),
          `Drive ${asset.role} upload`,
        );
        children = attemptValue(
          await drive.listChildren(folderId),
          `Drive ${asset.role} verification listing`,
        );
        const uploaded = oneNamed(children, asset.file_name);
        if (uploaded === null) {
          throw new TutorialUploaderExchangeError(
            "drive_asset_upload_unconfirmed",
            `Drive did not expose uploaded asset ${asset.file_name}`,
            true,
          );
        }
        await verifyRemoteAsset(drive, uploaded, asset);
      }
    }

    // Re-list immediately before the ready write. A concurrent publisher may
    // have created it while assets were uploading; immutable comparison turns
    // that ambiguity into an idempotent success or a hard conflict.
    children = attemptValue(
      await drive.listChildren(folderId),
      "Drive pre-manifest listing",
    );
    const racedMarker = oneNamed(children, MANIFEST_FILE_NAME);
    if (racedMarker !== null) {
      await verifyManifestMarker(drive, racedMarker, built.canonicalBytes);
    } else {
      attemptValue(
        await drive.putBytes({
          folderId,
          fileName: MANIFEST_FILE_NAME,
          mediaType: MANIFEST_MEDIA_TYPE,
          content: built.canonicalBytes,
          exchangeJobId: candidate.exchangeJobId,
          kind: `exchange-r${candidate.revision}-manifest-${built.manifestSha256.slice(0, 12)}`,
        }),
        "Drive job.json upload",
      );
      children = attemptValue(
        await drive.listChildren(folderId),
        "Drive job.json verification listing",
      );
      const uploadedMarker = oneNamed(children, MANIFEST_FILE_NAME);
      if (uploadedMarker === null) {
        throw new TutorialUploaderExchangeError(
          "drive_manifest_upload_unconfirmed",
          "Drive did not expose the uploaded job.json",
          true,
        );
      }
      await verifyManifestMarker(drive, uploadedMarker, built.canonicalBytes);
    }
  }

  await repository.markPublished({
    dispatchId: candidate.dispatchId,
    manifest: built.manifest,
    manifestSha256: built.manifestSha256,
    driveFolderId: folderId,
  });
}

function expectedReceiptPrefix(candidate: ReceiptCandidate): string {
  return `${candidate.exchangeJobId}.r${candidate.revision}.${candidate.manifestSha256.slice(0, 12)}.`;
}

async function readCandidateReceipts(
  drive: TutorialUploaderDrivePort,
  candidate: ReceiptCandidate,
  outboxChildren: DriveFile[],
): Promise<Array<{ receipt: TutorialUploaderReceipt; sha256: string }>> {
  const prefix = expectedReceiptPrefix(candidate);
  const items = outboxChildren
    .filter(
      (item) =>
        item.trashed !== true &&
        item.name.startsWith(prefix) &&
        item.name.endsWith(".json"),
    )
    .sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
  const seenNames = new Set<string>();
  const receipts: Array<{
    receipt: TutorialUploaderReceipt;
    sha256: string;
  }> = [];
  for (const item of items) {
    if (seenNames.has(item.name)) {
      throw new TutorialUploaderExchangeError(
        "receipt_duplicate_name",
        `Drive receipt name is duplicated: ${item.name}`,
      );
    }
    seenNames.add(item.name);
    if (item.size !== undefined && Number(item.size) > MAX_JSON_BYTES) {
      throw new TutorialUploaderExchangeError(
        "receipt_too_large",
        `Drive receipt exceeds 1 MiB: ${item.name}`,
      );
    }
    const downloaded = attemptValue(
      await drive.downloadBytes(item.id, MAX_JSON_BYTES),
      `Drive receipt ${item.name} download`,
    );
    if (item.size !== undefined && Number(item.size) !== downloaded.sizeBytes) {
      throw new TutorialUploaderExchangeError(
        "receipt_size_changed",
        `Drive receipt size changed during read: ${item.name}`,
      );
    }
    if (
      item.sha256Checksum !== undefined &&
      item.sha256Checksum !== downloaded.sha256
    ) {
      throw new TutorialUploaderExchangeError(
        "receipt_digest_changed",
        `Drive receipt digest changed during read: ${item.name}`,
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(downloaded.content.toString("utf8"));
    } catch {
      throw new TutorialUploaderExchangeError(
        "receipt_invalid_json",
        `Drive receipt is not valid JSON: ${item.name}`,
      );
    }
    const parsed = TutorialUploaderReceiptSchema.safeParse(raw);
    if (!parsed.success) {
      throw new TutorialUploaderExchangeError(
        "receipt_invalid_contract",
        `Drive receipt violates tutorial-uploader-receipt/1: ${item.name}`,
      );
    }
    const receipt = parsed.data;
    if (
      receipt.job_id !== candidate.exchangeJobId ||
      receipt.revision !== candidate.revision ||
      receipt.idempotency_key !== candidate.idempotencyKey ||
      receipt.manifest_sha256 !== candidate.manifestSha256
    ) {
      throw new TutorialUploaderExchangeError(
        "receipt_identity_mismatch",
        `Drive receipt identity differs from its dispatch: ${item.name}`,
      );
    }
    if (tutorialUploaderReceiptFileName(receipt) !== item.name) {
      throw new TutorialUploaderExchangeError(
        "receipt_filename_mismatch",
        `Drive receipt filename differs from its payload: ${item.name}`,
      );
    }
    if (receipt.state === "succeeded" && receipt.result !== null) {
      const required = new Set([
        ...Object.keys(candidate.attributes),
        "thumbnail",
      ]);
      const applied = new Set(receipt.result.applied_attributes);
      if (
        required.size !== applied.size ||
        [...required].some((attribute) => !applied.has(attribute))
      ) {
        throw new TutorialUploaderExchangeError(
          "receipt_applied_attributes_mismatch",
          `success receipt did not prove the exact requested attribute set: ${item.name}`,
        );
      }
    }
    receipts.push({ receipt, sha256: downloaded.sha256 });
  }

  receipts.sort(
    (left, right) => left.receipt.sequence - right.receipt.sequence,
  );
  for (let index = 0; index < receipts.length; index += 1) {
    if (receipts[index]?.receipt.sequence !== index + 1) {
      throw new TutorialUploaderExchangeError(
        "receipt_sequence_gap",
        "Drive receipt history is duplicated or not contiguous from sequence 1",
      );
    }
    if (
      TERMINAL_RECEIPT_STATES.has(receipts[index]?.receipt.state ?? "") &&
      index !== receipts.length - 1
    ) {
      throw new TutorialUploaderExchangeError(
        "receipt_after_terminal",
        "Drive receipt history continues after a terminal state",
      );
    }
  }
  if (receipts.length < candidate.latestSequence) {
    throw new TutorialUploaderExchangeError(
      "receipt_history_regressed",
      "Drive receipt history is shorter than the durable database high-water mark",
    );
  }
  return receipts;
}

async function reconcileCandidateReceipts(
  repository: TutorialUploaderExchangeRepository,
  drive: TutorialUploaderDrivePort,
  candidate: ReceiptCandidate,
  outboxChildren: DriveFile[],
): Promise<{ inserted: number; duplicates: number }> {
  const receipts = await readCandidateReceipts(
    drive,
    candidate,
    outboxChildren,
  );
  let inserted = 0;
  let duplicates = 0;
  // Replay the whole immutable journal. recordReceipt compares persisted bytes
  // below the high-water mark instead of trusting a mutable remote history.
  for (const item of receipts) {
    const outcome = await repository.recordReceipt(
      candidate,
      item.receipt,
      item.sha256,
    );
    if (outcome === "inserted") inserted += 1;
    else duplicates += 1;
  }
  return { inserted, duplicates };
}

export async function runTutorialUploaderExchangeOnce(
  repository: TutorialUploaderExchangeRepository,
  drive: TutorialUploaderDrivePort,
  options: TutorialUploaderExchangeOptions,
  deps: TutorialUploaderExchangeDeps = {},
): Promise<TutorialUploaderExchangeTotals> {
  const totals: TutorialUploaderExchangeTotals = {
    publishAttempted: 0,
    published: 0,
    publishFailed: 0,
    receiptsInserted: 0,
    receiptDuplicates: 0,
    receiptFailed: 0,
  };
  const publishCandidates = await repository.listPublishCandidates(
    options.batchSize,
  );
  for (const candidate of publishCandidates) {
    totals.publishAttempted += 1;
    try {
      await publishTutorialUploaderCandidate(
        repository,
        drive,
        options,
        candidate,
        deps,
      );
      totals.published += 1;
    } catch (error) {
      totals.publishFailed += 1;
      const failure =
        error instanceof TutorialUploaderExchangeError
          ? error
          : new TutorialUploaderExchangeError(
              "publish_unexpected",
              error instanceof Error ? error.message : String(error),
            );
      await repository.markPublishFailed({
        dispatchId: candidate.dispatchId,
        code: failure.code,
        message: failure.message.slice(0, 1_000),
        retryable: failure.retryable,
      });
    }
  }

  const receiptCandidates = await repository.listReceiptCandidates(
    options.batchSize,
  );
  if (receiptCandidates.length === 0) return totals;
  const outbox = await drive.listChildren(options.receiptFolderId);
  if (!outbox.ok) {
    // A Drive outage is a pass-level failure, but no durable receipt changes.
    // Count every candidate so monitoring cannot mistake the pass for healthy.
    totals.receiptFailed = receiptCandidates.length;
    return totals;
  }
  for (const candidate of receiptCandidates) {
    try {
      const result = await reconcileCandidateReceipts(
        repository,
        drive,
        candidate,
        outbox.value,
      );
      totals.receiptsInserted += result.inserted;
      totals.receiptDuplicates += result.duplicates;
    } catch {
      totals.receiptFailed += 1;
    }
  }
  return totals;
}

export class DriveClientTutorialUploaderPort implements TutorialUploaderDrivePort {
  constructor(
    private readonly client: DriveClient,
    private readonly chunkSizeBytes: number,
    private readonly maxAttempts: number,
  ) {}

  listChildren(folderId: string): Promise<Attempt<DriveFile[]>> {
    return this.client.listChildren(folderId);
  }

  createFolder(
    name: string,
    parentId: string | null,
  ): Promise<Attempt<string>> {
    return this.client.createFolder(name, parentId);
  }

  downloadBytes(
    fileId: string,
    maxBytes: number,
  ): Promise<Attempt<{ content: Buffer; sizeBytes: number; sha256: string }>> {
    return this.client.downloadFileBytes(fileId, maxBytes);
  }

  inspectContent(
    fileId: string,
    maxBytes: number,
  ): Promise<Attempt<{ sizeBytes: number; sha256: string }>> {
    return this.client.inspectFileContent(fileId, maxBytes);
  }

  putLocalFile(args: {
    folderId: string;
    sourcePath: string;
    asset: TutorialUploaderAsset;
    exchangeJobId: string;
    revision: number;
  }): Promise<Attempt<DriveFile>> {
    return resumableUpload(
      this.client,
      {
        localPath: args.sourcePath,
        totalBytes: args.asset.size_bytes,
        filename: args.asset.file_name,
        parentId: args.folderId,
        mimeType: args.asset.media_type,
        jobId: args.exchangeJobId,
        kind: `exchange-r${args.revision}-${args.asset.key}-${args.asset.sha256.slice(0, 12)}`,
        chunkSizeBytes: this.chunkSizeBytes,
      },
      {
        baseDelayMs: 1_000,
        maxDelayMs: 60_000,
        maxAttempts: this.maxAttempts,
        jitter: 1,
      },
    );
  }

  putBytes(args: {
    folderId: string;
    fileName: string;
    mediaType: string;
    content: Buffer;
    exchangeJobId: string;
    kind: string;
  }): Promise<Attempt<DriveFile>> {
    return this.client.uploadSmallFile({
      filename: args.fileName,
      parentId: args.folderId,
      mimeType: args.mediaType,
      content: args.content,
      jobId: args.exchangeJobId,
      kind: args.kind,
    });
  }
}

export class DrizzleTutorialUploaderExchangeRepository implements TutorialUploaderExchangeRepository {
  constructor(private readonly db: DrizzleClient) {}

  async listPublishCandidates(limit: number): Promise<PublishCandidate[]> {
    const rows = await this.db
      .select({
        dispatchId: tutorialUploadDispatches.id,
        tutorialJobId: tutorialUploadDispatches.tutorial_job_id,
        exchangeJobId: tutorialUploadDispatches.exchange_job_id,
        revision: tutorialUploadDispatches.revision,
        idempotencyKey: tutorialUploadDispatches.idempotency_key,
        channelKey: tutorialUploadDispatches.channel_key,
        requestedAt: tutorialUploadDispatches.requested_at,
        attributes: tutorialUploadDispatches.attributes,
        manifestSha256: tutorialUploadDispatches.manifest_sha256,
        manifest: tutorialUploadDispatches.manifest,
        videoPath: tutorialUploadDispatches.video_path,
        thumbnailId: tutorialUploadDispatches.thumbnail_id,
        thumbnailPath: tutorialUploadDispatches.thumbnail_path,
      })
      .from(tutorialUploadDispatches)
      .where(
        or(
          eq(tutorialUploadDispatches.state, "requested"),
          and(
            eq(tutorialUploadDispatches.state, "publish_failed"),
            eq(tutorialUploadDispatches.error_retryable, true),
          ),
          eq(tutorialUploadDispatches.state, "publishing"),
        ),
      )
      .orderBy(asc(tutorialUploadDispatches.requested_at))
      .limit(limit);

    return rows;
  }

  async markPublishing(
    record: Omit<PublishRecord, "driveFolderId">,
  ): Promise<void> {
    const now = new Date();
    const updated = await this.db
      .update(tutorialUploadDispatches)
      .set({
        state: "publishing",
        manifest: record.manifest,
        manifest_sha256: record.manifestSha256,
        error_code: null,
        error_message: null,
        error_retryable: null,
        terminal_at: null,
        updated_at: now,
      })
      .where(
        and(
          eq(tutorialUploadDispatches.id, record.dispatchId),
          or(
            eq(tutorialUploadDispatches.state, "requested"),
            eq(tutorialUploadDispatches.state, "publishing"),
            and(
              eq(tutorialUploadDispatches.state, "publish_failed"),
              eq(tutorialUploadDispatches.error_retryable, true),
            ),
          ),
          or(
            isNull(tutorialUploadDispatches.manifest_sha256),
            eq(tutorialUploadDispatches.manifest_sha256, record.manifestSha256),
          ),
        ),
      )
      .returning({ id: tutorialUploadDispatches.id });
    if (updated.length !== 1) {
      throw new TutorialUploaderExchangeError(
        "dispatch_publish_conflict",
        "dispatch could not be frozen for this manifest revision",
      );
    }
  }

  async markPublished(record: PublishRecord): Promise<void> {
    const now = new Date();
    const updated = await this.db
      .update(tutorialUploadDispatches)
      .set({
        state: "published",
        manifest: record.manifest,
        manifest_sha256: record.manifestSha256,
        drive_folder_id: record.driveFolderId,
        published_at: now,
        error_code: null,
        error_message: null,
        error_retryable: null,
        terminal_at: null,
        updated_at: now,
      })
      .where(
        and(
          eq(tutorialUploadDispatches.id, record.dispatchId),
          eq(tutorialUploadDispatches.state, "publishing"),
          eq(tutorialUploadDispatches.manifest_sha256, record.manifestSha256),
        ),
      )
      .returning({ id: tutorialUploadDispatches.id });
    if (updated.length !== 1) {
      throw new TutorialUploaderExchangeError(
        "dispatch_publish_conflict",
        "dispatch changed before Drive publication could be recorded",
      );
    }
  }

  async markPublishFailed(failure: PublishFailure): Promise<void> {
    const now = new Date();
    await this.db
      .update(tutorialUploadDispatches)
      .set({
        state: "publish_failed",
        error_code: failure.code,
        error_message: failure.message,
        error_retryable: failure.retryable,
        terminal_at: failure.retryable ? null : now,
        updated_at: now,
      })
      .where(
        and(
          eq(tutorialUploadDispatches.id, failure.dispatchId),
          or(
            eq(tutorialUploadDispatches.state, "requested"),
            eq(tutorialUploadDispatches.state, "publishing"),
            and(
              eq(tutorialUploadDispatches.state, "publish_failed"),
              eq(tutorialUploadDispatches.error_retryable, true),
            ),
          ),
        ),
      );
  }

  async listReceiptCandidates(limit: number): Promise<ReceiptCandidate[]> {
    return this.db
      .select({
        dispatchId: tutorialUploadDispatches.id,
        tutorialJobId: tutorialUploadDispatches.tutorial_job_id,
        exchangeJobId: tutorialUploadDispatches.exchange_job_id,
        revision: tutorialUploadDispatches.revision,
        idempotencyKey: tutorialUploadDispatches.idempotency_key,
        manifestSha256: tutorialUploadDispatches.manifest_sha256,
        latestSequence: tutorialUploadDispatches.latest_sequence,
        attributes: tutorialUploadDispatches.attributes,
      })
      .from(tutorialUploadDispatches)
      .where(
        and(
          isNotNull(tutorialUploadDispatches.published_at),
          isNotNull(tutorialUploadDispatches.manifest_sha256),
          isNull(tutorialUploadDispatches.terminal_at),
        ),
      )
      .orderBy(asc(tutorialUploadDispatches.requested_at))
      .limit(limit) as Promise<ReceiptCandidate[]>;
  }

  async recordReceipt(
    candidate: ReceiptCandidate,
    receipt: TutorialUploaderReceipt,
    receiptSha256: string,
  ): Promise<ReceiptRecordResult> {
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select({
          dispatchId: tutorialUploadReceipts.dispatch_id,
          receiptSha256: tutorialUploadReceipts.receipt_sha256,
        })
        .from(tutorialUploadReceipts)
        .where(
          and(
            eq(tutorialUploadReceipts.exchange_job_id, receipt.job_id),
            eq(tutorialUploadReceipts.revision, receipt.revision),
            eq(tutorialUploadReceipts.sequence, receipt.sequence),
          ),
        )
        .limit(1);
      const prior = existing[0];
      if (prior !== undefined) {
        if (
          prior.dispatchId !== candidate.dispatchId ||
          prior.receiptSha256 !== receiptSha256
        ) {
          throw new TutorialUploaderExchangeError(
            "receipt_immutable_conflict",
            `receipt sequence ${receipt.sequence} changed after it was persisted`,
          );
        }
        return "duplicate" as const;
      }

      const currentRows = await tx
        .select({ latestSequence: tutorialUploadDispatches.latest_sequence })
        .from(tutorialUploadDispatches)
        .where(eq(tutorialUploadDispatches.id, candidate.dispatchId))
        .limit(1);
      const current = currentRows[0];
      if (current === undefined) {
        throw new TutorialUploaderExchangeError(
          "receipt_dispatch_missing",
          "receipt dispatch disappeared during reconciliation",
        );
      }
      if (receipt.sequence !== current.latestSequence + 1) {
        throw new TutorialUploaderExchangeError(
          "receipt_sequence_gap",
          `expected receipt sequence ${current.latestSequence + 1}, got ${receipt.sequence}`,
        );
      }

      await tx.insert(tutorialUploadReceipts).values({
        dispatch_id: candidate.dispatchId,
        exchange_job_id: receipt.job_id,
        revision: receipt.revision,
        sequence: receipt.sequence,
        state: receipt.state,
        progress: receipt.progress,
        message: receipt.message,
        result: receipt.result,
        error: receipt.error,
        raw_receipt: receipt,
        receipt_sha256: receiptSha256,
        occurred_at: new Date(receipt.occurred_at),
      });

      const isTerminal = TERMINAL_RECEIPT_STATES.has(receipt.state);
      const result = receipt.result;
      const error = receipt.error;
      const now = new Date();
      const updated = await tx
        .update(tutorialUploadDispatches)
        .set({
          state: receipt.state,
          latest_sequence: receipt.sequence,
          latest_message: receipt.message,
          error_code: error?.code ?? null,
          error_message: error?.message ?? null,
          error_retryable: error?.retryable ?? null,
          youtube_video_id: result?.video_id ?? null,
          youtube_video_url: result?.video_url ?? null,
          proof_ref: result?.proof_ref ?? null,
          terminal_at: isTerminal ? new Date(receipt.occurred_at) : null,
          updated_at: now,
        })
        .where(
          and(
            eq(tutorialUploadDispatches.id, candidate.dispatchId),
            eq(
              tutorialUploadDispatches.latest_sequence,
              current.latestSequence,
            ),
          ),
        )
        .returning({ id: tutorialUploadDispatches.id });
      if (updated.length !== 1) {
        throw new TutorialUploaderExchangeError(
          "receipt_concurrent_update",
          "another receipt writer advanced the dispatch concurrently",
          true,
        );
      }

      await tx
        .update(tutorialJobs)
        .set(tutorialJobProjectionForReceipt(candidate, receipt))
        .where(eq(tutorialJobs.id, candidate.tutorialJobId));
      return "inserted" as const;
    });
  }
}

export function createTutorialUploaderExchangeService(
  db: DrizzleClient,
  driveClient: DriveClient,
  chunkSizeBytes: number,
  maxAttempts: number,
): {
  repository: DrizzleTutorialUploaderExchangeRepository;
  drive: DriveClientTutorialUploaderPort;
} {
  return {
    repository: new DrizzleTutorialUploaderExchangeRepository(db),
    drive: new DriveClientTutorialUploaderPort(
      driveClient,
      chunkSizeBytes,
      maxAttempts,
    ),
  };
}
