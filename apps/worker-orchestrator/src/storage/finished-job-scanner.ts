import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  notInArray,
  or,
  type SQL,
} from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";
import {
  contentJobs,
  channels,
  thumbnails,
  storageArtifacts,
  systemSettings,
} from "@repo/db";
import {
  ArtifactStore,
  collectFinishedJobArtifacts,
  buildMetadataSidecarV2,
  buildTranscriptDoc,
  transcriptToSrt,
  wordCount,
  TranscriptUnavailableError,
  ARTIFACT_FILENAMES,
  type FinishedJobRow,
  type TranscriptWord,
  type TranscriptSentence,
} from "@repo/storage";
import { logger } from "@repo/logger";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runTutorialScanOnce } from "./tutorial-drive-scanner.js";

/**
 * Finished-job scanner.
 *
 * Polls for jobs that have genuinely finished (AWAITING_UPLOADER / PUBLISHED)
 * and pushes their finished artefacts to Drive.
 *
 * Why a scanner and not a hook in the render workflow:
 *   - It runs completely outside the pipeline, so a Drive outage, a full
 *     Drive, or a bug in here can never fail or stall a render job. That
 *     property is structural, not a promise.
 *   - It back-fills jobs that finished before this feature existed.
 *   - It self-heals after a worker restart or a transient Drive failure -
 *     a `failed` row simply gets picked up again on the next pass.
 *
 * The VPS copy is never moved or deleted. Uploading is a copy.
 */

export interface ScannerOptions {
  /** How often to look for new finished jobs. */
  intervalMs: number;
  /** Jobs per pass. Keeps a back-fill from saturating the Drive quota. */
  batchSize: number;
  /**
   * Only consider jobs finished within this window. Stops a first run from
   * walking years of history into the quota. Set 0 for no limit (back-fill).
   */
  lookbackDays: number;
  /** Root of the local media tree, for resolving relative manifest keys. */
  mediaRoot: string;
  /** Retry artefacts that previously failed, up to this many attempts. */
  maxAttemptsPerArtifact: number;
}

export const DEFAULT_SCANNER_OPTIONS: ScannerOptions = {
  intervalMs: 5 * 60_000,
  batchSize: 5,
  lookbackDays: 14,
  mediaRoot: process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media",
  maxAttemptsPerArtifact: 5,
};

export function scannerOptionsFromEnv(): ScannerOptions {
  const num = (name: string, fallback: number): number => {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    intervalMs: num(
      "STORAGE_SCAN_INTERVAL_MS",
      DEFAULT_SCANNER_OPTIONS.intervalMs,
    ),
    batchSize: num("STORAGE_SCAN_BATCH", DEFAULT_SCANNER_OPTIONS.batchSize),
    lookbackDays:
      process.env["STORAGE_DRIVE_BACKFILL"] === "true"
        ? 0
        : num(
            "STORAGE_SCAN_LOOKBACK_DAYS",
            DEFAULT_SCANNER_OPTIONS.lookbackDays,
          ),
    mediaRoot:
      process.env["LOCAL_MEDIA_ROOT"] ?? DEFAULT_SCANNER_OPTIONS.mediaRoot,
    maxAttemptsPerArtifact: num(
      "STORAGE_MAX_ATTEMPTS_PER_ARTIFACT",
      DEFAULT_SCANNER_OPTIONS.maxAttemptsPerArtifact,
    ),
  };
}

/** Overlay the Settings-page Drive scanner controls onto bootstrap env values. */
export async function scannerOptionsFromDatabase(
  db: DrizzleClient,
): Promise<ScannerOptions> {
  const base = scannerOptionsFromEnv();
  let row: { storage: unknown } | undefined;
  try {
    [row] = await db
      .select({ storage: systemSettings.storage })
      .from(systemSettings)
      .where(eq(systemSettings.id, "singleton"))
      .limit(1);
  } catch {
    return base;
  }
  const s = (
    row?.storage && typeof row.storage === "object" ? row.storage : {}
  ) as Record<string, unknown>;
  const num = (key: string, fallback: number): number => {
    const value = s[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : fallback;
  };
  return {
    ...base,
    intervalMs:
      num("driveScanIntervalMinutes", base.intervalMs / 60_000) * 60_000,
    batchSize: num("driveBatchSize", base.batchSize),
    lookbackDays: num("driveLookbackDays", base.lookbackDays),
    maxAttemptsPerArtifact: num(
      "driveMaxAttempts",
      base.maxAttemptsPerArtifact,
    ),
  };
}

interface JobCandidate extends FinishedJobRow {
  channel_name: string | null;
  thumbnail_path: string | null;
  language: string | null;
  render_engine: string | null;
  assembly_manifest: Record<string, unknown> | null;
  youtube_video_id: string | null;
  published_at: Date | null;
}

/** Pull word/sentence timings out of the assembly_manifest jsonb blob. */
function extractTimings(manifest: Record<string, unknown> | null): {
  words: TranscriptWord[];
  sentences: TranscriptSentence[];
} {
  if (manifest === null || typeof manifest !== "object") {
    return { words: [], sentences: [] };
  }
  const words = Array.isArray(manifest["word_timestamps"])
    ? (manifest["word_timestamps"] as TranscriptWord[])
    : [];
  const sentences = Array.isArray(manifest["sentence_timings"])
    ? (manifest["sentence_timings"] as TranscriptSentence[])
    : [];
  return { words, sentences };
}

/**
 * Jobs that are finished and not yet fully pushed.
 *
 * "Not yet pushed" = either no storage row at all, or a row that is `pending`
 * / `failed` and still under the attempt ceiling. `uploaded` and `skipped`
 * rows are left alone.
 */
async function findCandidates(
  db: DrizzleClient,
  opts: ScannerOptions,
): Promise<JobCandidate[]> {
  const conditions: SQL[] = [
    inArray(contentJobs.status, ["AWAITING_UPLOADER", "PUBLISHED"]),
  ];

  if (opts.lookbackDays > 0) {
    const cutoff = new Date(Date.now() - opts.lookbackDays * 86_400_000);
    const recent = or(
      gte(contentJobs.render_completed_at, cutoff),
      and(
        isNull(contentJobs.render_completed_at),
        gte(contentJobs.created_at, cutoff),
      ),
    );
    if (recent !== undefined) conditions.push(recent);
  }

  // Exclude jobs whose final_video artefact is already settled. Doing this in
  // SQL keeps each pass cheap once the back-fill has drained.
  const settledFilter = and(
    eq(storageArtifacts.kind, "final_video"),
    or(
      eq(storageArtifacts.state, "uploaded"),
      eq(storageArtifacts.state, "skipped"),
      and(
        eq(storageArtifacts.state, "failed"),
        gte(storageArtifacts.attempts, opts.maxAttemptsPerArtifact),
      ),
    ),
  );

  const settled = db
    .select({ job_id: storageArtifacts.job_id })
    .from(storageArtifacts)
    .where(settledFilter);

  conditions.push(notInArray(contentJobs.id, settled));

  const rows = await db
    .select({
      id: contentJobs.id,
      status: contentJobs.status,
      channel_id: contentJobs.channel_id,
      channel_name: channels.name,
      title: contentJobs.title,
      description: contentJobs.description,
      format: contentJobs.format,
      render_completed_at: contentJobs.render_completed_at,
      created_at: contentJobs.created_at,
      final_video_size_bytes: contentJobs.final_video_size_bytes,
      final_video_duration_seconds: contentJobs.final_video_duration_seconds,
      r2_asset_manifest: contentJobs.r2_asset_manifest,
      thumbnail_path: thumbnails.output_path,
      language: contentJobs.language,
      render_engine: contentJobs.render_engine,
      assembly_manifest: contentJobs.assembly_manifest,
      youtube_video_id: contentJobs.youtube_video_id,
      published_at: contentJobs.published_at,
    })
    .from(contentJobs)
    .leftJoin(channels, eq(channels.id, contentJobs.channel_id))
    .leftJoin(
      thumbnails,
      and(
        eq(thumbnails.subject_id, contentJobs.id),
        eq(thumbnails.is_selected, true),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(contentJobs.render_completed_at))
    .limit(opts.batchSize);

  return rows as JobCandidate[];
}

/**
 * Push one job's finished artefacts. Returns a short outcome summary.
 *
 * Never throws: a failure here must not stop the scan loop or touch the job.
 */
export async function pushJobArtifacts(
  db: DrizzleClient,
  store: ArtifactStore,
  job: JobCandidate,
  opts: ScannerOptions,
): Promise<{ uploaded: number; failed: number; skipped: number }> {
  const tally = { uploaded: 0, failed: 0, skipped: 0 };
  const completedAt = job.render_completed_at ?? job.created_at;
  const artifacts = collectFinishedJobArtifacts(job, opts.mediaRoot);

  if (artifacts.length === 0) {
    logger.debug(
      { job_id: job.id },
      "storage-scanner: finished job has no final video on disk yet",
    );
    return tally;
  }

  let videoChecksum: string | null = null;
  let videoBytes: number | null = null;

  for (const artifact of artifacts) {
    const result = await store.putFinalArtifact({
      jobId: job.id,
      channelId: job.channel_id,
      channelName: job.channel_name,
      title: job.title,
      completedAt,
      kind: artifact.kind,
      localPath: artifact.localPath,
      // Routes TECH_COMPARISON into `_Comparisons/` and leaves every other
      // format in `Content Forge/`. Must be passed on EVERY call for a job or
      // its sidecars end up in a different tree than its video.
      format: job.format ?? null,
    });

    if (result.outcome === "uploaded") {
      tally.uploaded += 1;
      if (artifact.kind === "final_video") {
        videoChecksum = result.checksum;
        videoBytes = result.bytes;
      }
    } else if (result.outcome === "already_uploaded") {
      if (artifact.kind === "final_video") videoBytes = artifact.sizeBytes;
    } else if (result.outcome === "skipped") {
      tally.skipped += 1;
    } else if (result.outcome === "failed") {
      tally.failed += 1;
      // A failed final video means the sidecar would describe something that
      // is not there. Stop this job here and let the next pass retry.
      if (artifact.kind === "final_video") return tally;
    }
  }

  // Transcript + subtitles (§3.1): ship them so the video can be translated
  // later without re-transcribing. Built in memory from the assembly_manifest;
  // if the manifest has no word timings we record transcript_file: null and
  // move on — never emit an empty transcript.
  const language = job.language ?? "en";
  let transcriptFile: string | null = null;
  let subtitlesFile: string | null = null;
  let words: number | null = null;

  const tmpDir = join(tmpdir(), "cf-storage-docs", job.id);
  try {
    await mkdir(tmpDir, { recursive: true });
    const { words: w, sentences } = extractTimings(job.assembly_manifest);
    try {
      const doc = buildTranscriptDoc({
        jobId: job.id,
        language,
        words: w,
        sentences,
        durationSeconds: job.final_video_duration_seconds,
      });
      words = wordCount(doc);

      const transcriptPath = join(tmpDir, ARTIFACT_FILENAMES.transcript);
      await writeFile(transcriptPath, JSON.stringify(doc, null, 2), "utf8");
      const tRes = await store.putFinalArtifact({
        jobId: job.id,
        channelId: job.channel_id,
        channelName: job.channel_name,
        title: job.title,
        completedAt,
        kind: "transcript",
        localPath: transcriptPath,
        language: language === "en" ? null : language,
        format: job.format ?? null,
      });
      if (tRes.outcome === "uploaded") {
        tally.uploaded += 1;
        transcriptFile = ARTIFACT_FILENAMES.transcript;
      } else if (tRes.outcome === "already_uploaded") {
        transcriptFile = ARTIFACT_FILENAMES.transcript;
      } else if (tRes.outcome === "failed") tally.failed += 1;

      const srt = transcriptToSrt(doc);
      if (srt !== null) {
        const srtPath = join(tmpDir, ARTIFACT_FILENAMES.subtitles);
        await writeFile(srtPath, srt, "utf8");
        const sRes = await store.putFinalArtifact({
          jobId: job.id,
          channelId: job.channel_id,
          channelName: job.channel_name,
          title: job.title,
          completedAt,
          kind: "subtitles",
          localPath: srtPath,
          language: language === "en" ? null : language,
          format: job.format ?? null,
        });
        if (sRes.outcome === "uploaded") {
          tally.uploaded += 1;
          subtitlesFile = ARTIFACT_FILENAMES.subtitles;
        } else if (sRes.outcome === "already_uploaded") {
          subtitlesFile = ARTIFACT_FILENAMES.subtitles;
        } else if (sRes.outcome === "failed") tally.failed += 1;
      }
    } catch (err) {
      if (err instanceof TranscriptUnavailableError) {
        logger.info(
          { job_id: job.id },
          "storage-scanner: no transcript source; transcript_file will be null",
        );
      } else {
        throw err;
      }
    }

    // The metadata sidecar (v2) LAST, so it only ever describes artefacts that
    // actually landed, and carries pointers to the sibling documents.
    const vpsPath =
      artifacts.find((a) => a.kind === "final_video")?.localPath ?? "";
    const sidecar = buildMetadataSidecarV2({
      content_forge_job_id: job.id,
      owner_kind: "content_job",
      title: job.title,
      description: job.description ?? null,
      format: job.format ?? null,
      channel_id: job.channel_id,
      channel_name: job.channel_name,
      language,
      duration_seconds: job.final_video_duration_seconds,
      size_bytes: videoBytes ?? job.final_video_size_bytes,
      sha256: videoChecksum,
      word_count: words,
      transcript_file: transcriptFile,
      subtitles_file: subtitlesFile,
      transcript_language: transcriptFile !== null ? language : null,
      render_engine: job.render_engine,
      render_completed_at: job.render_completed_at?.toISOString() ?? null,
      published_at: job.published_at?.toISOString() ?? null,
      youtube_video_id: job.youtube_video_id,
      youtube_url:
        job.youtube_video_id !== null
          ? `https://youtu.be/${job.youtube_video_id}`
          : null,
      vps_path: vpsPath,
    });

    const metaPath = join(tmpDir, ARTIFACT_FILENAMES.metadata);
    await writeFile(metaPath, JSON.stringify(sidecar, null, 2), "utf8");
    const mRes = await store.putFinalArtifact({
      jobId: job.id,
      channelId: job.channel_id,
      channelName: job.channel_name,
      title: job.title,
      completedAt,
      kind: "metadata",
      localPath: metaPath,
      format: job.format ?? null,
    });
    if (mRes.outcome === "uploaded") tally.uploaded += 1;
    else if (mRes.outcome === "failed") tally.failed += 1;
  } catch (err) {
    logger.warn(
      { job_id: job.id, err: err instanceof Error ? err.message : String(err) },
      "storage-scanner: could not build/upload transcript or metadata",
    );
    tally.failed += 1;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }

  return tally;
}

/** One pass. Exported so it can be run once from a CLI. */
export async function runScanOnce(
  db: DrizzleClient,
  store: ArtifactStore,
  opts: ScannerOptions,
): Promise<{
  jobs: number;
  uploaded: number;
  failed: number;
  skipped: number;
}> {
  const candidates = await findCandidates(db, opts);
  const totals = {
    jobs: candidates.length,
    uploaded: 0,
    failed: 0,
    skipped: 0,
  };

  for (const job of candidates) {
    try {
      const tally = await pushJobArtifacts(db, store, job, opts);
      totals.uploaded += tally.uploaded;
      totals.failed += tally.failed;
      totals.skipped += tally.skipped;
    } catch (err) {
      // Defensive: putFinalArtifact is contractually non-throwing, but one
      // bad job must never take down the loop.
      logger.error(
        {
          job_id: job.id,
          err: err instanceof Error ? err.message : String(err),
        },
        "storage-scanner: unexpected error pushing job artefacts",
      );
      totals.failed += 1;
    }
  }

  // Tutorials are a separate operation with their own tree (_Tutorials/) and
  // their own eligibility; run their pass too so one scanner handles both.
  try {
    const tut = await runTutorialScanOnce(db, store, {
      batchSize: opts.batchSize,
      mediaRoot: opts.mediaRoot,
      // Same ceiling both lanes — the tutorial copy had lost it entirely.
      maxAttemptsPerArtifact: opts.maxAttemptsPerArtifact,
    });
    totals.jobs += tut.jobs;
    totals.uploaded += tut.uploaded;
    totals.failed += tut.failed;
    totals.skipped += tut.skipped;
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "storage-scanner: tutorial pass failed",
    );
  }

  if (totals.jobs > 0) {
    logger.info(totals, "storage-scanner: pass complete");
  }
  return totals;
}

export interface ScannerHandle {
  stop: () => void;
}

/**
 * Start the periodic scan. Returns a handle even when storage is disabled -
 * the caller should not have to care.
 */
export function startFinishedJobScanner(
  db: DrizzleClient,
  opts: ScannerOptions = scannerOptionsFromEnv(),
): ScannerHandle {
  const created = ArtifactStore.create(db);
  if (!created.ok) {
    logger.info(
      { reason: created.reason },
      "storage-scanner: Drive upload disabled, scanner not started",
    );
    return { stop: () => undefined };
  }

  let running = false;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      await runScanOnce(db, created.store, opts);
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "storage-scanner: pass failed",
      );
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), opts.intervalMs);
  timer.unref?.();
  void tick();

  logger.info(
    { interval_ms: opts.intervalMs, lookback_days: opts.lookbackDays },
    "storage-scanner: started",
  );

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
