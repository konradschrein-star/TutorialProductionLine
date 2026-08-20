/**
 * Asset Repository
 *
 * Data access layer for assets table.
 * Manages visual, audio, and text assets used in content production.
 */

import { eq, and, inArray, sql, desc, isNull, or } from "drizzle-orm";
import { assets } from "../schema/assets.js";
import type { Transaction } from "./transaction.js";
import { getDbOrTx } from "./transaction.js";

// Type for inserting a new asset
export type NewAssetRepo = typeof assets.$inferInsert;

// Type for a complete asset record
export type AssetRepo = typeof assets.$inferSelect;

// Type for updating an asset
export type AssetUpdate = Partial<Omit<AssetRepo, "id" | "created_at">>;

// Asset type enum
export type AssetTypeValue = AssetRepo["asset_type"];

/**
 * Get asset by ID
 *
 * @param id - Asset ID
 * @param tx - Optional transaction
 * @returns Asset or null if not found
 */
export async function getAssetById(
  id: string,
  tx?: Transaction
): Promise<AssetRepo | null> {
  const db = getDbOrTx(tx);

  const [asset] = await db
    .select()
    .from(assets)
    .where(eq(assets.id, id))
    .limit(1);

  return asset || null;
}

/**
 * Get multiple assets by IDs
 *
 * @param ids - Array of asset IDs
 * @param tx - Optional transaction
 * @returns Array of assets
 */
export async function getAssetsByIds(
  ids: string[],
  tx?: Transaction
): Promise<AssetRepo[]> {
  if (ids.length === 0) return [];

  const db = getDbOrTx(tx);

  return await db
    .select()
    .from(assets)
    .where(inArray(assets.id, ids));
}

/**
 * Get assets by type
 *
 * @param assetType - Asset type (e.g., 'character', 'background', 'audio')
 * @param limit - Optional limit (default: 100)
 * @param tx - Optional transaction
 * @returns Array of assets
 */
export async function getAssetsByType(
  assetType: AssetTypeValue,
  limit: number = 100,
  tx?: Transaction
): Promise<AssetRepo[]> {
  const db = getDbOrTx(tx);

  return await db
    .select()
    .from(assets)
    .where(eq(assets.asset_type, assetType))
    .orderBy(desc(assets.created_at))
    .limit(limit);
}

/**
 * Get assets by channel
 *
 * @param channelId - Channel ID
 * @param assetType - Optional asset type filter
 * @param tx - Optional transaction
 * @returns Array of assets
 */
export async function getAssetsByChannel(
  channelId: string,
  assetType?: AssetTypeValue,
  tx?: Transaction
): Promise<AssetRepo[]> {
  const db = getDbOrTx(tx);

  const conditions = [eq(assets.channel_id, channelId)];

  if (assetType) {
    conditions.push(eq(assets.asset_type, assetType));
  }

  return await db
    .select()
    .from(assets)
    .where(and(...conditions))
    .orderBy(desc(assets.created_at));
}

/**
 * Get assets by archetype
 *
 * @param archetypeId - Archetype ID
 * @param assetType - Optional asset type filter
 * @param tx - Optional transaction
 * @returns Array of assets
 */
export async function getAssetsByArchetype(
  archetypeId: string,
  assetType?: AssetTypeValue,
  tx?: Transaction
): Promise<AssetRepo[]> {
  const db = getDbOrTx(tx);

  const conditions = [eq(assets.archetype_id, archetypeId)];

  if (assetType) {
    conditions.push(eq(assets.asset_type, assetType));
  }

  return await db
    .select()
    .from(assets)
    .where(and(...conditions))
    .orderBy(desc(assets.created_at));
}

/**
 * Get universal assets
 *
 * Returns assets with all association fields (channel_id, archetype_id, format) null.
 * These are universal assets that apply to all jobs.
 *
 * @param assetType - Optional asset type filter
 * @param tx - Optional transaction
 * @returns Array of universal assets
 */
export async function getUniversalAssets(
  assetType?: AssetTypeValue,
  tx?: Transaction
): Promise<AssetRepo[]> {
  const db = getDbOrTx(tx);

  const conditions = [
    isNull(assets.channel_id),
    isNull(assets.archetype_id),
    isNull(assets.format),
  ];

  if (assetType) {
    conditions.push(eq(assets.asset_type, assetType));
  }

  return await db
    .select()
    .from(assets)
    .where(and(...conditions))
    .orderBy(desc(assets.created_at));
}

/**
 * Search assets by tags
 *
 * @param tags - Array of tags to search for (OR logic)
 * @param assetType - Optional asset type filter
 * @param tx - Optional transaction
 * @returns Array of assets matching any of the tags
 */
export async function searchAssetsByTags(
  tags: string[],
  assetType?: AssetTypeValue,
  tx?: Transaction
): Promise<AssetRepo[]> {
  const db = getDbOrTx(tx);

  // Build SQL for array overlap (ANY tag matches)
  const tagConditions = tags.map(tag => sql`${tag} = ANY(${assets.tags})`);

  const conditions = [or(...tagConditions)];

  if (assetType) {
    conditions.push(eq(assets.asset_type, assetType));
  }

  return await db
    .select()
    .from(assets)
    .where(and(...(conditions as any)))
    .orderBy(desc(assets.created_at));
}

/**
 * Create a new asset
 *
 * @param data - Asset data to insert
 * @param tx - Optional transaction
 * @returns Created asset
 */
export async function createAsset(
  data: NewAssetRepo,
  tx?: Transaction
): Promise<AssetRepo> {
  const db = getDbOrTx(tx);

  const [asset] = await db
    .insert(assets)
    .values(data)
    .returning();

  if (!asset) {
    throw new Error("Failed to create asset");
  }

  return asset;
}

/**
 * Update asset by ID
 *
 * @param id - Asset ID
 * @param data - Fields to update
 * @param tx - Optional transaction
 * @returns Updated asset
 */
export async function updateAsset(
  id: string,
  data: AssetUpdate,
  tx?: Transaction
): Promise<AssetRepo> {
  const db = getDbOrTx(tx);

  const [asset] = await db
    .update(assets)
    .set({
      ...data,
      updated_at: new Date(),
    })
    .where(eq(assets.id, id))
    .returning();

  if (!asset) {
    throw new Error(`Asset ${id} not found`);
  }

  return asset;
}

/**
 * Delete asset by ID
 *
 * @param id - Asset ID
 * @param tx - Optional transaction
 */
export async function deleteAsset(
  id: string,
  tx?: Transaction
): Promise<void> {
  const db = getDbOrTx(tx);

  await db.delete(assets).where(eq(assets.id, id));
}

/**
 * Update asset generation metadata
 *
 * Updates AI generation metadata for an asset.
 *
 * @param id - Asset ID
 * @param metadata - Generation metadata (prompt, model, settings)
 * @param tx - Optional transaction
 * @returns Updated asset
 */
export async function updateAssetGenerationRecipe(
  id: string,
  recipe: any,
  tx?: Transaction
): Promise<AssetRepo> {
  return await updateAsset(
    id,
    {
      generation_recipe: recipe,
    },
    tx
  );
}

/**
 * Get asset count by type
 *
 * @param assetType - Optional asset type filter
 * @param tx - Optional transaction
 * @returns Count of assets
 */
export async function getAssetCount(
  assetType?: AssetTypeValue,
  tx?: Transaction
): Promise<number> {
  const db = getDbOrTx(tx);

  const query = db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(assets);

  if (assetType) {
    query.where(eq(assets.asset_type, assetType));
  }

  const [result] = await query;
  return result?.count || 0;
}
