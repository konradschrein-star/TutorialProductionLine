/**
 * Style Library Repository
 *
 * Replaces the old style-collection-repository.ts, now backed by the
 * `format_style_libraries` / `format_style_library_assets` tables.
 *
 * Breaking schema changes vs. old style_collections:
 *  - No channel_id (format-first design, global per format)
 *  - No archetype_id
 *  - No tiered resolution (simple format filter)
 *
 * Functions exposed by this module retain the old surface names where
 * possible so callers can be migrated incrementally (SS-5 will update
 * UI consumers that read channel_id / archetype_id from the returned
 * object).
 */

import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  formatStyleLibraries,
  formatStyleLibraryAssets,
  assets,
  type FormatStyleLibrary,
} from "@/lib/db";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type { FormatStyleLibrary };

/**
 * Flat representation of a library with its linked reference assets.
 * `channel_id` and `archetype_id` are always null – kept for backward
 * compatibility with pages that read them (they will be removed in SS-5).
 */
export interface StyleLibraryWithAssets extends FormatStyleLibrary {
  /** @deprecated always null — format_style_libraries has no channel scoping */
  channel_id: null;
  /** @deprecated always null — format_style_libraries has no archetype scoping */
  archetype_id: null;
  reference_assets: Array<{
    id: string;
    asset_id: string;
    file_path: string | null;
    file_name: string;
    description: string | null;
    ref_type: string;
    display_order: number;
  }>;
}

/**
 * @alias StyleCollectionWithAssets — kept for incremental caller migration.
 */
export type StyleCollectionWithAssets = StyleLibraryWithAssets;

export interface ListStyleLibrariesFilter {
  format?: string;
  is_active?: boolean;
  /** @deprecated no-op — format_style_libraries has no channel scoping */
  channel_id?: string;
  /** @deprecated no-op — format_style_libraries has no archetype scoping */
  archetype_id?: string;
}

/** @alias ListStyleCollectionsFilter */
export type ListStyleCollectionsFilter = ListStyleLibrariesFilter;

export interface CreateStyleLibraryInput {
  name: string;
  description: string;
  format: string;
  text_guidelines?: string;
  metadata?: Record<string, unknown>;
  is_active?: boolean;
  asset_refs?: Array<{
    asset_id: string;
    ref_type: string;
    display_order?: number;
  }>;
  /** @deprecated ignored — no channel scoping */
  channel_id?: string | null;
  /** @deprecated ignored — no archetype scoping */
  archetype_id?: string | null;
}

/** @alias CreateStyleCollectionInput */
export type CreateStyleCollectionInput = CreateStyleLibraryInput;

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/** Fetch reference assets for a library and attach them. */
async function attachAssets(
  library: FormatStyleLibrary,
): Promise<StyleLibraryWithAssets> {
  const linkedAssets = await db
    .select({
      id: formatStyleLibraryAssets.id,
      asset_id: formatStyleLibraryAssets.asset_id,
      ref_type: formatStyleLibraryAssets.ref_type,
      display_order: formatStyleLibraryAssets.display_order,
      file_path: assets.file_path,
      file_name: assets.file_name,
      description: assets.description,
    })
    .from(formatStyleLibraryAssets)
    .innerJoin(assets, eq(formatStyleLibraryAssets.asset_id, assets.id))
    .where(eq(formatStyleLibraryAssets.library_id, library.id))
    .orderBy(formatStyleLibraryAssets.display_order);

  return {
    ...library,
    channel_id: null,
    archetype_id: null,
    reference_assets: linkedAssets,
  };
}

// ---------------------------------------------------------------------------
// New-style exports (style-library naming)
// ---------------------------------------------------------------------------

/**
 * List style libraries with optional filtering.
 * `channel_id` and `archetype_id` filter fields are accepted but ignored.
 */
export async function getStyleLibraries(
  filters?: ListStyleLibrariesFilter,
): Promise<FormatStyleLibrary[]> {
  const conditions = [];
  if (filters?.format) {
    conditions.push(eq(formatStyleLibraries.format, filters.format));
  }
  if (filters?.is_active !== undefined) {
    conditions.push(eq(formatStyleLibraries.is_active, filters.is_active));
  }

  return db
    .select()
    .from(formatStyleLibraries)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(formatStyleLibraries.created_at);
}

/**
 * Get a style library by ID (without assets).
 */
export async function getStyleLibraryById(
  id: string,
): Promise<FormatStyleLibrary | null> {
  const [library] = await db
    .select()
    .from(formatStyleLibraries)
    .where(eq(formatStyleLibraries.id, id))
    .limit(1);
  return library ?? null;
}

/**
 * Get the reference assets linked to a library.
 */
export async function getStyleLibraryAssets(libraryId: string) {
  return db
    .select({
      id: formatStyleLibraryAssets.id,
      asset_id: formatStyleLibraryAssets.asset_id,
      ref_type: formatStyleLibraryAssets.ref_type,
      display_order: formatStyleLibraryAssets.display_order,
      file_path: assets.file_path,
      file_name: assets.file_name,
      description: assets.description,
    })
    .from(formatStyleLibraryAssets)
    .innerJoin(assets, eq(formatStyleLibraryAssets.asset_id, assets.id))
    .where(eq(formatStyleLibraryAssets.library_id, libraryId))
    .orderBy(formatStyleLibraryAssets.display_order);
}

// ---------------------------------------------------------------------------
// Backward-compatible exports (style-collection naming)
// ---------------------------------------------------------------------------

/**
 * List style libraries – backward-compatible alias.
 * `channel_id` / `archetype_id` filters are silently ignored.
 */
export async function listStyleCollections(
  filter: ListStyleLibrariesFilter = {},
): Promise<FormatStyleLibrary[]> {
  return getStyleLibraries(filter);
}

/**
 * Get a library by ID with reference assets attached.
 * Returns a `StyleCollectionWithAssets`-compatible shape.
 */
export async function getStyleCollectionById(
  id: string,
): Promise<StyleLibraryWithAssets | null> {
  const library = await getStyleLibraryById(id);
  if (!library) return null;
  return attachAssets(library);
}

/**
 * Create a new style library (with optional initial asset links).
 */
export async function createStyleCollection(
  data: CreateStyleLibraryInput,
): Promise<FormatStyleLibrary> {
  if (!data.format) {
    throw new Error("format is required for style libraries");
  }

  const [library] = await db
    .insert(formatStyleLibraries)
    .values({
      name: data.name,
      description: data.description,
      format: data.format,
      text_guidelines: data.text_guidelines,
      metadata: data.metadata,
      is_active: data.is_active ?? true,
    })
    .returning();

  const assetRefs = data.asset_refs ?? [];
  if (assetRefs.length > 0) {
    await db.insert(formatStyleLibraryAssets).values(
      assetRefs.map((ref, index) => ({
        library_id: library!.id,
        asset_id: ref.asset_id,
        ref_type: ref.ref_type,
        display_order: ref.display_order ?? index,
      })),
    );
  }

  return library!;
}

/**
 * Update library metadata.
 * `channel_id` / `archetype_id` patch fields are silently ignored.
 */
export async function updateStyleCollection(
  id: string,
  patch: Partial<{
    name: string;
    description: string;
    format: string;
    text_guidelines: string | null;
    metadata: Record<string, unknown>;
    is_active: boolean;
    /** @deprecated ignored */
    channel_id?: string | null;
    /** @deprecated ignored */
    archetype_id?: string | null;
  }>,
): Promise<FormatStyleLibrary | null> {
  // Strip deprecated fields before writing
  const { channel_id: _ch, archetype_id: _ar, ...safeFields } = patch;
  void _ch;
  void _ar;

  const [updated] = await db
    .update(formatStyleLibraries)
    .set({ ...safeFields, updated_at: new Date() })
    .where(eq(formatStyleLibraries.id, id))
    .returning();

  return updated ?? null;
}

/**
 * Delete a library (cascades to asset links; preserves assets themselves).
 */
export async function deleteStyleCollection(id: string): Promise<void> {
  await db.delete(formatStyleLibraries).where(eq(formatStyleLibraries.id, id));
}

/**
 * Add asset links to an existing library.
 */
export async function addStyleCollectionAssets(
  libraryId: string,
  assetRefs: Array<{
    asset_id: string;
    ref_type: string;
    display_order?: number;
  }>,
): Promise<void> {
  if (assetRefs.length === 0) return;

  await db.insert(formatStyleLibraryAssets).values(
    assetRefs.map((ref) => ({
      library_id: libraryId,
      asset_id: ref.asset_id,
      ref_type: ref.ref_type,
      display_order: ref.display_order ?? 0,
    })),
  );
}

/**
 * Add a single asset to a library.
 */
export async function addAssetToStyleCollection(
  libraryId: string,
  assetId: string,
  refType: string,
  displayOrder = 0,
): Promise<void> {
  await addStyleCollectionAssets(libraryId, [
    { asset_id: assetId, ref_type: refType, display_order: displayOrder },
  ]);
}

/**
 * Remove an asset link from a library.
 */
export async function removeStyleCollectionAsset(
  libraryId: string,
  assetId: string,
): Promise<void> {
  await db
    .delete(formatStyleLibraryAssets)
    .where(
      and(
        eq(formatStyleLibraryAssets.library_id, libraryId),
        eq(formatStyleLibraryAssets.asset_id, assetId),
      ),
    );
}

/**
 * Resolve a style library for a job context (format-only lookup).
 *
 * Replaces the tiered resolution from the old system. Since libraries are
 * now format-scoped only, we simply return the first active library for the
 * given format. Returns null if none found.
 *
 * `channel_id` and `archetype_id` are accepted for call-site compatibility
 * but are not used in the lookup.
 */
export async function resolveStyleCollectionForJob(context: {
  format: string;
  /** @deprecated ignored — no channel scoping */
  channel_id?: string;
  /** @deprecated ignored — no archetype scoping */
  archetype_id?: string | null;
}): Promise<StyleLibraryWithAssets | null> {
  const [library] = await db
    .select()
    .from(formatStyleLibraries)
    .where(
      and(
        eq(formatStyleLibraries.is_active, true),
        eq(formatStyleLibraries.format, context.format),
      ),
    )
    .orderBy(formatStyleLibraries.updated_at)
    .limit(1);

  if (!library) return null;
  return attachAssets(library);
}
