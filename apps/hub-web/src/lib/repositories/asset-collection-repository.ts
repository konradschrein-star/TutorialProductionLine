/**
 * Asset Collection Repository
 *
 * Database operations for asset collections and their memberships.
 * Supports many-to-many relationships between assets and collections.
 */

import { eq, and, inArray, sql } from 'drizzle-orm';
import {
  db,
  assetCollections,
  assetCollectionMemberships,
  assets,
  type AssetCollection,
  type NewAssetCollection,
  type AssetCollectionMembership,
} from '../db';

/**
 * List all collections with asset counts
 */
export async function listCollections(): Promise<(AssetCollection & { asset_count: number })[]> {
  const collections = await db
    .select({
      id: assetCollections.id,
      name: assetCollections.name,
      description: assetCollections.description,
      color: assetCollections.color,
      icon: assetCollections.icon,
      created_at: assetCollections.created_at,
      updated_at: assetCollections.updated_at,
      asset_count: sql<number>`COUNT(${assetCollectionMemberships.asset_id})::int`,
    })
    .from(assetCollections)
    .leftJoin(
      assetCollectionMemberships,
      eq(assetCollections.id, assetCollectionMemberships.collection_id)
    )
    .groupBy(assetCollections.id)
    .orderBy(assetCollections.created_at);

  return collections;
}

/**
 * Get a single collection by ID
 */
export async function getCollection(id: string): Promise<AssetCollection | null> {
  const [collection] = await db
    .select()
    .from(assetCollections)
    .where(eq(assetCollections.id, id))
    .limit(1);

  return collection ?? null;
}

/**
 * Create a new collection
 */
export async function createCollection(
  data: Omit<NewAssetCollection, 'id' | 'created_at' | 'updated_at'>
): Promise<AssetCollection> {
  const [collection] = await db
    .insert(assetCollections)
    .values(data)
    .returning();

  if (!collection) {
    throw new Error('Failed to create collection');
  }

  return collection;
}

/**
 * Update a collection
 */
export async function updateCollection(
  id: string,
  data: Partial<Pick<AssetCollection, 'name' | 'description' | 'color' | 'icon'>>
): Promise<AssetCollection | null> {
  const [collection] = await db
    .update(assetCollections)
    .set({ ...data, updated_at: new Date() })
    .where(eq(assetCollections.id, id))
    .returning();

  return collection ?? null;
}

/**
 * Delete a collection (memberships cascade automatically)
 */
export async function deleteCollection(id: string): Promise<boolean> {
  const result = await db
    .delete(assetCollections)
    .where(eq(assetCollections.id, id)) as any;

  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Get all collections for a specific asset
 */
export async function getAssetCollections(assetId: string): Promise<AssetCollection[]> {
  const collections = await db
    .select({
      id: assetCollections.id,
      name: assetCollections.name,
      description: assetCollections.description,
      color: assetCollections.color,
      icon: assetCollections.icon,
      created_at: assetCollections.created_at,
      updated_at: assetCollections.updated_at,
    })
    .from(assetCollections)
    .innerJoin(
      assetCollectionMemberships,
      eq(assetCollections.id, assetCollectionMemberships.collection_id)
    )
    .where(eq(assetCollectionMemberships.asset_id, assetId))
    .orderBy(assetCollections.name);

  return collections;
}

/**
 * Add an asset to a collection
 */
export async function addAssetToCollection(
  assetId: string,
  collectionId: string
): Promise<AssetCollectionMembership> {
  // Check if membership already exists
  const [existing] = await db
    .select()
    .from(assetCollectionMemberships)
    .where(
      and(
        eq(assetCollectionMemberships.asset_id, assetId),
        eq(assetCollectionMemberships.collection_id, collectionId)
      )
    )
    .limit(1);

  if (existing) {
    return existing; // Already in collection
  }

  const [membership] = await db
    .insert(assetCollectionMemberships)
    .values({ asset_id: assetId, collection_id: collectionId })
    .returning();

  if (!membership) {
    throw new Error('Failed to add asset to collection');
  }

  return membership;
}

/**
 * Remove an asset from a collection
 */
export async function removeAssetFromCollection(
  assetId: string,
  collectionId: string
): Promise<boolean> {
  const result = await db
    .delete(assetCollectionMemberships)
    .where(
      and(
        eq(assetCollectionMemberships.asset_id, assetId),
        eq(assetCollectionMemberships.collection_id, collectionId)
      )
    ) as any;

  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Get all assets in a collection
 */
export async function getCollectionAssets(collectionId: string) {
  const collectionAssets = await db
    .select({
      id: assets.id,
      name: assets.name,
      description: assets.description,
      asset_type: assets.asset_type,
      file_path: assets.file_path,
      file_name: assets.file_name,
      file_format: assets.file_format,
      size_bytes: assets.size_bytes,
      thumbnail_path: assets.thumbnail_path,
      duration_seconds: assets.duration_seconds,
      status: assets.status,
      quality_rating: assets.quality_rating,
      tags: assets.tags,
      created_at: assets.created_at,
    })
    .from(assets)
    .innerJoin(
      assetCollectionMemberships,
      eq(assets.id, assetCollectionMemberships.asset_id)
    )
    .where(eq(assetCollectionMemberships.collection_id, collectionId))
    .orderBy(assets.created_at);

  return collectionAssets;
}

/**
 * Bulk add assets to a collection
 */
export async function bulkAddAssetsToCollection(
  assetIds: string[],
  collectionId: string
): Promise<number> {
  if (assetIds.length === 0) return 0;

  // Get existing memberships to avoid duplicates
  const existing = await db
    .select()
    .from(assetCollectionMemberships)
    .where(
      and(
        inArray(assetCollectionMemberships.asset_id, assetIds),
        eq(assetCollectionMemberships.collection_id, collectionId)
      )
    );

  const existingAssetIds = new Set(existing.map(m => m.asset_id));
  const newAssetIds = assetIds.filter(id => !existingAssetIds.has(id));

  if (newAssetIds.length === 0) return 0;

  const values = newAssetIds.map(assetId => ({
    asset_id: assetId,
    collection_id: collectionId,
  }));

  const result = await db
    .insert(assetCollectionMemberships)
    .values(values) as any;

  return result.rowCount ?? 0;
}

/**
 * Bulk remove assets from a collection
 */
export async function bulkRemoveAssetsFromCollection(
  assetIds: string[],
  collectionId: string
): Promise<number> {
  if (assetIds.length === 0) return 0;

  const result = await db
    .delete(assetCollectionMemberships)
    .where(
      and(
        inArray(assetCollectionMemberships.asset_id, assetIds),
        eq(assetCollectionMemberships.collection_id, collectionId)
      )
    ) as any;

  return result.rowCount ?? 0;
}
