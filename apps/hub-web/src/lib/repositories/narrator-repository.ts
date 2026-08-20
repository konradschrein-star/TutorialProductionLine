import { eq, and, desc, sql } from 'drizzle-orm';
import { db, narrators, assets } from '../db';
import type { Narrator, NewNarrator, Asset, NewAsset } from '@repo/db';
import { deleteAsset } from './asset-repository';

export type { Narrator };

export interface NarratorWithPoses extends Narrator {
  poses: Array<{
    asset_id: string;
    file_path: string | null;
    file_name: string;
    pose_name: string;
    width: number | null;
    height: number | null;
  }>;
}

export interface CreateNarratorInput {
  name: string;
  description: string;
  channel_id: string;
  is_default?: boolean;
  tags?: string[];
}

export interface CreateNarratorPoseInput {
  narrator_id: string;
  pose_name: string; // "pointing_left", "neutral", "excited", etc.
  file_path: string;
  file_name: string;
  file_format: string;
  width?: number;
  height?: number;
  size_bytes?: number;
  description?: string;
}

/**
 * List all narrators for a specific channel.
 * Returns narrators ordered by most recently updated.
 */
export async function listNarratorsByChannel(
  channelId: string
): Promise<Narrator[]> {
  return db
    .select()
    .from(narrators)
    .where(eq(narrators.channel_id, channelId))
    .orderBy(desc(narrators.updated_at));
}

/**
 * Get the default narrator for a channel.
 * Returns null if no default narrator is set.
 */
export async function getDefaultNarratorForChannel(
  channelId: string
): Promise<Narrator | null> {
  const [narrator] = await db
    .select()
    .from(narrators)
    .where(
      and(
        eq(narrators.channel_id, channelId),
        eq(narrators.is_default, true),
        eq(narrators.is_active, true)
      )
    )
    .limit(1);

  return narrator ?? null;
}

/**
 * Get a narrator by ID with all associated pose assets.
 * Returns null if narrator not found.
 */
export async function getNarratorByIdWithPoses(
  id: string
): Promise<NarratorWithPoses | null> {
  // Get narrator
  const [narrator] = await db
    .select()
    .from(narrators)
    .where(eq(narrators.id, id))
    .limit(1);

  if (!narrator) return null;

  // Get all pose assets for this narrator
  const narratorTag = `#narrator:${id}`;
  const poseAssets = await db
    .select({
      asset_id: assets.id,
      file_path: assets.file_path,
      file_name: assets.file_name,
      tags: assets.tags,
      width: assets.width,
      height: assets.height,
    })
    .from(assets)
    .where(
      and(
        eq(assets.asset_type, 'narrator_pose'),
        sql`${assets.tags} @> ARRAY[${narratorTag}]::text[]`
      )
    )
    .orderBy(desc(assets.created_at));

  // Extract pose names from tags
  const poses = poseAssets.map((asset) => {
    const poseTag = asset.tags.find((t) => t.startsWith('#pose:'));
    const pose_name = poseTag ? poseTag.replace('#pose:', '') : 'unknown';

    return {
      asset_id: asset.asset_id,
      file_path: asset.file_path,
      file_name: asset.file_name,
      pose_name,
      width: asset.width,
      height: asset.height,
    };
  });

  return {
    ...narrator,
    poses,
  };
}

/**
 * Get a narrator by ID (without poses).
 * Returns null if not found.
 */
export async function getNarratorById(id: string): Promise<Narrator | null> {
  const [narrator] = await db
    .select()
    .from(narrators)
    .where(eq(narrators.id, id))
    .limit(1);

  return narrator ?? null;
}

/**
 * Create a new narrator.
 * If is_default is true, automatically unsets the previous default for this channel.
 */
export async function createNarrator(
  data: CreateNarratorInput
): Promise<Narrator> {
  // If setting as default, unset previous default for this channel
  if (data.is_default) {
    await db
      .update(narrators)
      .set({ is_default: false, updated_at: new Date() })
      .where(
        and(
          eq(narrators.channel_id, data.channel_id),
          eq(narrators.is_default, true)
        )
      );
  }

  const [narrator] = await db
    .insert(narrators)
    .values({
      name: data.name,
      description: data.description,
      channel_id: data.channel_id,
      is_default: data.is_default ?? false,
      tags: data.tags ?? [],
    } as NewNarrator)
    .returning();

  return narrator;
}

/**
 * Update a narrator's metadata.
 * If is_default is set to true, automatically unsets the previous default.
 */
export async function updateNarrator(
  id: string,
  patch: Partial<
    Pick<Narrator, 'name' | 'description' | 'is_default' | 'is_active' | 'tags'>
  >
): Promise<Narrator | null> {
  // If setting as default, unset previous default for this narrator's channel
  if (patch.is_default === true) {
    const current = await getNarratorById(id);
    if (current) {
      await db
        .update(narrators)
        .set({ is_default: false, updated_at: new Date() })
        .where(
          and(
            eq(narrators.channel_id, current.channel_id),
            eq(narrators.is_default, true)
          )
        );
    }
  }

  const [updated] = await db
    .update(narrators)
    .set({ ...patch, updated_at: new Date() })
    .where(eq(narrators.id, id))
    .returning();

  return updated ?? null;
}

/**
 * Delete a narrator.
 * Cascade deletes associated pose assets via database ON DELETE CASCADE.
 */
export async function deleteNarrator(id: string): Promise<void> {
  // Delete narrator (pose assets will be cascade deleted by DB)
  await db.delete(narrators).where(eq(narrators.id, id));
}

/**
 * Create a narrator pose asset.
 * Automatically tags the asset with #narrator:{narrator_id} and #pose:{pose_name}.
 *
 * NOTE: Caller must handle file upload and provide file_path.
 */
export async function createNarratorPose(
  data: CreateNarratorPoseInput
): Promise<Asset> {
  const tags = [
    `#narrator:${data.narrator_id}`,
    `#pose:${data.pose_name}`,
  ];

  const [poseAsset] = await db
    .insert(assets)
    .values({
      name: `${data.pose_name} pose`,
      description: data.description ?? `Narrator pose: ${data.pose_name}`,
      asset_type: 'narrator_pose',
      file_path: data.file_path,
      file_name: data.file_name,
      file_format: data.file_format,
      width: data.width,
      height: data.height,
      size_bytes: data.size_bytes,
      tags,
      status: 'approved', // Narrator poses are approved by default
    } as NewAsset)
    .returning();

  return poseAsset;
}

/**
 * Delete a narrator pose asset.
 * Removes the file from disk and the database record.
 */
export async function deleteNarratorPose(assetId: string): Promise<void> {
  await deleteAsset(assetId);
}

/**
 * List all poses for a narrator.
 * Returns pose assets ordered by creation date.
 */
export async function listNarratorPoses(narratorId: string): Promise<Asset[]> {
  const narratorTag = `#narrator:${narratorId}`;

  return db
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.asset_type, 'narrator_pose'),
        sql`${assets.tags} @> ARRAY[${narratorTag}]::text[]`
      )
    )
    .orderBy(desc(assets.created_at));
}
