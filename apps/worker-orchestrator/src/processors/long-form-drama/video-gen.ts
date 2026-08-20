import type { Job, Queue } from "bullmq";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  DramaVideoGenPayload,
  DramaAssemblePayload,
} from "@repo/contracts";
import { DramaVideoGenPayloadSchema } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import {
  getDramaClipsByJob,
  updateDramaClipVideoPath,
  markDramaClipVideoFailed,
  getDramaCharactersByIds,
} from "@repo/db/repositories";
import { processSlowVideoClip, pickMotionPrompt } from "./slow-video-clip.js";
import { updateJobStatus } from "../../utils/update-job-status.js";
import {
  requestVideoFromText,
  downloadMedia,
} from "../../utils/media-gateway/index.js";

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";
const MEDIA_BASE =
  process.env["DRAMA_MEDIA_DIR"] ?? "/opt/content-forge/media/long-form-drama";
// Raised from 0.5 → 0.8 because VEO has a ~29% baseline failure rate per their
// own stats, so a single pass can easily fail 30–50% of clips. The self-healing
// retry will keep cycling until clips succeed or this threshold trips.
const MAX_FAIL_RATIO = 0.8;
const RETRY_DELAY_MS = 5_000;
// Backend types for parallel rendering: alternates between i2v and t2v
type DramaBackend = "VEO_I2V" | "VPS_T2V";
const DRAMA_VIDEO_BACKENDS: DramaBackend[] = ["VEO_I2V", "VPS_T2V"];
// Same idle-animation prompt image-gen uses for the inline pipeline-parallel
// path. Kept in both files so video-gen can run independently (e.g. on a
// re-queued cleanup pass) without depending on image-gen's exports.
const VEO_MOTION_PROMPT =
  "Static camera, no camera movement. Idle-animation motion only: the people in frame stand or sit still, breathing slowly, blinking occasionally, with only the tiniest involuntary shifts in posture. No actions, no gestures, no head turns, no expression changes, no walking, no talking. Treat the frame as an idle state — alive but not performing. Gentle ambient detail (slight hair movement, soft light) is fine. The clip should loop without an obvious 'restart' moment.";

export function createDramaVideoGenProcessor(
  db: DrizzleClient,
  queues: {
    dramaVideoGen: Queue<DramaVideoGenPayload>;
    dramaAssemble: Queue<DramaAssemblePayload>;
  },
) {
  return async (job: Job<DramaVideoGenPayload>) => {
    const { jobId, audioPath, renderMode } = DramaVideoGenPayloadSchema.parse(
      job.data,
    );

    console.log(
      JSON.stringify({
        level: "info",
        message: "Drama video gen starting",
        job_id: jobId,
        render_mode: renderMode,
        backends: DRAMA_VIDEO_BACKENDS,
      }),
    );

    try {
      const clips = await getDramaClipsByJob(jobId);

      // DIRECT_T2V / STOCK_CHAIN_*: skip image dependency entirely.
      // For DIRECT_T2V every clip needs a fresh VEO render.
      // For STOCK_CHAIN_FULL every clip is already video_status='done'
      // (library-backed); the eligibleT2V filter below catches that
      // and the loop processes zero clips, then we forward to assemble.
      // For STOCK_CHAIN_HOOKED only the hook clips are in the
      // eligible set; library body rows pass through.
      if (
        renderMode === "DIRECT_T2V" ||
        renderMode === "STOCK_CHAIN_FULL" ||
        renderMode === "STOCK_CHAIN_HOOKED"
      ) {
        const charIds = new Set<string>();
        for (const c of clips) {
          for (const id of c.character_ids ?? []) charIds.add(id);
        }
        const characters = charIds.size
          ? await getDramaCharactersByIds([...charIds])
          : [];
        const charById = new Map(characters.map((c) => [c.id, c]));

        const eligibleT2V = clips.filter((c) => c.video_status !== "done");
        // VUP wrapper has max_threads=8; submitting 30 in parallel just
        // queues them at VUP and adds no throughput while making it hard
        // to see what's in flight. Cap at 6 concurrent here so VUP stays
        // busy without being flooded, and the rest are processed in
        // waves.
        const T2V_CONCURRENCY = Number(
          process.env["DIRECT_T2V_CONCURRENCY"] ?? "6",
        );
        const runWithLimit = async <T>(
          items: T[],
          fn: (
            item: T,
          ) => Promise<{ clip: { clip_index: number }; ok: boolean }>,
        ): Promise<{ clip: { clip_index: number }; ok: boolean }[]> => {
          const results: { clip: { clip_index: number }; ok: boolean }[] = [];
          const queue = items.slice();
          const workers = Array.from(
            { length: Math.min(T2V_CONCURRENCY, queue.length) },
            async () => {
              while (queue.length) {
                const item = queue.shift();
                if (!item) break;
                results.push(await fn(item));
              }
            },
          );
          await Promise.all(workers);
          return results;
        };
        const t2vResults = await runWithLimit(eligibleT2V, async (clip) => {
          try {
            const action =
              clip.image_prompt
                ?.split(/[.!?]+/)
                .map((s) => s.trim())
                .find((s) => s.length > 0) ??
              clip.text ??
              "";
            // Look-only character summary: keep ethnicity + age + build +
            // hairstyle + facial features. Drop the name (irrelevant to
            // how they look) and clothing (depends on scene). The first
            // sentence of the card usually has the visual block; we strip
            // the leading "Andrew Lawson, " name prefix if present.
            const lookOnly = (desc: string) => {
              const first =
                desc
                  .split(/[.\n]/)
                  .map((s) => s.trim())
                  .find((s) => s.length > 0) ?? desc;
              const parts = first.split(",").map((s) => s.trim());
              // Drop a Title-Case name prefix (e.g. "Andrew Lawson", "Maya")
              if (
                parts.length > 1 &&
                /^[A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+){0,2}$/.test(parts[0]!)
              ) {
                parts.shift();
              }
              const joined = parts.join(", ");
              return joined.length > 110 ? joined.slice(0, 110) + "…" : joined;
            };
            const charLines = (clip.character_ids ?? [])
              .map((id) => charById.get(id))
              .filter((c): c is NonNullable<typeof c> => !!c)
              .map((c) => `- ${lookOnly(c.description)}`)
              .join("\n");
            const prompt = [
              action.trim() + ".",
              charLines ? `\nCharacters:\n${charLines}` : "",
              "\nUrban reality TV style. One shot, no cuts, static camera, no camera movement.",
            ]
              .filter(Boolean)
              .join("\n");

            const outputDir = join(MEDIA_BASE, jobId, "videos");
            await mkdir(outputDir, { recursive: true });
            const videoPath = join(outputDir, `clip-${clip.clip_index}.mp4`);

            console.log(
              JSON.stringify({
                level: "info",
                message: "DIRECT_T2V submitting",
                job_id: jobId,
                clip_index: clip.clip_index,
                prompt_length: prompt.length,
              }),
            );
            const videoRef = await requestVideoFromText(prompt, {
              format: "LONG_FORM_DRAMA",
              context: `drama:direct-t2v:${clip.clip_index}`,
            });
            // VEO t2v returns ~8 s. The planner now subdivides any
            // scene longer than 8 s into multiple sub-clips, so the
            // raw output already covers (or slightly exceeds) the
            // requested duration. We just trim with -t — no looping,
            // which means no hard cut back to frame 1.
            const rawPath = videoPath + ".raw.mp4";
            await downloadMedia(videoRef, rawPath);
            const durationSec = Math.max(
              (clip.end_ms - clip.start_ms) / 1000,
              1,
            );
            await execFileAsync(
              FFMPEG_BIN,
              [
                "-y",
                "-i",
                rawPath,
                "-t",
                durationSec.toFixed(3),
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                "20",
                "-pix_fmt",
                "yuv420p",
                "-an",
                videoPath,
              ],
              { maxBuffer: 64 * 1024 * 1024 },
            );
            await unlink(rawPath).catch(() => {});
            await updateDramaClipVideoPath(clip.id, videoPath);
            return { clip, ok: true };
          } catch (err) {
            await markDramaClipVideoFailed(clip.id);
            console.warn(
              JSON.stringify({
                level: "warn",
                message: "DIRECT_T2V clip failed",
                job_id: jobId,
                clip_index: clip.clip_index,
                error: (err instanceof Error ? err.message : String(err)).slice(
                  0,
                  200,
                ),
              }),
            );
            return { clip, ok: false };
          }
        });

        const failed = t2vResults.filter((r) => !r.ok).length;
        const failRatio = failed / Math.max(t2vResults.length, 1);
        if (failRatio > MAX_FAIL_RATIO) {
          throw new Error(
            `DIRECT_T2V: ${failed}/${t2vResults.length} clips failed (${(failRatio * 100).toFixed(0)}%)`,
          );
        }

        await updateJobStatus(db, jobId, "DRAMA_ASSEMBLING");
        await queues.dramaAssemble.add(
          "drama-assemble",
          { jobId, audioPath, renderMode },
          { jobId: `drama-assemble-${jobId}`, attempts: 1 },
        );
        console.log(
          JSON.stringify({
            level: "info",
            message: "DIRECT_T2V complete, queued assemble",
            job_id: jobId,
            done: t2vResults.length - failed,
            failed,
          }),
        );
        return;
      }

      // Only process clips that don't already have a video — skip already-done
      const eligible = clips.filter(
        (c) =>
          c.image_status === "done" &&
          c.image_path &&
          c.video_status !== "done",
      );
      const alreadyDone = clips.filter((c) => c.video_status === "done").length;

      if (eligible.length === 0 && alreadyDone > 0) {
        // All clips already done — skip straight to assembly
        console.log(
          JSON.stringify({
            level: "info",
            message: "All clips already done, skipping to assembly",
            job_id: jobId,
            done: alreadyDone,
          }),
        );
      } else if (eligible.length === 0) {
        throw new Error("No image-ready clips for video generation");
      }

      console.log(
        JSON.stringify({
          level: "info",
          message: "Drama video gen clips loaded",
          job_id: jobId,
          eligible: eligible.length,
          already_done: alreadyDone,
        }),
      );

      // Bulk-load every character referenced by any eligible clip so per-clip
      // character_images can be assembled without re-querying the DB.
      const allCharIds = new Set<string>();
      for (const c of eligible) {
        for (const cid of c.character_ids ?? []) allCharIds.add(cid);
      }
      const characterById = new Map<string, string>(); // id → thumbnail_url
      if (allCharIds.size > 0) {
        const rows = await getDramaCharactersByIds([...allCharIds]);
        for (const r of rows) {
          if (r.thumbnail_url) characterById.set(r.id, r.thumbnail_url);
        }
      }

      const videosDir = join(MEDIA_BASE, jobId, "videos");
      await mkdir(videosDir, { recursive: true });

      // Round-robin assign each clip to a backend
      const clipBackends: DramaBackend[] = eligible.map(
        (_, i) => DRAMA_VIDEO_BACKENDS[i % DRAMA_VIDEO_BACKENDS.length]!,
      );

      const veoClips = eligible.filter((_, i) => clipBackends[i] === "VEO_I2V");
      const vpsClips = eligible.filter((_, i) => clipBackends[i] === "VPS_T2V");

      console.log(
        JSON.stringify({
          level: "info",
          message: "Backend assignment",
          job_id: jobId,
          veo_clips: veoClips.length,
          vps_clips: vpsClips.length,
        }),
      );

      // Each clip submits + polls + downloads independently in parallel.
      // Submit lives INSIDE the per-clip try/catch so a single fetch
      // failure marks just that clip failed instead of aborting the pass.
      await Promise.all(
        eligible.map(async (clip, i) => {
          const backend = clipBackends[i]!;
          const durationSec = Math.max((clip.end_ms - clip.start_ms) / 1000, 1);
          const videoPath = join(videosDir, `clip-${clip.clip_index}.mp4`);
          const rawVideoPath = `${videoPath}.raw.mp4`;

          try {
            if (backend === "VPS_T2V") {
              if (!clip.image_prompt) {
                throw new Error(
                  `Clip ${clip.clip_index} has no image_prompt for VPS_T2V`,
                );
              }
              const videoRef = await requestVideoFromText(clip.image_prompt, {
                format: "LONG_FORM_DRAMA",
                context: `drama:vps-t2v:${clip.clip_index}`,
              });
              await downloadMedia(videoRef, rawVideoPath);
              // No looping or Ken Burns for VPS_T2V — it produces full-length
              // text-to-video clips directly. Just move to final path.
              await execFileAsync(FFMPEG_BIN, [
                "-y",
                "-i",
                rawVideoPath,
                "-t",
                durationSec.toFixed(3),
                "-c",
                "copy",
                videoPath,
              ]);
              await unlink(rawVideoPath).catch(() => {});
            } else {
              // Per-clip character refs let the lab clone anchor on the SAME
              // character identities across clips.
              const clipCharRefs = (clip.character_ids ?? [])
                .map((id) => characterById.get(id))
                .filter((u): u is string => !!u);

              await processSlowVideoClip({
                imagePath: clip.image_path!,
                characterRefs: clipCharRefs,
                motionPrompt: pickMotionPrompt(clip.clip_index),
                durationSec,
                clipIdx: clip.clip_index,
                videoPath,
              });
            }

            await updateDramaClipVideoPath(clip.id, videoPath);
            console.log(
              JSON.stringify({
                level: "info",
                message: "Clip video generated",
                job_id: jobId,
                clip_index: clip.clip_index,
                video_path: videoPath,
              }),
            );
          } catch (err) {
            console.error(
              JSON.stringify({
                level: "error",
                message: "Video gen failed for clip",
                job_id: jobId,
                clip_index: clip.clip_index,
                error: String(err),
              }),
            );
            await markDramaClipVideoFailed(clip.id);
          }
        }),
      );

      const updatedClips = await getDramaClipsByJob(jobId);
      const totalClips = clips.filter(
        (c) => c.image_status === "done" && c.image_path,
      ).length;
      const doneClips = updatedClips.filter(
        (c) => c.video_status === "done",
      ).length;
      const failedClips = updatedClips.filter(
        (c) => c.video_status === "failed",
      );
      const failRatio = failedClips.length / totalClips;

      console.log(
        JSON.stringify({
          level: "info",
          message: "Drama video gen pass complete",
          job_id: jobId,
          done: doneClips,
          failed: failedClips.length,
          total: totalClips,
          fail_ratio: failRatio.toFixed(2),
        }),
      );

      if (failedClips.length > 0 && failRatio <= MAX_FAIL_RATIO) {
        // Self-heal: failed clips remain in 'failed' state but the next pass will retry them
        // (eligible filter skips 'done' clips only — failed clips get retried automatically)
        console.log(
          JSON.stringify({
            level: "warn",
            message: "Some clips failed — self-healing retry in 60s",
            job_id: jobId,
            failed_count: failedClips.length,
            fail_ratio: failRatio.toFixed(2),
          }),
        );
        const retryJobId = `drama-video-gen-${jobId}-retry-${Date.now()}`;
        await queues.dramaVideoGen.add(
          "drama-video-gen",
          { jobId, audioPath, renderMode },
          { jobId: retryJobId, delay: RETRY_DELAY_MS, attempts: 1 },
        );
        return; // This pass is done — next pass retries the failed clips
      }

      if (failRatio > MAX_FAIL_RATIO) {
        throw new Error(
          `${failedClips.length}/${totalClips} video generations failed (${(failRatio * 100).toFixed(0)}%) — exceeds ${MAX_FAIL_RATIO * 100}% threshold`,
        );
      }

      await updateJobStatus(db, jobId, "DRAMA_ASSEMBLING");
      await queues.dramaAssemble.add(
        "drama-assemble",
        { jobId, audioPath, renderMode },
        { jobId: `drama-assemble-${jobId}`, attempts: 1 },
      );

      console.log(
        JSON.stringify({
          level: "info",
          message: "Drama video gen complete, assemble queued",
          job_id: jobId,
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        JSON.stringify({
          level: "error",
          message: "Drama video gen processor failed",
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
