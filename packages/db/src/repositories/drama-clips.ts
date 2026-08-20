/**
 * Drama Clips Repository
 *
 * Data access layer for drama_clips table.
 * Manages clip segments for long-form drama content production.
 */

import { eq, asc } from "drizzle-orm";
import { dramaClips } from "../schema/drama-clips.js";
import type { Transaction } from "./transaction.js";
import { getDbOrTx } from "./transaction.js";

// Type for inserting a new drama clip
export type NewDramaClip = typeof dramaClips.$inferInsert;

// Type for a complete drama clip record
export type DramaClip = typeof dramaClips.$inferSelect;

// Type for updating a drama clip
export type DramaClipUpdate = Partial<Omit<DramaClip, "id" | "created_at">>;

export interface DramaClipSpec {
  clipIndex: number;
  sectionType: "hook" | "body";
  text: string;
  startMs: number;
  endMs: number;
  imagePrompt?: string;
  characterIds?: string[];
}

/**
 * Insert multiple drama clips for a job
 *
 * @param jobId - Job ID
 * @param specs - Array of drama clip specifications
 * @param tx - Optional transaction
 */
export async function insertDramaClips(
  jobId: string,
  specs: DramaClipSpec[],
  tx?: Transaction,
): Promise<void> {
  const db = getDbOrTx(tx);

  if (specs.length === 0) return;

  await db.insert(dramaClips).values(
    specs.map((s) => ({
      job_id: jobId,
      clip_index: s.clipIndex,
      section_type: s.sectionType,
      text: s.text,
      start_ms: s.startMs,
      end_ms: s.endMs,
      image_prompt: s.imagePrompt ?? null,
      character_ids: s.characterIds ?? [],
    })),
  );
}

/**
 * Replace a clip's character_ids with the given list. Empty list clears them.
 */
export async function updateDramaClipCharacterIds(
  clipId: string,
  characterIds: string[],
  tx?: Transaction,
): Promise<void> {
  const db = getDbOrTx(tx);
  await db
    .update(dramaClips)
    .set({ character_ids: characterIds })
    .where(eq(dramaClips.id, clipId));
}

/**
 * Get all drama clips for a job, ordered by clip index
 *
 * @param jobId - Job ID
 * @param tx - Optional transaction
 * @returns Array of drama clips
 */
export async function getDramaClipsByJob(
  jobId: string,
  tx?: Transaction,
): Promise<DramaClip[]> {
  const db = getDbOrTx(tx);

  return await db
    .select()
    .from(dramaClips)
    .where(eq(dramaClips.job_id, jobId))
    .orderBy(asc(dramaClips.clip_index));
}

/**
 * Update drama clip image prompt
 *
 * @param clipId - Clip ID
 * @param imagePrompt - Image generation prompt
 * @param tx - Optional transaction
 * @returns Updated clip
 */
export async function updateDramaClipPrompt(
  clipId: string,
  imagePrompt: string,
  tx?: Transaction,
): Promise<DramaClip> {
  const db = getDbOrTx(tx);

  const [clip] = await db
    .update(dramaClips)
    .set({ image_prompt: imagePrompt })
    .where(eq(dramaClips.id, clipId))
    .returning();

  if (!clip) {
    throw new Error(`Drama clip ${clipId} not found`);
  }

  return clip;
}

/**
 * Update drama clip image path and mark as complete
 *
 * @param clipId - Clip ID
 * @param imagePath - Path to generated image
 * @param tx - Optional transaction
 * @returns Updated clip
 */
export async function updateDramaClipImagePath(
  clipId: string,
  imagePath: string,
  tx?: Transaction,
): Promise<DramaClip> {
  const db = getDbOrTx(tx);

  const [clip] = await db
    .update(dramaClips)
    .set({ image_path: imagePath, image_status: "done" })
    .where(eq(dramaClips.id, clipId))
    .returning();

  if (!clip) {
    throw new Error(`Drama clip ${clipId} not found`);
  }

  return clip;
}

/**
 * Mark drama clip image generation as failed
 */
export async function markDramaClipImageFailed(
  clipId: string,
  tx?: Transaction,
): Promise<DramaClip> {
  const db = getDbOrTx(tx);
  const [clip] = await db
    .update(dramaClips)
    .set({ image_status: "failed" })
    .where(eq(dramaClips.id, clipId))
    .returning();
  if (!clip) throw new Error(`Drama clip ${clipId} not found`);
  return clip;
}

/**
 * Update drama clip video path and mark video as done.
 */
export async function updateDramaClipVideoPath(
  clipId: string,
  videoPath: string,
  tx?: Transaction,
): Promise<DramaClip> {
  const db = getDbOrTx(tx);
  const [clip] = await db
    .update(dramaClips)
    .set({ video_path: videoPath, video_status: "done" })
    .where(eq(dramaClips.id, clipId))
    .returning();
  if (!clip) throw new Error(`Drama clip ${clipId} not found`);
  return clip;
}

/**
 * Record the Veo i2v job ID submitted for a clip during image gen (pre-pipeline).
 */
export async function markDramaClipVeoSubmitted(
  clipId: string,
  veoJobId: string,
  tx?: Transaction,
): Promise<void> {
  const db = getDbOrTx(tx);
  await db
    .update(dramaClips)
    .set({ veo_job_id: veoJobId })
    .where(eq(dramaClips.id, clipId));
}

/**
 * Mark drama clip video generation as failed.
 */
export async function markDramaClipVideoFailed(
  clipId: string,
  tx?: Transaction,
): Promise<DramaClip> {
  const db = getDbOrTx(tx);
  const [clip] = await db
    .update(dramaClips)
    .set({ video_status: "failed" })
    .where(eq(dramaClips.id, clipId))
    .returning();
  if (!clip) throw new Error(`Drama clip ${clipId} not found`);
  return clip;
}
