import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";
import { isNull } from "drizzle-orm";
import type { Job } from "bullmq";
import { eq, and } from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";
import { clips, sourceVideos, clipLibraries } from "@repo/db";
import { ClipExtractPayloadSchema } from "@repo/contracts";
import type { ClipExtractPayload } from "@repo/contracts";
import { createContextLogger } from "@repo/logger";

const execFileAsync = promisify(execFile);

const logger = createContextLogger("clip-extract");

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildCdnUrl(storageKey: string): string {
  const cdnBase = process.env["MEDIA_CDN_BASE"];
  if (cdnBase) return `${cdnBase}/media/${storageKey}`;
  const mediaHost = process.env["MEDIA_HOST"] ?? "localhost";
  const mediaPort = process.env["MEDIA_PORT"] ?? "3000";
  return `http://${mediaHost}:${mediaPort}/media/${storageKey}`;
}

async function extractThumbnail(
  sourcePath: string,
  midMs: number,
  outputPath: string,
): Promise<void> {
  await execFileAsync(
    "ffmpeg",
    [
      "-ss",
      (midMs / 1000).toFixed(3),
      "-i",
      sourcePath,
      "-frames:v",
      "1",
      "-q:v",
      "4",
      "-y",
      outputPath,
    ],
    { timeout: 30_000 },
  );
}

// Two-pass seek VP9+Opus extraction — matches clip-remotion.ts quality.
// Pre-keyframe accurate seek avoids scene bleed; VP9+Opus output is directly
// usable by Remotion's Chromium renderer and modern browsers.
async function extractClipVP9(
  sourcePath: string,
  startMs: number,
  endMs: number,
  outputPath: string,
): Promise<void> {
  const startSec = startMs / 1000;
  const durationSec = ((endMs - startMs) / 1000).toFixed(3);

  // Two-pass seek: fast-seek to 4s before target, accurate-seek the remainder.
  const fastSeekSec = Math.max(0, startSec - 4).toFixed(3);
  const accurateOffsetSec = (startSec - parseFloat(fastSeekSec)).toFixed(3);

  await execFileAsync(
    "ffmpeg",
    [
      "-ss",
      fastSeekSec,
      "-i",
      sourcePath,
      "-ss",
      accurateOffsetSec,
      "-t",
      durationSec,
      "-c:v",
      "libvpx-vp9",
      "-crf",
      "18",
      "-b:v",
      "0",
      "-row-mt",
      "1",
      "-c:a",
      "libopus",
      "-b:a",
      "128k",
      "-y",
      outputPath,
    ],
    { timeout: 180_000 },
  );
}

const EXTRACT_BATCH = Math.max(4, os.cpus().length * 2);

// ── Processor factory ─────────────────────────────────────────────────────────

/**
 * Clip Extract Processor
 *
 * For a given source_video, FFmpeg-extracts every clip that does not yet have
 * a cdn_url into its own VP9/Opus WebM file at:
 *   {LOCAL_MEDIA_ROOT}/clips/extracted/{clip_id}.webm
 *
 * VP9+Opus WebM is directly usable by clip-remotion.ts (Chromium renderer) and
 * modern browsers. Two-pass seek prevents pre-keyframe frame bleed.
 * Extraction runs in batches of EXTRACT_BATCH concurrent ffmpeg processes.
 *
 * Updates clips.storage_key and clips.cdn_url on success.
 * Idempotent: skips clips that already have cdn_url set.
 */
export function createClipExtractProcessor(db: DrizzleClient) {
  return async (job: Job<ClipExtractPayload>): Promise<void> => {
    const parseResult = ClipExtractPayloadSchema.safeParse(job.data);
    if (!parseResult.success) {
      throw new Error(
        `Invalid clip-extract payload: ${parseResult.error.message}`,
      );
    }

    const { source_video_id, library_id } = parseResult.data;
    logger.info(
      { source_video_id, library_id },
      "clip-extract processor invoked",
    );

    // Load source video to get the local file path
    const [sourceVideo] = await db
      .select({
        storage_key: sourceVideos.storage_key,
        ingest_status: sourceVideos.ingest_status,
      })
      .from(sourceVideos)
      .where(eq(sourceVideos.id, source_video_id))
      .limit(1);

    if (!sourceVideo) {
      throw new Error(`source_video not found: ${source_video_id}`);
    }

    if (!sourceVideo.storage_key) {
      throw new Error(
        `source_video ${source_video_id} has no storage_key — not yet ingested`,
      );
    }

    // Verify library exists and is materialized strategy
    const [library] = await db
      .select({ clip_storage_strategy: clipLibraries.clip_storage_strategy })
      .from(clipLibraries)
      .where(eq(clipLibraries.id, library_id))
      .limit(1);

    if (!library) {
      throw new Error(`library not found: ${library_id}`);
    }

    const localMediaRoot =
      process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";

    const sourcePath = join(localMediaRoot, sourceVideo.storage_key);
    const outputDir = join(localMediaRoot, "clips", "extracted");
    const thumbDir = join(localMediaRoot, "clips", "thumbnails");
    await Promise.all([
      mkdir(outputDir, { recursive: true }),
      mkdir(thumbDir, { recursive: true }),
    ]);

    // Fetch all clips for this source video that haven't been extracted yet
    const unextracted = await db
      .select({
        id: clips.id,
        start_ms: clips.start_ms,
        end_ms: clips.end_ms,
      })
      .from(clips)
      .where(
        and(eq(clips.source_video_id, source_video_id), isNull(clips.cdn_url)),
      );

    if (unextracted.length === 0) {
      logger.info({ source_video_id }, "no unextracted clips — nothing to do");
      return;
    }

    logger.info(
      { source_video_id, clip_count: unextracted.length },
      "starting clip extraction",
    );

    let extracted = 0;
    let failed = 0;

    for (let bi = 0; bi < unextracted.length; bi += EXTRACT_BATCH) {
      const batch = unextracted.slice(bi, bi + EXTRACT_BATCH);

      await Promise.all(
        batch.map(async (clip) => {
          const storageKey = `clips/extracted/${clip.id}.webm`;
          const outputPath = join(outputDir, `${clip.id}.webm`);
          const cdnUrl = buildCdnUrl(storageKey);

          try {
            await extractClipVP9(
              sourcePath,
              clip.start_ms,
              clip.end_ms,
              outputPath,
            );

            // Extract thumbnail at midpoint — best-effort, don't fail extract if it errors
            const midMs = Math.floor((clip.start_ms + clip.end_ms) / 2);
            const thumbStorageKey = `clips/thumbnails/${clip.id}.jpg`;
            const thumbPath = join(thumbDir, `${clip.id}.jpg`);
            let thumbnailUrl: string | undefined;
            try {
              await extractThumbnail(sourcePath, midMs, thumbPath);
              thumbnailUrl = buildCdnUrl(thumbStorageKey);
            } catch (thumbErr) {
              logger.warn(
                { clip_id: clip.id, error: String(thumbErr) },
                "thumbnail extraction failed — skipping",
              );
            }

            await db
              .update(clips)
              .set({
                storage_key: storageKey,
                cdn_url: cdnUrl,
                thumbnail_url: thumbnailUrl,
              })
              .where(eq(clips.id, clip.id));

            extracted++;
          } catch (err) {
            failed++;
            logger.error(
              {
                clip_id: clip.id,
                source_video_id,
                error: err instanceof Error ? err.message : String(err),
              },
              "clip extraction failed — continuing",
            );
          }
        }),
      );

      logger.info(
        {
          source_video_id,
          extracted,
          failed,
          remaining: unextracted.length - extracted - failed,
          progress: Math.round(
            ((bi + batch.length) / unextracted.length) * 100,
          ),
        },
        "extraction batch complete",
      );
      await job.updateProgress(
        Math.round(((bi + batch.length) / unextracted.length) * 100),
      );
    }

    logger.info(
      { source_video_id, extracted, failed, total: unextracted.length },
      "clip-extract complete",
    );

    if (failed > 0) {
      throw new Error(
        `clip-extract completed with ${failed}/${unextracted.length} failures for source_video ${source_video_id}`,
      );
    }
  };
}
