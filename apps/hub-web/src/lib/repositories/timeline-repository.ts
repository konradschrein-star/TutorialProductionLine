import { eq } from 'drizzle-orm';
import { db, videoTimelines, contentJobs, sceneFrameSequences } from '../db';
import { hydrateTimelineFromManifest } from '@repo/domain';
import { VideoTimelineSchema } from '@repo/contracts';
import type { VideoTimeline, AssemblyManifest } from '@repo/contracts';

/**
 * Timeline Repository
 *
 * Manages the VideoTimeline edit layer for content jobs.
 *
 * Read strategy (priority order):
 * 1. video_timelines table — operator-saved edit layer
 * 2. Live hydration from assembly_manifest + scene_frame_sequences
 * 3. Returns null if the job has no assembly_manifest yet
 *
 * Write strategy:
 * - Upserts one row per job_id (unique constraint on job_id)
 * - Increments version on every save
 */

export type { VideoTimeline };

/**
 * Get the VideoTimeline for a job.
 *
 * Returns the saved edit layer if one exists, otherwise hydrates from
 * the assembly_manifest on the fly and returns the hydrated result
 * (but does NOT auto-save it — saves are explicit operator actions).
 *
 * Returns null if the job has no assembly_manifest yet
 * (e.g. still in SCRIPTING phase).
 */
export async function getTimelineForJob(jobId: string): Promise<VideoTimeline | null> {
  // 1. Check for an existing saved timeline
  const rows = await db
    .select()
    .from(videoTimelines)
    .where(eq(videoTimelines.job_id, jobId))
    .limit(1);

  if (rows.length > 0) {
    const row = rows[0]!;
    const parsed = VideoTimelineSchema.safeParse(row.timeline_data);
    if (parsed.success) return parsed.data;
    // If stored data is malformed, fall through to re-hydrate
    console.warn(`[timeline-repository] Saved timeline for job ${jobId} failed validation, re-hydrating`);
  }

  // 2. Hydrate from assembly_manifest
  const jobRows = await db
    .select({
      id: contentJobs.id,
      assembly_manifest: contentJobs.assembly_manifest,
      target_duration_seconds: contentJobs.target_duration_seconds,
      duration_frames: contentJobs.duration_frames,
    })
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);

  if (jobRows.length === 0) return null;

  const job = jobRows[0]!;
  if (!job.assembly_manifest) return null;   // Job not yet past scene-analysis

  const manifest = job.assembly_manifest as AssemblyManifest;

  // Load all frame sequences for this job
  const frameSeqs = await db
    .select()
    .from(sceneFrameSequences)
    .where(eq(sceneFrameSequences.job_id, jobId))
    .orderBy(sceneFrameSequences.scene_index, sceneFrameSequences.frame_index);

  // Determine fps from template (default 30 — the render worker uses template.render_config.fps)
  // Using 30 as a safe default; the exact value is not stored on the job row itself.
  const fps = 30;
  const targetDurationSeconds = job.target_duration_seconds ?? 90;

  return hydrateTimelineFromManifest({
    jobId,
    manifest,
    frameSequences: frameSeqs,
    fps,
    targetDurationSeconds,
  });
}

/**
 * Save (upsert) a VideoTimeline for a job.
 *
 * Validates with Zod before persisting — rejects malformed data at the boundary.
 * Increments version on every save.
 */
export async function saveTimeline(
  timeline: VideoTimeline,
  savedBy?: string
): Promise<VideoTimeline> {
  const validated = VideoTimelineSchema.parse(timeline);
  const nextVersion = validated.version + 1;
  const toSave = { ...validated, version: nextVersion };

  await db
    .insert(videoTimelines)
    .values({
      job_id: validated.job_id,
      version: nextVersion,
      timeline_data: toSave,
      saved_by: savedBy ?? null,
    })
    .onConflictDoUpdate({
      target: videoTimelines.job_id,
      set: {
        version: nextVersion,
        timeline_data: toSave,
        saved_by: savedBy ?? null,
        updated_at: new Date(),
      },
    });

  return toSave;
}
