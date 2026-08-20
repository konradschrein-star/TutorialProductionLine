import type { Job, Queue } from "bullmq";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  DramaImageGenPayload,
  DramaVideoGenPayload,
  DramaAssemblePayload,
} from "@repo/contracts";
import { DramaImageGenPayloadSchema } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { eq } from "drizzle-orm";
import { contentJobs } from "@repo/db";
import {
  getDramaClipsByJob,
  updateDramaClipImagePath,
  updateDramaClipPrompt,
  markDramaClipImageFailed,
  updateDramaClipVideoPath,
  markDramaClipVideoFailed,
  getDramaCharactersByIds,
  updateCharacterThumbnailUrl,
} from "@repo/db/repositories";
import {
  requestImage,
  downloadMedia,
} from "../../utils/media-gateway/index.js";
import { updateJobStatus } from "../../utils/update-job-status.js";
import { processSlowVideoClip, pickMotionPrompt } from "./slow-video-clip.js";
import {
  isContentPolicyError,
  rewriteImagePromptForPolicy,
} from "./prompt-rewriter.js";

const MEDIA_BASE =
  process.env["DRAMA_MEDIA_DIR"] ?? "/opt/content-forge/media/long-form-drama";
// Lab clone capacity is 49 and the operator has IP-rotation + account
// rotation in place — so 8 concurrent is fine. If you're seeing
// UNUSUAL_ACTIVITY storms at this concurrency the rotation pool is
// busted upstream, not ours. Env-overridable per job for testing.
const CONCURRENT_IMAGE_GEN = Number(
  process.env["DRAMA_CONCURRENT_IMAGE_GEN"] ?? "8",
);

const VEO_MOTION_PROMPT =
  "Static camera, no camera movement. Idle-animation motion only: the people in frame stand or sit still, breathing slowly, blinking occasionally, with only the tiniest involuntary shifts in posture. No actions, no gestures, no head turns, no expression changes, no walking, no talking. Treat the frame as an idle state — alive but not performing. Gentle ambient detail (slight hair movement, soft light) is fine. The clip should loop without an obvious 'restart' moment.";

export function createDramaImageGenProcessor(
  db: DrizzleClient,
  queues: {
    dramaVideoGen: Queue<DramaVideoGenPayload>;
    dramaAssemble: Queue<DramaAssemblePayload>;
  },
) {
  return async (job: Job<DramaImageGenPayload>) => {
    const { jobId } = DramaImageGenPayloadSchema.parse(job.data);

    console.log(
      JSON.stringify({
        level: "info",
        message: "Drama image gen starting",
        job_id: jobId,
      }),
    );

    try {
      const clips = await getDramaClipsByJob(jobId);
      const pending = clips.filter(
        (c) => c.image_status === "pending" && c.image_prompt,
      );

      console.log(
        JSON.stringify({
          level: "info",
          message: "Drama image gen clips loaded",
          job_id: jobId,
          total_clips: clips.length,
          pending_clips: pending.length,
        }),
      );

      // Fetch all metadata once upfront
      const [jobMeta] = await db
        .select({ metadata: contentJobs.metadata })
        .from(contentJobs)
        .where(eq(contentJobs.id, jobId))
        .limit(1);

      const meta = jobMeta?.metadata as Record<string, unknown> | null;
      const dramaConfig = meta?.["drama_config"] as
        | { characterIds?: string[] }
        | undefined;
      const renderMode =
        (meta?.["render_mode"] as string | undefined) ?? "KEN_BURNS";
      const audioPath = meta?.["drama_audio_path"] as string | undefined;

      if (!audioPath) {
        throw new Error("drama_audio_path missing from job metadata");
      }

      // STOCK_CHAIN_FULL / STOCK_CHAIN_HOOKED: every body slot is
      // already video_status='done' (library-backed). The hook clips
      // (HOOKED only) still need text-to-video, so we route the same
      // way as DIRECT_T2V — video-gen short-circuits the library
      // rows automatically and only submits the hook clips to VEO.
      if (
        renderMode === "STOCK_CHAIN_FULL" ||
        renderMode === "STOCK_CHAIN_HOOKED"
      ) {
        for (const c of clips) {
          if (c.image_status !== "done") {
            await updateDramaClipImagePath(c.id, "(stock_chain - no image)");
          }
        }
        await updateJobStatus(db, jobId, "DRAMA_VIDEO_GENERATING");
        await queues.dramaVideoGen.add(
          "drama-video-gen",
          { jobId, audioPath, renderMode },
          { jobId: `drama-video-gen-${jobId}`, attempts: 1 },
        );
        console.log(
          JSON.stringify({
            level: "info",
            message: "STOCK_CHAIN — forwarding to video-gen",
            job_id: jobId,
            render_mode: renderMode,
            clips: clips.length,
          }),
        );
        return;
      }

      // DIRECT_T2V: skip image generation entirely. Mark every clip's
      // image_path to a sentinel string so existing repo helper
      // (updateDramaClipImagePath) flips image_status to 'done' for us,
      // then jump straight to drama-video-gen which submits the clip's
      // image_prompt to Veo text-to-video.
      if (renderMode === "DIRECT_T2V") {
        for (const c of clips) {
          if (c.image_status !== "done") {
            await updateDramaClipImagePath(c.id, "(direct_t2v - no image)");
          }
        }
        console.log(
          JSON.stringify({
            level: "info",
            message: "DIRECT_T2V mode — skipping image-gen entirely",
            job_id: jobId,
            clips: clips.length,
          }),
        );
        await updateJobStatus(db, jobId, "DRAMA_VIDEO_GENERATING");
        await queues.dramaVideoGen.add(
          "drama-video-gen",
          { jobId, audioPath, renderMode: "DIRECT_T2V" },
          { jobId: `drama-video-gen-${jobId}`, attempts: 1 },
        );
        return;
      }

      // Collect every character ID referenced by any clip + the job's cast
      // fallback, then load all of them in ONE query so per-clip lookup is O(1).
      const allCharacterIds = new Set<string>();
      for (const c of clips) {
        for (const cid of c.character_ids ?? []) allCharacterIds.add(cid);
      }
      for (const cid of dramaConfig?.characterIds ?? []) {
        allCharacterIds.add(cid);
      }

      const allCharacters = allCharacterIds.size
        ? await getDramaCharactersByIds([...allCharacterIds])
        : [];
      const characterById = new Map(allCharacters.map((c) => [c.id, c]));
      const jobLevelFallbackRefs = (dramaConfig?.characterIds ?? [])
        .map((id) => characterById.get(id)?.thumbnail_url)
        .filter((u): u is string => !!u);

      console.log(
        JSON.stringify({
          level: "info",
          message: "Character library loaded for job",
          job_id: jobId,
          distinct_characters: allCharacters.length,
          job_level_fallback_refs: jobLevelFallbackRefs.length,
          render_mode: renderMode,
        }),
      );

      // Nano Banana limit: max 6 reference images per call.
      const MAX_REFS_PER_CLIP = 6;
      const refsForClip = (
        clipCharIds: string[] | null | undefined,
      ): string[] => {
        const refs = (clipCharIds ?? [])
          .map((id) => characterById.get(id)?.thumbnail_url)
          .filter((u): u is string => !!u)
          .slice(0, MAX_REFS_PER_CLIP);
        // Fall back to the job-level cast if the clip has no resolvable refs
        // (e.g. legacy jobs created before per-clip character_ids existed).
        return refs.length > 0
          ? refs
          : jobLevelFallbackRefs.slice(0, MAX_REFS_PER_CLIP);
      };

      const outputDir = join(MEDIA_BASE, jobId, "images");
      await mkdir(outputDir, { recursive: true });

      let firstSuccessfulOutputUrl: string | null = null;

      // Circuit breaker: after N consecutive UNUSUAL_ACTIVITY failures
      // (lab-clone IP detection) we stop submitting NEW clips for this
      // drama. Avoids the case where 29 clips × 3 retries each spams ~90
      // submissions into a service that's clearly down and reinforces the
      // detection pattern. In-flight calls continue; only new ones bail.
      const UNUSUAL_ACTIVITY_TRIP_THRESHOLD = 5;
      let unusualActivityRunningCount = 0;
      let circuitBroken = false;
      const recordError = (err: unknown) => {
        if (/UNUSUAL_ACTIVITY/i.test(String(err))) {
          unusualActivityRunningCount += 1;
          if (unusualActivityRunningCount >= UNUSUAL_ACTIVITY_TRIP_THRESHOLD) {
            circuitBroken = true;
          }
        }
      };
      const recordSuccess = () => {
        unusualActivityRunningCount = 0;
      };

      // Process images in batches; for SLOW_VIDEO, pre-submit Veo i2v as each image lands
      for (let i = 0; i < pending.length; i += CONCURRENT_IMAGE_GEN) {
        if (circuitBroken) {
          console.warn(
            JSON.stringify({
              level: "warn",
              message:
                "Image-gen circuit breaker tripped — too many consecutive UNUSUAL_ACTIVITY errors. Aborting remaining clips.",
              job_id: jobId,
              consecutive_failures: unusualActivityRunningCount,
              clips_skipped: pending.length - i,
            }),
          );
          break;
        }
        const batch = pending.slice(i, i + CONCURRENT_IMAGE_GEN);
        await Promise.all(
          batch.map(async (clip) => {
            const imagePath = join(outputDir, `clip-${clip.clip_index}.jpg`);
            const clipRefs = refsForClip(clip.character_ids);
            try {
              try {
                const imageRef = await requestImage(clip.image_prompt!, {
                  format: "LONG_FORM_DRAMA",
                  context: `drama:clip:${clip.clip_index}`,
                });
                await downloadMedia(imageRef, imagePath);
              } catch (firstErr) {
                // Auto-rewrite path: if Nano Banana flagged the prompt as a
                // content-policy violation (RAI_FILTER / SAFETY_BLOCK /
                // etc.), Gemini rewrites the scene to dodge whatever it
                // tripped on while preserving emotional intent. We retry
                // once with the rewritten prompt and persist it to the
                // clip so downstream code (and re-runs) use the clean one.
                if (!isContentPolicyError(firstErr)) throw firstErr;
                console.warn(
                  JSON.stringify({
                    level: "warn",
                    message:
                      "Content policy hit, rewriting prompt and retrying",
                    job_id: jobId,
                    clip_index: clip.clip_index,
                    error: String(firstErr).slice(0, 200),
                  }),
                );
                const rewritten = await rewriteImagePromptForPolicy(
                  clip.image_prompt!,
                  String(firstErr),
                );
                await updateDramaClipPrompt(clip.id, rewritten);
                const rewrittenRef = await requestImage(rewritten, {
                  format: "LONG_FORM_DRAMA",
                  context: `drama:clip:${clip.clip_index}:rewritten`,
                });
                await downloadMedia(rewrittenRef, imagePath);
                console.log(
                  JSON.stringify({
                    level: "info",
                    message: "Rewritten prompt succeeded",
                    job_id: jobId,
                    clip_index: clip.clip_index,
                  }),
                );
              }
              recordSuccess();
              if (!firstSuccessfulOutputUrl)
                firstSuccessfulOutputUrl = imagePath;
              await updateDramaClipImagePath(clip.id, imagePath);
              console.log(
                JSON.stringify({
                  level: "info",
                  message: "Drama clip image generated",
                  job_id: jobId,
                  clip_id: clip.id,
                  clip_index: clip.clip_index,
                  image_path: imagePath,
                }),
              );

              // Pipeline parallelism: run the full per-clip i2v pipeline
              // (lab clone → loop → chained Ken Burns) INLINE, the moment
              // this clip's image is ready. With CONCURRENT_IMAGE_GEN
              // workers each doing image + video back-to-back, image-gen
              // and video-gen overlap completely instead of running serially.
              if (renderMode === "SLOW_VIDEO") {
                try {
                  const videoPath = join(
                    MEDIA_BASE,
                    jobId,
                    "videos",
                    `clip-${clip.clip_index}.mp4`,
                  );
                  await mkdir(join(MEDIA_BASE, jobId, "videos"), {
                    recursive: true,
                  });
                  const durationSec = Math.max(
                    (clip.end_ms - clip.start_ms) / 1000,
                    1,
                  );
                  await processSlowVideoClip({
                    imagePath,
                    characterRefs: clipRefs,
                    motionPrompt: pickMotionPrompt(clip.clip_index),
                    durationSec,
                    clipIdx: clip.clip_index,
                    videoPath,
                  });
                  await updateDramaClipVideoPath(clip.id, videoPath);
                  console.log(
                    JSON.stringify({
                      level: "info",
                      message: "Clip video generated inline (parallel)",
                      job_id: jobId,
                      clip_index: clip.clip_index,
                      video_path: videoPath,
                    }),
                  );
                } catch (videoErr) {
                  // Non-fatal: video-gen processor will retry as cleanup
                  console.warn(
                    JSON.stringify({
                      level: "warn",
                      message:
                        "Inline video gen failed, video-gen will retry as cleanup",
                      job_id: jobId,
                      clip_index: clip.clip_index,
                      error: String(videoErr).slice(0, 200),
                    }),
                  );
                  await markDramaClipVideoFailed(clip.id).catch(() => {});
                }
              }
            } catch (err) {
              recordError(err);
              console.error(
                JSON.stringify({
                  level: "error",
                  message: "Image gen failed for clip",
                  job_id: jobId,
                  clip_id: clip.id,
                  clip_index: clip.clip_index,
                  error: String(err),
                }),
              );
              await markDramaClipImageFailed(clip.id);
            }
          }),
        );
      }

      // Legacy first-time character thumbnail seed (kept for jobs whose cast
      // characters somehow have no thumbnail and there were no per-clip refs
      // for them either). The autonomous generator usually fills these in
      // immediately, so this is just a belt-and-suspenders fallback.
      if (firstSuccessfulOutputUrl) {
        const charsMissingThumb = allCharacters.filter((c) => !c.thumbnail_url);
        if (charsMissingThumb.length > 0) {
          await Promise.all(
            charsMissingThumb.map((c) =>
              updateCharacterThumbnailUrl(
                c.id,
                firstSuccessfulOutputUrl!,
              ).catch(() => {}),
            ),
          );
        }
      }

      // Tolerate up to 30% image-gen failures — a 25-clip drama is still
      // perfectly watchable with 17-18 scenes. Only abort if more than that
      // failed, since the resulting xfade chain would have visible gaps and
      // the script timing would mis-align. The old hardcoded ">2 = abort"
      // killed entire dramas the moment Nano Banana hit one rate-limit
      // burst.
      const updatedClips = await getDramaClipsByJob(jobId);
      const failed = updatedClips.filter((c) => c.image_status === "failed");
      const failRatio = failed.length / Math.max(updatedClips.length, 1);
      if (failRatio > 0.3) {
        throw new Error(
          `${failed.length}/${updatedClips.length} image generations failed (${(failRatio * 100).toFixed(0)}%) — exceeds 30% threshold`,
        );
      }

      console.log(
        JSON.stringify({
          level: "info",
          message: "Drama image gen complete",
          job_id: jobId,
          total: updatedClips.length,
          done: updatedClips.filter((c) => c.image_status === "done").length,
          failed: failed.length,
          veo_presubmitted:
            renderMode === "SLOW_VIDEO"
              ? updatedClips.filter((c) => c.veo_job_id).length
              : 0,
        }),
      );

      if (renderMode === "SLOW_VIDEO") {
        await updateJobStatus(db, jobId, "DRAMA_VIDEO_GENERATING");
        await queues.dramaVideoGen.add(
          "drama-video-gen",
          { jobId, audioPath, renderMode: "SLOW_VIDEO" },
          { jobId: `drama-video-gen-${jobId}`, attempts: 1 },
        );
        console.log(
          JSON.stringify({
            level: "info",
            message: "Drama video gen job queued",
            job_id: jobId,
          }),
        );
      } else {
        await updateJobStatus(db, jobId, "DRAMA_ASSEMBLING");
        await queues.dramaAssemble.add(
          "drama-assemble",
          { jobId, audioPath, renderMode: "KEN_BURNS" },
          { jobId: `drama-assemble-${jobId}`, attempts: 1 },
        );
        console.log(
          JSON.stringify({
            level: "info",
            message: "Drama assemble job queued",
            job_id: jobId,
            audio_path: audioPath,
          }),
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        JSON.stringify({
          level: "error",
          message: "Drama image gen processor failed",
          job_id: jobId,
          error: msg,
        }),
      );
      await updateJobStatus(db, jobId, "FAILED_DRAMA_PIPELINE", msg).catch(
        () => {},
      );
      throw err;
    }
  };
}
