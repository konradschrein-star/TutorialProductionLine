import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, unlink, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, basename } from "node:path";
import type { Job, Queue } from "bullmq";
import { eq, sql } from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";
import { sourceVideos, clips, clipLibraries } from "@repo/db";
import {
  ClipIngestPayloadSchema,
  buildRefBase,
  composeExternalRef,
} from "@repo/contracts";
import type { ClipIngestPayload } from "@repo/contracts";
import { createContextLogger } from "@repo/logger";
import { detectScenes } from "./sidecar-client.js";
import {
  resolveStoragePath,
  resolveCdnUrl,
} from "../utils/storage-resolver.js";

const logger = createContextLogger("clip-ingest");

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of a file using streaming reads (1 MB chunks).
 * Never loads the whole file into memory.
 */
function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Verify that a binary is available by probing its version banner.
 * Throws a descriptive error if the binary is missing.
 *
 * ffmpeg + ffprobe accept single-dash `-version`; double-dash `--version`
 * makes ffmpeg exit 8 ("Unrecognized option") and ffprobe exit 1.
 * yt-dlp accepts both. Stick with single dash so the same shape works
 * across all three.
 */
function checkBinaryAvailable(binary: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binary, ["-version"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    });
    proc.on("error", () =>
      reject(
        new Error(
          `${binary} is not available. Install it before running clip-ingest.`,
        ),
      ),
    );
    proc.on("close", (code) => {
      if (code === 0 || code === 1) {
        // Some legacy tools exit 1 on -version; still counts as "available".
        resolve();
      } else {
        reject(new Error(`${binary} -version exited with code ${code}`));
      }
    });
  });
}

/**
 * Download a video using yt-dlp.
 * Throws on non-zero exit code.
 * Returns the actual output file path by globbing the temp directory for
 * files matching the yt-dlp output template.
 */
async function downloadWithYtDlp(
  sourceUrl: string,
  sourceVideoId: string,
): Promise<string> {
  await checkBinaryAvailable("yt-dlp");

  const outputTemplate = `/tmp/clip-ingest-${sourceVideoId}.%(ext)s`;

  await new Promise<void>((resolve, reject) => {
    const cookiesPath =
      process.env["YTDLP_COOKIES_PATH"] ??
      "/opt/content-forge/youtube-cookies.txt";
    const nodePath = process.env["NODE_PATH"] ?? "/usr/bin/node";

    const proc = spawn(
      "yt-dlp",
      [
        // Node.js for YouTube signature/n-challenge solving (no Deno or Chrome required).
        "--js-runtimes",
        `node:${nodePath}`,
        // Cookie file written from browser session — refresh when downloads start failing.
        "--cookies",
        cookiesPath,
        "-f",
        "bestvideo[height<=1080]+bestaudio/bestvideo+bestaudio/best",
        "--merge-output-format",
        "mp4",
        "--no-playlist",
        "-o",
        outputTemplate,
        sourceUrl,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 300_000,
      },
    );

    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) =>
      reject(
        new Error(
          `yt-dlp failed to start: ${err.message}. Is yt-dlp installed?`,
        ),
      ),
    );

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`yt-dlp exited with code ${code}. stderr: ${stderr}`));
      }
    });
  });

  // Resolve actual output path — yt-dlp substitutes %(ext)s
  const prefix = `clip-ingest-${sourceVideoId}.`;
  const tmpEntries = await readdir("/tmp");
  const match = tmpEntries.find((f) => f.startsWith(prefix));

  if (!match) {
    throw new Error(
      `yt-dlp completed but no output file found matching /tmp/${prefix}*`,
    );
  }

  return join("/tmp", match);
}

// ── ffprobe ──────────────────────────────────────────────────────────────────

interface VideoMetadata {
  width: number;
  height: number;
  codec: string;
  fps: number;
  duration_ms: number;
}

async function probeVideo(videoPath: string): Promise<VideoMetadata> {
  await checkBinaryAvailable("ffprobe");

  return new Promise<VideoMetadata>((resolve, reject) => {
    const proc = spawn(
      "ffprobe",
      [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_streams",
        "-select_streams",
        "v:0",
        "-show_format",
        videoPath,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 300_000,
      },
    );

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) =>
      reject(new Error(`ffprobe failed to start: ${err.message}`)),
    );

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `ffprobe exited with code ${code}. stderr: ${stderr.slice(0, 500)}`,
          ),
        );
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as {
          streams?: Array<{
            width?: number;
            height?: number;
            codec_name?: string;
            r_frame_rate?: string;
            duration?: string;
          }>;
          format?: { duration?: string };
        };

        const stream = parsed.streams?.[0];
        if (!stream) {
          reject(new Error(`ffprobe found no video streams in: ${videoPath}`));
          return;
        }

        const width = stream.width ?? 0;
        const height = stream.height ?? 0;
        const codec = stream.codec_name ?? "unknown";

        // r_frame_rate is a fraction like "30000/1001"
        let fps = 0;
        if (stream.r_frame_rate) {
          const [num, den] = stream.r_frame_rate.split("/").map(Number);
          fps = den && den !== 0 ? (num ?? 0) / den : (num ?? 0);
        }

        // MKV containers often report N/A for stream-level duration but
        // set it at the container level. Fall back to format.duration so
        // the source_videos.duration_ms metadata is populated correctly.
        const durationSec = stream.duration
          ? parseFloat(stream.duration)
          : parsed.format?.duration
            ? parseFloat(parsed.format.duration)
            : 0;
        const duration_ms = Math.round(durationSec * 1000);

        resolve({ width, height, codec, fps, duration_ms });
      } catch (err) {
        reject(
          new Error(
            `Failed to parse ffprobe output: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    });
  });
}

// ── Re-encode source ──────────────────────────────────────────────────────────
// One H.264 1080p MP4 + libmp3lame MP3 sidecar per source. Inline strategy:
// every clip is a (source, start_ms, end_ms) offset — no per-clip files.
// Re-encoding once at ingest >> re-decoding source AV1/HEVC on every render.
//
// Key encoder choices for fast inline seeking:
// - `-g 60` + `-keyint_min 60`: force a keyframe at least every 60 frames
//   (≈2.5 s at 24 fps, ≈2 s at 30 fps). libx264 default GOP is ~250 frames
//   which leaves up to 10 s of throwaway pre-decode per seek. With -g 60
//   the worst-case decode-before-target window is the 60-frame GOP, so
//   `ffmpeg -ss <t> -i source.mp4` lands on a usable frame in a fraction
//   of a second. Storage cost is ~10-15 % over default — well worth it.
// - `-sc_threshold 0`: disable scene-cut-driven keyframes. Mixed-cause
//   keyframes (forced + scene-cut) produce uneven GOPs and surprise the
//   seek heuristic. We want exactly-N-frame-spaced predictable GOPs.
// - `+faststart`: moov atom up front so HTTP Range Requests can stream the
//   header before any media bytes — render workers fetch source bytes via
//   `Range: bytes=...` instead of downloading whole multi-GB files.
async function reencodeSource(
  inputPath: string,
  outputVideoPath: string,
  outputAudioPath: string,
): Promise<void> {
  await checkBinaryAvailable("ffmpeg");

  await runFfmpeg([
    "-y",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-vf",
    "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2",
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-level:v",
    "4.1",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "medium",
    "-crf",
    "20",
    // Fixed-interval keyframes for fast inline seeking — see comment above.
    "-g",
    "60",
    "-keyint_min",
    "60",
    "-sc_threshold",
    "0",
    "-movflags",
    "+faststart",
    "-an",
    outputVideoPath,
  ]);

  // Audio: libmp3lame 192 kbps stereo. Tolerate sources with no audio track.
  try {
    await runFfmpeg([
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:a:0",
      "-vn",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      "-ac",
      "2",
      outputAudioPath,
    ]);
  } catch (err) {
    logger.warn(
      { input: inputPath, error: String(err) },
      "audio extraction failed — source likely has no audio track",
    );
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 30 * 60 * 1000, // 30 min cap per pass
    });
    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) =>
      reject(new Error(`ffmpeg failed to start: ${err.message}`)),
    );
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `ffmpeg exited with code ${code}. stderr tail: ${stderr.slice(-500)}`,
          ),
        );
    });
  });
}

// ── Processor factory ─────────────────────────────────────────────────────────

/**
 * Clip Ingest Processor
 *
 * Processes a ClipIngestPayload { source_video_id, library_id }.
 * The source_videos row must already exist (created by whoever enqueued the job).
 *
 * Ingest state machine:
 *   pending → downloading → processing → labeling  (success)
 *   pending → download_failed                       (yt-dlp error)
 *   pending → processing_failed                     (any step 7+ error)
 *   pending → archived                              (SHA-256 duplicate)
 */
export function createClipIngestProcessor(
  db: DrizzleClient,
  queues: { clipLabel: Queue; clipLabelBatch: Queue; clipExtract: Queue },
) {
  return async (job: Job<ClipIngestPayload>): Promise<void> => {
    // 1. Validate payload
    const parseResult = ClipIngestPayloadSchema.safeParse(job.data);
    if (!parseResult.success) {
      const errorMessage = `Invalid clip-ingest payload: ${parseResult.error.message}`;
      logger.error(
        { bullmq_job_id: job.id, errors: parseResult.error.errors },
        errorMessage,
      );
      throw new Error(errorMessage);
    }

    const { source_video_id, library_id } = parseResult.data;
    logger.info(
      { source_video_id, library_id },
      "clip-ingest processor invoked",
    );

    // Track temp file path for cleanup in finally block
    let tempFilePath: string | null = null;

    try {
      // 2. Load source_video row and library settings in parallel
      const [[sourceVideo], [library]] = await Promise.all([
        db
          .select()
          .from(sourceVideos)
          .where(eq(sourceVideos.id, source_video_id))
          .limit(1),
        db
          .select({
            clip_storage_strategy: clipLibraries.clip_storage_strategy,
            storage_backend: clipLibraries.storage_backend,
            storage_root: clipLibraries.storage_root,
          })
          .from(clipLibraries)
          .where(eq(clipLibraries.id, library_id))
          .limit(1),
      ]);

      if (!sourceVideo) {
        throw new Error(`source_video not found: ${source_video_id}`);
      }

      if (!library) {
        throw new Error(`library not found: ${library_id}`);
      }

      // Skip only truly terminal states — clips already inserted or video is an intentional duplicate/no-content.
      // download_failed / processing_failed / downloading / processing are retriable: reset to pending and proceed.
      const TERMINAL_STATUSES = ["labeling", "ready", "archived"] as const;
      if (
        (TERMINAL_STATUSES as readonly string[]).includes(
          sourceVideo.ingest_status,
        )
      ) {
        logger.info(
          { source_video_id, ingest_status: sourceVideo.ingest_status },
          "source_video already complete — skipping",
        );
        return;
      }

      // Reset any prior failure state so this attempt starts clean
      if (sourceVideo.ingest_status !== "pending") {
        logger.info(
          { source_video_id, ingest_status: sourceVideo.ingest_status },
          "source_video in retriable state — resetting to pending",
        );
        await db
          .update(sourceVideos)
          .set({
            ingest_status: "pending",
            error_message: null,
            updated_at: new Date(),
          })
          .where(eq(sourceVideos.id, source_video_id));
      }

      // 3. Mark as downloading
      await db
        .update(sourceVideos)
        .set({
          ingest_status: "downloading",
          ingest_started_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(sourceVideos.id, source_video_id));

      // 4 / 5 / 6. Resolve video file path
      let videoPath: string;

      if (sourceVideo.source_url) {
        // 4. Download from URL using yt-dlp
        try {
          tempFilePath = await downloadWithYtDlp(
            sourceVideo.source_url,
            source_video_id,
          );
          videoPath = tempFilePath;

          logger.info(
            { source_video_id, video_path: videoPath },
            "video downloaded",
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await db
            .update(sourceVideos)
            .set({
              ingest_status: "download_failed",
              error_message: msg,
              updated_at: new Date(),
            })
            .where(eq(sourceVideos.id, source_video_id));

          throw new Error(`Download failed for ${source_video_id}: ${msg}`);
        }
      } else if (sourceVideo.source_file_path) {
        // 5. Use local upload path directly
        videoPath = sourceVideo.source_file_path;
        logger.info(
          { source_video_id, video_path: videoPath },
          "using local source_file_path",
        );
      } else {
        // 6. No source — cannot proceed
        throw new Error(
          `source_video ${source_video_id} has no source_url or source_file_path`,
        );
      }

      // 7. Mark as processing
      await db
        .update(sourceVideos)
        .set({
          ingest_status: "processing",
          updated_at: new Date(),
        })
        .where(eq(sourceVideos.id, source_video_id));

      // From here, any error becomes processing_failed
      try {
        // 8. SHA-256 dedup check
        logger.info({ source_video_id }, "hashing video file");
        const contentHash = await hashFile(videoPath);

        const dupRows = await db
          .select({ id: sourceVideos.id })
          .from(sourceVideos)
          .where(
            sql`${sourceVideos.content_hash} = ${contentHash} AND ${sourceVideos.id} != ${source_video_id}`,
          )
          .limit(1);

        if (dupRows.length > 0) {
          const existingId = dupRows[0]!.id;
          logger.info(
            {
              source_video_id,
              duplicate_of: existingId,
              content_hash: contentHash,
            },
            "duplicate detected — archiving",
          );

          await db
            .update(sourceVideos)
            .set({
              ingest_status: "archived",
              error_message: `Duplicate of ${existingId}`,
              content_hash: contentHash,
              updated_at: new Date(),
            })
            .where(eq(sourceVideos.id, source_video_id));

          return; // Not an error — expected path
        }

        // Store hash (non-duplicate)
        await db
          .update(sourceVideos)
          .set({ content_hash: contentHash, updated_at: new Date() })
          .where(eq(sourceVideos.id, source_video_id));

        // 9. Probe video metadata
        logger.info({ source_video_id }, "probing video metadata");
        const meta = await probeVideo(videoPath);

        // Derive title: source_url basename or filename, if no title set
        const derivedTitle =
          sourceVideo.title ??
          (sourceVideo.source_url
            ? (basename(sourceVideo.source_url).split("?")[0] ?? "untitled")
            : basename(videoPath));

        await db
          .update(sourceVideos)
          .set({
            width: meta.width,
            height: meta.height,
            codec: meta.codec,
            fps: meta.fps,
            duration_ms: meta.duration_ms,
            title: derivedTitle,
            updated_at: new Date(),
          })
          .where(eq(sourceVideos.id, source_video_id));

        logger.info(
          {
            source_video_id,
            width: meta.width,
            height: meta.height,
            fps: meta.fps,
            duration_ms: meta.duration_ms,
          },
          "video metadata probed",
        );

        // 10. Re-encode source → H.264 1080p MP4 + libmp3lame MP3 sidecar.
        // ref_base anchors the on-disk layout AND becomes the prefix every
        // clip inherits. Built from the source-identity fields the API
        // wrote at insert time (movie/series/youtube/stock/upload). Legacy
        // rows that pre-date 2026-06-05 (no source_kind, no work_slug) fall
        // back to the UUID so they remain ingestable until backfilled.
        let refBase: string;
        try {
          refBase = buildRefBase(sourceVideo);
        } catch (err) {
          logger.warn(
            {
              source_video_id,
              source_kind: sourceVideo.source_kind,
              error: err instanceof Error ? err.message : String(err),
            },
            "ref_base could not be composed — falling back to source_video_id",
          );
          refBase = source_video_id;
        }

        // {storage_root or LOCAL_MEDIA_ROOT}/clips/sources/{ref_base}/source.{mp4,mp3}
        const videoStorageKey = `clips/sources/${refBase}/source.mp4`;
        const audioStorageKey = `clips/sources/${refBase}/source.mp3`;
        const destVideoPath = resolveStoragePath(library, videoStorageKey);
        const destAudioPath = resolveStoragePath(library, audioStorageKey);
        const destDir = join(destVideoPath, "..");
        const cdnUrl = resolveCdnUrl(library, videoStorageKey);

        await mkdir(destDir, { recursive: true });

        logger.info(
          { source_video_id, ref_base: refBase, dest_dir: destDir },
          "re-encoding source to H.264 + MP3 sidecar",
        );

        await reencodeSource(videoPath, destVideoPath, destAudioPath);

        await db
          .update(sourceVideos)
          .set({
            ref_base: refBase,
            storage_key: videoStorageKey,
            audio_storage_key: audioStorageKey,
            cdn_url: cdnUrl,
            updated_at: new Date(),
          })
          .where(eq(sourceVideos.id, source_video_id));

        // 11. Detect scenes on the re-encoded file, then fold sub-3-s scenes
        // forward into their adjacent neighbour. We don't DROP micro-clips
        // (information loss), we STITCH them: if a scene is shorter than
        // 3 s we extend its end_ms to the next scene's end_ms (merge into
        // the next clip) and keep walking. If the last scene ends up under
        // 3 s with no next, it merges backward into the previous one.
        //
        // Net effect: every emitted clip is ≥3 s (except a single source
        // shorter than 3 s overall, which we keep as the only clip), no
        // splice carries a sub-3-s artefact, and assemblies can still grab
        // any clip whole without worrying about minimum duration.
        logger.info({ source_video_id }, "running scene detection");
        const sceneResult = await detectScenes(destVideoPath);

        const MIN_SCENE_MS = 3_000;

        const rawScenes = [...sceneResult.scenes].sort(
          (a, b) => a.start_ms - b.start_ms,
        );

        const finalScenes: typeof rawScenes = [];
        if (rawScenes.length > 0) {
          let cursor = { ...rawScenes[0]! };
          for (let i = 1; i < rawScenes.length; i++) {
            const next = rawScenes[i]!;
            // Phash / motion_score / palette: keep the values from the
            // longest segment in the merge (usually cursor after extension).
            // For now we keep cursor's sidecar signals — first-frame anchor
            // for the merged clip.
            if (cursor.end_ms - cursor.start_ms < MIN_SCENE_MS) {
              cursor.end_ms = next.end_ms;
            } else {
              finalScenes.push(cursor);
              cursor = { ...next };
            }
          }
          // Trailing tail: if it's still short and there's a previous clip,
          // merge backward; otherwise emit it as-is (whole source <3 s case).
          if (
            cursor.end_ms - cursor.start_ms < MIN_SCENE_MS &&
            finalScenes.length > 0
          ) {
            finalScenes[finalScenes.length - 1]!.end_ms = cursor.end_ms;
          } else {
            finalScenes.push(cursor);
          }
        }

        if (finalScenes.length === 0) {
          logger.warn(
            { source_video_id, raw_scenes: sceneResult.scenes.length },
            "no scenes detected — archiving source video",
          );
          await db
            .update(sourceVideos)
            .set({
              ingest_status: "archived",
              error_message: "No scenes detected",
              updated_at: new Date(),
            })
            .where(eq(sourceVideos.id, source_video_id));
          return;
        }

        logger.info(
          {
            source_video_id,
            raw_scene_count: sceneResult.scenes.length,
            merged_clip_count: finalScenes.length,
            detector: sceneResult.detector_used,
          },
          "scene detection + sub-3s merge complete",
        );

        // 12. Insert clip rows in a transaction with clip_index + external_ref
        // + per-scene visual signals (phash / motion_score / palette).
        // Pre-generate IDs so prev/next pointers can be set before the insert.
        const clipRows = finalScenes.map((scene, idx) => ({
          id: randomUUID(),
          library_id,
          source_video_id,
          start_ms: scene.start_ms,
          end_ms: scene.end_ms,
          clip_index: idx,
          external_ref: composeExternalRef(refBase, idx),
          // Sidecar fields are optional — older sidecar omits, fall back to null.
          phash:
            scene.phash != null ? BigInt(scene.phash) : (null as bigint | null),
          motion_score: scene.motion_score ?? null,
          palette_dominant_hex: scene.palette_hex ?? null,
          review_status: "pending" as const,
          prev_clip_id: null as string | null,
          next_clip_id: null as string | null,
        }));

        for (let i = 0; i < clipRows.length; i++) {
          if (i > 0) clipRows[i]!.prev_clip_id = clipRows[i - 1]!.id;
          if (i < clipRows.length - 1)
            clipRows[i]!.next_clip_id = clipRows[i + 1]!.id;
        }

        const clipIds = await db.transaction(async (tx) => {
          const inserted = await tx
            .insert(clips)
            .values(clipRows)
            .returning({ id: clips.id });
          return inserted.map((r) => r.id);
        });

        logger.info(
          { source_video_id, clip_count: clipIds.length },
          "clips inserted",
        );

        // 13. Update source_video: clip_count, status → labeling, completed_at
        await db
          .update(sourceVideos)
          .set({
            clip_count: clipIds.length,
            ingest_status: "labeling",
            ingest_completed_at: new Date(),
            updated_at: new Date(),
          })
          .where(eq(sourceVideos.id, source_video_id));

        // 14. Increment clip_libraries.clip_count
        await db.execute(
          sql`UPDATE clip_libraries SET clip_count = clip_count + ${clipIds.length} WHERE id = ${library_id}`,
        );

        // 15. Dispatch a single clip-label-batch job for the whole source.
        // The batch processor walks clips in clip_index order and threads
        // prev scene_context forward so Gemini doesn't hallucinate on the
        // sub-second clips that the removed 3s filter now lets through.
        // The per-clip clip-label queue stays for HITL re-label / retag.
        await queues.clipLabelBatch.add(
          "label-source",
          { source_video_id, library_id },
          {
            jobId: `clip-label-batch-${source_video_id}`,
            removeOnComplete: true,
          },
        );

        // 16. Materialized clip extraction is retired — the inline strategy
        // (seek into source.mp4 at start_ms/end_ms via OffthreadVideo) is
        // the only supported render path. The clipExtract queue remains in
        // the worker registry for back-compat reads but no new jobs are
        // dispatched here. clip_storage_strategy column kept for legacy data.
        void queues.clipExtract;

        logger.info(
          { source_video_id, clip_count: clipIds.length },
          "clip-ingest complete — clip-label jobs dispatched",
        );
      } catch (err) {
        // Processing failure (step 8+)
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(
          { source_video_id, error: msg },
          "clip-ingest processing failed",
        );

        await db
          .update(sourceVideos)
          .set({
            ingest_status: "processing_failed",
            error_message: msg,
            updated_at: new Date(),
          })
          .where(eq(sourceVideos.id, source_video_id));

        throw err; // Let BullMQ retry
      }
    } finally {
      // Clean up temp file from yt-dlp download
      if (tempFilePath) {
        try {
          await unlink(tempFilePath);
          logger.info({ temp_file: tempFilePath }, "temp file cleaned up");
        } catch (cleanupErr) {
          // Non-fatal: log and continue
          logger.warn(
            { temp_file: tempFilePath, error: String(cleanupErr) },
            "failed to clean up temp file",
          );
        }
      }
    }
  };
}
