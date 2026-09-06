/**
 * Tutorial Stitch Processor
 *
 * Handles the TUTORIAL_STITCH queue lane.
 *
 * Triggered after ALL child segment jobs of a SIX_MIN_STITCH parent are COMPLETED.
 * Uses the ffmpeg concat demuxer to join their final_path MP4s in segment_index order.
 *
 * Strategy:
 *   1. Load children ordered by segment_index.
 *   2. Write an ffmpeg concat list file.
 *   3. Try stream-copy (-c copy). If it fails (codec mismatch across recordings),
 *      retry with full re-encode (-c:v libx264 -c:a aac).
 *   4. Set parent final_path + status COMPLETED.
 *   5. On any error: set parent status FAILED_SPLICE.
 */
import type { Job, Queue } from "bullmq";
import { join, dirname } from "node:path";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DrizzleClient } from "@repo/db";
import {
  getTutorialJobById,
  updateTutorialJob,
  listTutorialJobsByParent,
  getTutorialSettings,
} from "@repo/db";
import { probeMediaDimensions } from "@repo/media-core";
import type { TutorialStitchPayload, ThumbnailPayload } from "@repo/contracts";
import { TutorialStitchPayloadSchema } from "@repo/contracts";
import { deriveLogoSubject } from "@repo/domain";
import { firstNSentences } from "../../utils/thumbnail/prompt-builder.js";
import { buildLikeSubscribeOutroArgs } from "../../utils/tutorial/like-subscribe-outro.js";
import { ensureManualTutorialThumbnail } from "../../utils/tutorial/manual-thumbnail.js";
import { resolveTutorialThumbnailContext } from "../../utils/tutorial/thumbnail-context.js";

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";
const LOCAL_MEDIA_ROOT =
  process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";

async function runConcat(
  listPath: string,
  outputPath: string,
  extraArgs: string[],
): Promise<void> {
  await execFileAsync(FFMPEG_BIN, [
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    ...extraArgs,
    "-movflags",
    "+faststart",
    "-y",
    outputPath,
  ]);
}

export function createTutorialStitchProcessor(
  db: DrizzleClient,
  queues: { thumbnail: Queue<ThumbnailPayload> },
) {
  return async (job: Job<TutorialStitchPayload>): Promise<void> => {
    const { parentJobId } = TutorialStitchPayloadSchema.parse(job.data);

    console.log(
      JSON.stringify({
        level: "info",
        message: "Tutorial stitch processor started",
        parent_job_id: parentJobId,
      }),
    );

    const parentJob = await getTutorialJobById(db, parentJobId);
    if (!parentJob) {
      throw new Error(`Parent tutorial job ${parentJobId} not found`);
    }

    try {
      await updateTutorialJob(db, parentJobId, { status: "SPLICING" });

      // Load children ordered by segment_index
      const children = await listTutorialJobsByParent(db, parentJobId);

      if (children.length === 0) {
        throw new Error(`No child segments found for parent ${parentJobId}`);
      }

      // Validate all children are COMPLETED and have final_path
      for (const child of children) {
        if (child.status !== "COMPLETED") {
          throw new Error(
            `Child segment ${child.id} (index ${child.segment_index ?? "?"}) is not COMPLETED (status: ${child.status})`,
          );
        }
        if (!child.final_path) {
          throw new Error(
            `Child segment ${child.id} (index ${child.segment_index ?? "?"}) has no final_path`,
          );
        }
      }

      // Prepare output directory and concat list
      const outputDir = join(LOCAL_MEDIA_ROOT, "tutorial", parentJobId);
      await mkdir(outputDir, { recursive: true });

      const listPath = join(outputDir, "stitch-concat.txt");
      const listContent = children
        .map((c) => `file '${c.final_path!}'`)
        .join("\n");
      await writeFile(listPath, listContent);

      const outputPath = join(outputDir, "final.mp4");

      console.log(
        JSON.stringify({
          level: "info",
          message: "Tutorial stitch: concat list written",
          parent_job_id: parentJobId,
          segment_count: children.length,
          output_path: outputPath,
        }),
      );

      // Attempt 1: stream copy (fast, no re-encode)
      let stitchError: Error | null = null;
      try {
        await runConcat(listPath, outputPath, ["-c", "copy"]);
        stitchError = null;
      } catch (err) {
        stitchError = err instanceof Error ? err : new Error(String(err));
        console.warn(
          JSON.stringify({
            level: "warn",
            message:
              "Tutorial stitch: stream copy failed, retrying with re-encode",
            parent_job_id: parentJobId,
            error: stitchError.message.slice(0, 500),
          }),
        );
      }

      // Attempt 2: full re-encode (handles codec/resolution mismatches between segments)
      if (stitchError) {
        await runConcat(listPath, outputPath, [
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "20",
          "-r",
          "30",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
        ]);
      }

      // Like & Subscribe outro on the finished long-form video (best-effort;
      // never fails a completed stitch). Same end card the single-segment
      // splice appends, so every deliverable gets one.
      try {
        const dims = await probeMediaDimensions(outputPath);
        const outroPath = join(outputDir, "final.outro.mp4");
        const argv = buildLikeSubscribeOutroArgs(outputPath, outroPath, {
          width: dims.width,
          height: dims.height,
          seed: parentJobId,
          lang: parentJob.language ?? "en",
        });
        await execFileAsync(argv[0]!, argv.slice(1), {
          maxBuffer: 1024 * 1024 * 64,
        });
        await rename(outroPath, outputPath);
      } catch (outroErr) {
        console.error(
          JSON.stringify({
            level: "warn",
            message:
              "Like/subscribe outro failed on stitch (non-fatal) — shipping without it",
            parent_job_id: parentJobId,
            error:
              outroErr instanceof Error ? outroErr.message : String(outroErr),
          }),
        );
      }

      await updateTutorialJob(db, parentJobId, {
        final_path: outputPath,
        status: "COMPLETED",
        completed_at: new Date(),
      });

      console.log(
        JSON.stringify({
          level: "info",
          message: "Tutorial stitch processor complete",
          parent_job_id: parentJobId,
          output_path: outputPath,
          segment_count: children.length,
        }),
      );

      // ── Auto thumbnail (non-blocking) ───────────────────────────────────
      // No channel is NOT a reason to skip: the format + global archetype
      // rules carry the request on their own (DECISIONS §3.2.8). The old
      // `if (parentJob.channel_id)` guard skipped channel-less stitch parents
      // silently. Mirrors enqueue-thumbnail.ts (plan A2.6).
      {
        try {
          const thumbnailContext = await resolveTutorialThumbnailContext(
            db,
            parentJob,
          );
          const settings = await getTutorialSettings(db);
          if (settings.thumbnail_generation_mode === "manual") {
            await ensureManualTutorialThumbnail(db, parentJob);
          } else {
            const excerpt = firstNSentences(parentJob.script_text ?? "", 5);
            // See splice.ts — the product name is what makes the thumbnail
            // branded rather than generic. Omitted when it cannot be derived.
            const logoSubject = deriveLogoSubject(parentJob.title);
            await queues.thumbnail.add(
              "thumbnail",
              {
                subjectKind: "tutorial_job",
                subjectId: parentJobId,
                format: "TUTORIAL_STUDIO",
                channelId: thumbnailContext.channelId,
                title: parentJob.title,
                topic: parentJob.title,
                scriptExcerpt: excerpt,
                ...(logoSubject !== null ? { logoSubject } : {}),
                language: thumbnailContext.language,
                thumbnailTextTop: thumbnailContext.thumbnailTextTop,
                thumbnailTextBottom: thumbnailContext.thumbnailTextBottom,
              },
              { jobId: `thumbnail-${parentJobId}`, attempts: 2 },
            );
          }
        } catch (thumbErr) {
          console.error(
            JSON.stringify({
              level: "warn",
              message: "Failed to enqueue tutorial thumbnail (non-fatal)",
              parent_job_id: parentJobId,
              error:
                thumbErr instanceof Error ? thumbErr.message : String(thumbErr),
            }),
          );
        }
      }
      // ── End auto thumbnail ──────────────────────────────────────────────
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      console.error(
        JSON.stringify({
          level: "error",
          message: "Tutorial stitch processor failed",
          parent_job_id: parentJobId,
          error: errorMessage,
        }),
      );

      try {
        await updateTutorialJob(db, parentJobId, {
          status: "FAILED_SPLICE",
          error_stage: "stitch",
          error_message: errorMessage,
        });
      } catch {
        // no-op — don't mask the original error
      }
      throw err;
    }
  };
}
