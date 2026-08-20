/**
 * Clip Label Batch Processor
 *
 * One job per source_video. Loads every clip ordered by clip_index, then
 * walks them in sequence calling labelOneClip with the previous clip's
 * scene_context threaded in. Solves the "Gemini hallucinates on micro-clips"
 * problem from removing the 3 s minimum: a 500 ms clip now gets the temporal
 * context of what came right before it, which anchors the description.
 *
 * Per-library labeling_concurrency still applies inside labelOneClip via
 * SimpleConcurrencyLimiter, so two batches running concurrently on the
 * same library don't double-saturate the Gemini pool.
 *
 * Idempotent: clips already at labeling_step='done' are skipped. Failure
 * mid-loop throws and BullMQ retries — already-completed clips are
 * re-skipped on retry, so the run resumes from the failure point.
 *
 * Short-circuit: if two consecutive clips are rejected by Gemini, we
 * STOP injecting context (the run was likely a credits sequence or static
 * title card stretch). prev_context resets when a labeled clip lands again.
 */
import type { Job, Queue } from "bullmq";
import { asc, eq } from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";
import { clips, sourceVideos, clipLibraries } from "@repo/db";
import { ClipLabelBatchPayloadSchema } from "@repo/contracts";
import type { ClipLabelBatchPayload } from "@repo/contracts";
import { createContextLogger } from "@repo/logger";
import { checkSidecarHealth } from "./sidecar-client.js";
import { isGeminiVisionAvailable } from "../utils/gemini-vision.js";
import { labelOneClip } from "./label-one-clip.js";
import { resolveStoragePath } from "../utils/storage-resolver.js";

const logger = createContextLogger("clip-label-batch");

export function createClipLabelBatchProcessor(
  db: DrizzleClient,
  queues: { clipEmbed: Queue },
) {
  return async (job: Job<ClipLabelBatchPayload>): Promise<void> => {
    const parseResult = ClipLabelBatchPayloadSchema.safeParse(job.data);
    if (!parseResult.success) {
      throw new Error(
        `Invalid clip-label-batch payload: ${parseResult.error.message}`,
      );
    }

    const { source_video_id, library_id } = parseResult.data;
    logger.info(
      { source_video_id, library_id, bullmq_job_id: job.id },
      "clip-label-batch processor invoked",
    );

    // Health checks done once for the whole batch — cheaper than per-clip.
    const [{ audioFace }, geminiOk] = await Promise.all([
      checkSidecarHealth(),
      isGeminiVisionAvailable(),
    ]);
    void audioFace;
    if (!geminiOk) {
      throw new Error(
        `Gemini pool unavailable for source ${source_video_id} — will retry`,
      );
    }

    const [sourceVideo] = await db
      .select()
      .from(sourceVideos)
      .where(eq(sourceVideos.id, source_video_id))
      .limit(1);
    if (!sourceVideo)
      throw new Error(`source_video not found: ${source_video_id}`);
    if (!sourceVideo.storage_key) {
      throw new Error(`source_video has no storage_key: ${source_video_id}`);
    }

    const [library] = await db
      .select()
      .from(clipLibraries)
      .where(eq(clipLibraries.id, library_id))
      .limit(1);
    if (!library) throw new Error(`clip_library not found: ${library_id}`);

    const videoPath = resolveStoragePath(library, sourceVideo.storage_key);

    const allClips = await db
      .select()
      .from(clips)
      .where(eq(clips.source_video_id, source_video_id))
      .orderBy(asc(clips.clip_index));

    if (allClips.length === 0) {
      logger.warn({ source_video_id }, "no clips to label — nothing to do");
      return;
    }

    logger.info(
      { source_video_id, clip_count: allClips.length },
      "labeling clips in clip_index order with prev_context",
    );

    let prevSceneContext: string | null = null;
    let consecutiveRejects = 0;

    for (let i = 0; i < allClips.length; i++) {
      const clip = allClips[i]!;
      // Already done — skip but keep scene_context flowing so the next
      // labeled clip sees real context, not nothing.
      if (clip.labeling_step === "done") {
        if (clip.is_usable === false) {
          consecutiveRejects++;
        } else {
          prevSceneContext = clip.scene_context ?? null;
          consecutiveRejects = 0;
        }
        continue;
      }

      // Don't inject stale context after 2 consecutive Gemini rejects —
      // we're probably in a credits / black-frame stretch and any leftover
      // scene_context would mislead the next valid clip.
      const ctxForThisClip = consecutiveRejects >= 2 ? null : prevSceneContext;

      try {
        const result = await labelOneClip({
          db,
          queues,
          clip,
          sourceVideo,
          library,
          videoPath,
          prevSceneContext: ctxForThisClip,
        });
        if (result.rejected) {
          consecutiveRejects++;
        } else {
          prevSceneContext = result.sceneContext;
          consecutiveRejects = 0;
        }
      } catch (err) {
        logger.error(
          {
            source_video_id,
            clip_id: clip.id,
            clip_index: clip.clip_index,
            error: err instanceof Error ? err.message : String(err),
          },
          "clip failed inside batch — throwing to let BullMQ retry",
        );
        throw err;
      }

      if ((i + 1) % 25 === 0) {
        logger.info(
          {
            source_video_id,
            progress: `${i + 1}/${allClips.length}`,
          },
          "batch progress",
        );
      }
    }

    logger.info(
      { source_video_id, clip_count: allClips.length },
      "clip-label-batch complete",
    );
  };
}
