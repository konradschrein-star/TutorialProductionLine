import { stat } from "node:fs/promises";
import {
  listTutorialJobsByParent,
  updateTutorialJob,
  type DrizzleClient,
  type TutorialJob,
} from "@repo/db";
import { createRedisConnection, createTutorialSpliceQueue } from "@repo/queue";
import { createStitchJobForTutorial } from "./create-stitch-job";

/**
 * The single place where a recording becomes visible to the rest of the
 * pipeline.
 *
 * INVARIANT (regression-tested the hard way in 69d6229e): by the time this
 * function is called, the recording file must be COMPLETE on disk — every byte
 * written, every file descriptor closed. `recording_path` is what makes the
 * splice worker ffprobe the file; publishing it against a half-written MP4
 * whose moov atom has not landed failed the FIRST attempt of 113 of 113 splice
 * jobs in production. Both callers (the legacy single-shot multipart POST and
 * the chunked-upload finalizer) therefore await stream close *before* calling
 * in here, and this function re-verifies the file with a stat() as a last gate.
 *
 * Auth/ownership is intentionally NOT handled here — the routes gate that.
 */

export interface PublishRecordingResult {
  /** Whether a splice job was actually added to the queue this call. */
  enqueued: boolean;
  /** Human-readable reason when `enqueued` is false. */
  note?: string;
  /** Size of the published file, straight off the filesystem. */
  size: number;
}

/**
 * Enqueue the splice for `jobId`, idempotently.
 *
 * The BullMQ job id is deterministic (`tutorial-splice-<jobId>`), so a
 * duplicate finalize (resumed upload, double-clicked button, retried request
 * whose response was lost) can never produce two concurrent splices.
 *
 * But deterministic ids alone are not enough: the splice queue keeps completed
 * jobs for 24h / 500 jobs (see `tutorialSpliceQueueOptions`), so a *genuine*
 * re-upload of the same tutorial within that window would silently no-op and
 * leave the job parked in AWAITING_UPLOAD forever. So we look the job up first
 * and only clear it out when it is in a settled state.
 */
async function enqueueSpliceIdempotent(
  jobId: string,
): Promise<{ enqueued: boolean; note?: string }> {
  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl) {
    throw new Error(
      "REDIS_URL is not set — the recording is safely on disk but the splice could not be queued. Set REDIS_URL and use Retry Splicing.",
    );
  }

  const bullJobId = `tutorial-splice-${jobId}`;
  const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
  try {
    const queue = createTutorialSpliceQueue(conn);
    const existing = await queue.getJob(bullJobId);

    if (existing) {
      const state = await existing.getState();
      if (state === "completed" || state === "failed") {
        // Settled run from an earlier take. Remove it so this upload gets a
        // fresh splice instead of being swallowed by BullMQ's dedup.
        await existing.remove();
      } else {
        // waiting / active / delayed / waiting-children — a splice for this
        // recording is already in flight. Adding again would either be a
        // silent no-op or (worse, with a unique id) a second ffmpeg over the
        // same files.
        return {
          enqueued: false,
          note: `splice already queued (state: ${state})`,
        };
      }
    }

    await queue.add(
      "tutorial-splice",
      { jobId },
      { jobId: bullJobId, attempts: 2 },
    );
    return { enqueued: true };
  } finally {
    await conn.quit();
  }
}

/**
 * Publish a fully-written recording file for a tutorial job: verify it on
 * disk, write `recording_path`, and move the job to the next state.
 *
 * @param db      Drizzle client
 * @param job     The tutorial job row (already fetched + authorized)
 * @param filePath Absolute path of the COMPLETE recording on disk
 */
export async function publishRecording(
  db: DrizzleClient,
  job: TutorialJob,
  filePath: string,
): Promise<PublishRecordingResult> {
  // Last gate before recording_path becomes visible. If this throws, nothing
  // is published and the caller surfaces a real error — we never guess.
  const fileStats = await stat(filePath);
  if (!fileStats.isFile() || fileStats.size === 0) {
    throw new Error(
      `Refusing to publish ${filePath}: it is not a regular non-empty file (size ${fileStats.size}). The splice would ffprobe a broken file.`,
    );
  }

  if (job.mode === "LONG_FORM") {
    // LONG_FORM: mark the child RECORDED, never enqueue splice.
    await updateTutorialJob(db, job.id, {
      recording_path: filePath,
      recorded_at: new Date(),
      status: "RECORDED",
    });

    // If all siblings are now RECORDED, promote parent to READY_TO_STITCH.
    if (job.parent_job_id) {
      const siblings = await listTutorialJobsByParent(db, job.parent_job_id);
      if (
        siblings.length > 0 &&
        siblings.every((s) => s.status === "RECORDED")
      ) {
        await updateTutorialJob(db, job.parent_job_id, {
          status: "READY_TO_STITCH",
        });

        // Auto-fire the stitcher hand-off: create the DRAFT stitch job and
        // flip the parent to SENT_TO_STITCHER, exactly like the manual
        // "Send to stitcher" button. Best-effort — if it fails we leave the
        // parent at READY_TO_STITCH so the manual button stays a working
        // fallback. We never START the render; that remains a human review
        // in /tutorial-studio/video-stitcher.
        try {
          const auto = await createStitchJobForTutorial(db, job.parent_job_id);
          if (!auto.ok) {
            console.warn(
              `[recording] auto-stitch hand-off skipped for parent ${job.parent_job_id}: ${auto.error}`,
            );
          }
        } catch (autoErr) {
          console.error(
            "[recording] auto-stitch hand-off failed (non-fatal); manual Send-to-stitcher remains available",
            autoErr,
          );
        }
      }
    }

    return {
      enqueued: false,
      note: "LONG_FORM part — stitched, not spliced",
      size: fileStats.size,
    };
  }

  // Non-LONG_FORM: set AWAITING_UPLOAD and enqueue splice.
  await updateTutorialJob(db, job.id, {
    recording_path: filePath,
    recorded_at: new Date(),
    status: "AWAITING_UPLOAD",
  });

  const { enqueued, note } = await enqueueSpliceIdempotent(job.id);
  return { enqueued, ...(note ? { note } : {}), size: fileStats.size };
}
