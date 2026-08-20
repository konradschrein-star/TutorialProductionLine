import { eq, and, isNull, or, inArray, desc } from "drizzle-orm";
import {
  db,
  assets,
  characterStateTypes,
  environments,
  characters,
  sceneFrameSequences,
} from "../db";
import type { Asset, NewAsset } from "@repo/db";
import {
  resolveAssets,
  type AssetResolutionContext,
  type AssetResolutionQuery,
} from "@repo/domain";
import { deleteStyleAssetFile } from "../services/local-storage-service";

export type { Asset };

/** Literal union of the `assets.asset_type` Postgres enum's values. */
type AssetType = Asset["asset_type"];

export interface CreateAssetInput {
  name: string;
  description: string;
  asset_type: string;
  origin?: string;
  channel_id?: string | null;
  archetype_id?: string | null;
  format?: string | null;
  tags?: string[];
  file_path?: string | null;
  r2_key?: string | null;
  file_name: string;
  file_format: string;
  width?: number | null;
  height?: number | null;
  size_bytes?: number | null;
  background_removed?: boolean;
  quality_rating?: number | null;
  status?: string;
  generation_recipe?: Record<string, unknown> | null;
  parent_asset_id?: string | null;
  character_id?: string | null;
  waveform_data?: number[] | null;
  duration_seconds?: number | null;
  variant_type?: string | null;
  variant_metadata?: Record<string, unknown> | null;
}

export interface ListAssetsFilter {
  asset_type?: string | string[];
  archetype_id?: string;
  channel_id?: string;
  format?: string;
  status?: string;
  character_id?: string;
  tags?: string[];
}

export async function listAssets(
  filter: ListAssetsFilter = {},
): Promise<Asset[]> {
  const conditions = [];

  if (filter.asset_type) {
    if (Array.isArray(filter.asset_type)) {
      conditions.push(
        inArray(assets.asset_type, filter.asset_type as AssetType[]),
      );
    } else {
      conditions.push(eq(assets.asset_type, filter.asset_type as AssetType));
    }
  }
  if (filter.archetype_id)
    conditions.push(eq(assets.archetype_id, filter.archetype_id));
  if (filter.channel_id)
    conditions.push(eq(assets.channel_id, filter.channel_id));
  if (filter.format) conditions.push(eq(assets.format, filter.format));
  if (filter.status) conditions.push(eq(assets.status, filter.status));
  if (filter.character_id)
    conditions.push(eq(assets.character_id, filter.character_id));

  const query = db.select().from(assets);
  if (conditions.length > 0) {
    return query.where(and(...conditions)).orderBy(desc(assets.created_at));
  }
  return query.orderBy(desc(assets.created_at));
}

export async function getAssetById(id: string): Promise<Asset | null> {
  const rows = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createAsset(data: CreateAssetInput): Promise<Asset> {
  const rows = await db
    .insert(assets)
    .values(data as NewAsset)
    .returning();
  return rows[0]!;
}

export async function updateAsset(
  id: string,
  patch: Partial<CreateAssetInput>,
): Promise<Asset | null> {
  const rows = await db
    .update(assets)
    .set({
      ...patch,
      asset_type: patch.asset_type as AssetType | undefined,
      updated_at: new Date(),
    })
    .where(eq(assets.id, id))
    .returning();
  return rows[0] ?? null;
}

/**
 * Check whether an asset is referenced by any other entity.
 *
 * Returns { inUse: false, reason: null } when safe to delete.
 * Returns { inUse: true, reason: "..." } on the first reference found.
 *
 * Checks (in order):
 *   1. environments.background_asset_id  — RESTRICT in DB, but better UX to catch early
 *   2. characters.reference_sheet_asset_id — SET NULL in DB, silent data loss
 *   3. scene_frame_sequences.asset_id     — SET NULL in DB, silent data loss
 *   4. scene_frame_sequences.seed_asset_id — SET NULL in DB, silent data loss
 *   5. assets.parent_asset_id             — derived children would lose their lineage
 */
export async function isAssetInUse(
  id: string,
): Promise<{ inUse: boolean; reason: string | null }> {
  // 1. Environment background
  const envRows = await db
    .select({ id: environments.id, name: environments.name })
    .from(environments)
    .where(eq(environments.background_asset_id, id))
    .limit(1);
  if (envRows.length > 0) {
    return {
      inUse: true,
      reason: `Asset is the background of environment "${envRows[0]!.name}"`,
    };
  }

  // 2. Character reference sheet
  const charRows = await db
    .select({ id: characters.id, name: characters.name })
    .from(characters)
    .where(eq(characters.reference_sheet_asset_id, id))
    .limit(1);
  if (charRows.length > 0) {
    return {
      inUse: true,
      reason: `Asset is the reference sheet of character "${charRows[0]!.name}"`,
    };
  }

  // 3. Scene frame sequences — asset_id
  const sfsAssetRows = await db
    .select({ id: sceneFrameSequences.id })
    .from(sceneFrameSequences)
    .where(eq(sceneFrameSequences.asset_id, id))
    .limit(1);
  if (sfsAssetRows.length > 0) {
    return {
      inUse: true,
      reason: "Asset is referenced as a scene frame image",
    };
  }

  // 4. Scene frame sequences — seed_asset_id
  const sfsSeedRows = await db
    .select({ id: sceneFrameSequences.id })
    .from(sceneFrameSequences)
    .where(eq(sceneFrameSequences.seed_asset_id, id))
    .limit(1);
  if (sfsSeedRows.length > 0) {
    return {
      inUse: true,
      reason: "Asset is referenced as a scene frame seed image",
    };
  }

  // 5. Derivation children
  const childRows = await db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.parent_asset_id, id))
    .limit(1);
  if (childRows.length > 0) {
    return {
      inUse: true,
      reason: "Asset has derived child assets that depend on it",
    };
  }

  return { inUse: false, reason: null };
}

/**
 * Delete an asset — removes file from SSD (if present) then DB record.
 */
export async function deleteAsset(id: string): Promise<void> {
  const asset = await getAssetById(id);
  if (!asset) return;

  if (asset.file_path) {
    await deleteStyleAssetFile(asset.file_path).catch(() => {});
  }

  await db.delete(assets).where(eq(assets.id, id));
}

/**
 * Resolve assets for a production context using the tiered resolution algorithm.
 * Executes the full tier cascade and returns the best-match assets per type.
 */
export async function resolveAssetsForProduction(
  context: AssetResolutionContext,
  query: AssetResolutionQuery,
): Promise<Asset[]> {
  const spec = resolveAssets(context, query);
  const resolvedByType: Record<string, Asset> = {};

  for (const tier of spec.tiers) {
    const remaining = spec.asset_types.filter((t) => !resolvedByType[t]);
    if (remaining.length === 0) break;

    const conditions: ReturnType<typeof eq>[] = [
      inArray(assets.asset_type, remaining as AssetType[]) as any,
    ];

    if (spec.require_approved) {
      conditions.push(eq(assets.status, "approved") as any);
    }

    if (tier.channel_id)
      conditions.push(eq(assets.channel_id, tier.channel_id) as any);
    else conditions.push(isNull(assets.channel_id) as any);

    if (tier.archetype_id)
      conditions.push(eq(assets.archetype_id, tier.archetype_id) as any);
    else conditions.push(isNull(assets.archetype_id) as any);

    if (tier.format) conditions.push(eq(assets.format, tier.format) as any);
    else conditions.push(isNull(assets.format) as any);

    const rows = await db
      .select()
      .from(assets)
      .where(and(...conditions))
      .orderBy(desc(assets.quality_rating), desc(assets.updated_at));

    for (const row of rows) {
      if (!resolvedByType[row.asset_type]) {
        resolvedByType[row.asset_type] = row;
      }
    }
  }

  return Object.values(resolvedByType);
}

/**
 * Get all state assets for a character, with completeness info against canonical states.
 */
export async function getCharacterStateAssets(
  characterId: string,
): Promise<{ states: Asset[]; totalCanonicalStates: number }> {
  const [stateAssets, allStateTypes] = await Promise.all([
    db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.character_id, characterId),
          eq(assets.asset_type, "character_state"),
        ),
      )
      .orderBy(desc(assets.created_at)),
    db.select().from(characterStateTypes),
  ]);

  return {
    states: stateAssets,
    totalCanonicalStates: allStateTypes.length,
  };
}

export interface AssetUsageResult {
  total: number;
  jobs: Array<{
    id: string;
    title: string;
    status: string;
    format: string;
    created_at: Date;
  }>;
  has_more: boolean;
}

export async function getAssetUsage(
  assetId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<AssetUsageResult> {
  const { limit = 50, offset = 0 } = options;
  // Placeholder: asset usage tracking requires join on assembly_manifest JSONB
  // Full implementation deferred to media assets phase
  return { total: 0, jobs: [], has_more: false };
}

export async function getVariants(assetId: string): Promise<Asset[]> {
  return db
    .select()
    .from(assets)
    .where(eq(assets.parent_asset_id, assetId))
    .orderBy(desc(assets.created_at));
}

export interface AssetWithVariants extends Asset {
  variants: Asset[];
}

/**
 * Get an asset along with all of its derivative variants
 * (assets whose parent_asset_id points back to this asset).
 */
export async function getAssetWithVariants(
  assetId: string,
): Promise<AssetWithVariants | null> {
  const asset = await getAssetById(assetId);
  if (!asset) return null;

  const variants = await getVariants(assetId);
  return { ...asset, variants };
}

/**
 * Get the parent (source) asset of a variant.
 * Returns null if the asset has no parent_asset_id or doesn't exist.
 */
export async function getParentAsset(assetId: string): Promise<Asset | null> {
  const asset = await getAssetById(assetId);
  if (!asset || !asset.parent_asset_id) return null;

  return getAssetById(asset.parent_asset_id);
}
