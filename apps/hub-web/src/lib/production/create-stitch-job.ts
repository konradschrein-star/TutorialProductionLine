import { randomUUID } from "node:crypto";
import { mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getTutorialJobById,
  listTutorialJobsByParent,
  updateTutorialJob,
  videoStitchJobs,
  type DrizzleClient,
} from "@repo/db";
import { probeMedia } from "@repo/media-core";

const MEDIA_ROOT =
  process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";

export type CreateStitchJobResult =
  | { ok: true; stitchJobId: string; alreadyExisted: boolean }
  | { ok: false; status: number; error: string };

/**
 * Core of the LONG_FORM → video-stitcher hand-off.
 *
 * Extracted from POST /api/production/jobs/[id]/send-to-stitcher so it can be
 * called from BOTH the manual "Send to stitcher" button AND the auto-fire
 * point in the recording upload route (when the last part is recorded and the
 * parent flips to READY_TO_STITCH).
 *
 * Behaviour is identical to the button: it copies each recorded part's video +
 * audio into fresh stitch-upload slots, creates a `video_stitch_jobs` row in
 * DRAFT status with alignment_mode "segmented", and flips the parent to
 * SENT_TO_STITCHER. It never STARTS the render — the final render stays a human
 * review in /tutorial-studio/video-stitcher.
 *
 * Auth/ownership is intentionally NOT handled here — callers (the route) gate
 * that. This function only validates job state so the auto-fire path can reuse
 * the exact same guards. It is idempotent: if the parent already has a
 * stitch_job_id it returns it with `alreadyExisted: true`.
 */
export async function createStitchJobForTutorial(
  db: DrizzleClient,
  parentJobId: string,
  opts?: { createdByUserId?: string },
): Promise<CreateStitchJobResult> {
  const parent = await getTutorialJobById(db, parentJobId);
  if (!parent || parent.mode !== "LONG_FORM" || parent.parent_job_id !== null) {
    return { ok: false, status: 400, error: "Not a long-form parent" };
  }

  // Idempotency: already handed off
  if (parent.stitch_job_id) {
    return {
      ok: true,
      stitchJobId: parent.stitch_job_id,
      alreadyExisted: true,
    };
  }

  if (parent.status !== "READY_TO_STITCH") {
    return {
      ok: false,
      status: 409,
      error: `Parent job is in status ${parent.status}, expected READY_TO_STITCH`,
    };
  }

  const children = await listTutorialJobsByParent(db, parentJobId);
  if (
    children.length === 0 ||
    !children.every((c) => c.status === "RECORDED")
  ) {
    return {
      ok: false,
      status: 409,
      error: "All parts must be RECORDED before stitching",
    };
  }

  const input_videos: Array<{
    upload_id: string;
    filename: string;
    duration_seconds: number;
    width: number;
    height: number;
    fps: number;
    order_index: number;
    metadata: { recorded_at?: string };
    segment_audio_upload_id: string;
  }> = [];

  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;

    if (!child.recording_path || !child.audio_path) {
      return {
        ok: false,
        status: 409,
        error: `Part ${i + 1} is missing its recording or audio`,
      };
    }

    // Copy recording video into a new stitch-upload slot
    const videoUploadId = randomUUID();
    const videoDir = join(MEDIA_ROOT, "stitch-uploads", videoUploadId);
    await mkdir(videoDir, { recursive: true });
    await copyFile(child.recording_path, join(videoDir, "original.mp4"));

    // Copy part audio into a second stitch-upload slot
    const audioUploadId = randomUUID();
    const audioDir = join(MEDIA_ROOT, "stitch-uploads", audioUploadId);
    await mkdir(audioDir, { recursive: true });
    await copyFile(child.audio_path, join(audioDir, "original.mp3"));

    // Probe the copied video to get accurate dimensions/fps
    const probe = await probeMedia(join(videoDir, "original.mp4"));

    input_videos.push({
      upload_id: videoUploadId,
      filename: `part-${i + 1}.mp4`,
      duration_seconds: probe.durationSeconds,
      width: probe.video?.width ?? 1920,
      height: probe.video?.height ?? 1080,
      fps: probe.video?.fps ?? 30,
      order_index: i,
      metadata: {},
      segment_audio_upload_id: audioUploadId,
    });
  }

  const safeTitle = parent.title.replace(/[^a-z0-9]+/gi, "_");

  const [stitchJob] = await db
    .insert(videoStitchJobs)
    .values({
      created_by_user_id: opts?.createdByUserId ?? parent.created_by,
      status: "DRAFT",
      alignment_mode: "segmented",
      input_videos,
      output_filename: `${safeTitle}.mp4`,
      transition_type: "hard_cut",
      transition_duration_seconds: 0,
      voiceover_enabled: false,
      music_enabled: false,
      captions_enabled: false,
    })
    .returning();

  if (!stitchJob) {
    return { ok: false, status: 500, error: "Failed to create stitch job" };
  }

  await updateTutorialJob(db, parentJobId, {
    status: "SENT_TO_STITCHER",
    stitch_job_id: stitchJob.id,
  });

  return { ok: true, stitchJobId: stitchJob.id, alreadyExisted: false };
}
