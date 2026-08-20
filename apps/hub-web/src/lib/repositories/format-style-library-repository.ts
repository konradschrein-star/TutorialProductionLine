import { eq, and, desc, sql } from "drizzle-orm";
import { db, formatStyleLibraries, formatStyleLibraryAssets } from "../db";
import type {
  FormatStyleLibrary,
  NewFormatStyleLibrary,
  FormatStyleLibraryAsset,
  NewFormatStyleLibraryAsset,
} from "@repo/db";

export type { FormatStyleLibrary };

export interface FormatStyleLibraryWithCount extends FormatStyleLibrary {
  reference_count: number;
}

export interface FormatStyleLibraryWithAssets extends FormatStyleLibrary {
  reference_assets: Array<{
    asset_id: string;
    ref_type: string;
    display_order: number;
    // Note: file_path and file_name will be added once assets table integration is complete
  }>;
}

export interface CreateFormatStyleLibraryInput {
  name: string;
  description: string;
  format: string; // EXPLAINER, DOCUMENTARY, etc.
  text_guidelines?: string;
  metadata?: Record<string, unknown>;
  // Asset links
  asset_refs: Array<{
    asset_id: string;
    ref_type: string; // "style_guide", "character", "layout_reference", "background", etc.
    display_order?: number;
  }>;
}

export interface ListFormatStyleLibrariesFilter {
  format?: string;
  is_active?: boolean;
}

/**
 * List format style libraries with optional filtering.
 * Returns libraries ordered by most recently updated, with linked asset counts.
 */
export async function listFormatStyleLibraries(
  filter: ListFormatStyleLibrariesFilter = {},
): Promise<FormatStyleLibraryWithCount[]> {
  const conditions = [];

  if (filter.format !== undefined) {
    conditions.push(eq(formatStyleLibraries.format, filter.format));
  }

  if (filter.is_active !== undefined) {
    conditions.push(eq(formatStyleLibraries.is_active, filter.is_active));
  }

  const query = db
    .select({
      library: formatStyleLibraries,
      reference_count: sql<number>`cast(count(${formatStyleLibraryAssets.id}) as integer)`,
    })
    .from(formatStyleLibraries)
    .leftJoin(
      formatStyleLibraryAssets,
      eq(formatStyleLibraries.id, formatStyleLibraryAssets.library_id),
    )
    .groupBy(formatStyleLibraries.id)
    .orderBy(desc(formatStyleLibraries.updated_at));

  const rows = await (conditions.length > 0
    ? query.where(and(...conditions))
    : query);

  return rows.map((row) => ({
    ...row.library,
    reference_count: row.reference_count ?? 0,
  }));
}

/**
 * Get a format style library by ID with linked reference assets.
 * Returns null if not found.
 */
export async function getFormatStyleLibraryById(
  id: string,
): Promise<FormatStyleLibraryWithAssets | null> {
  // Get library
  const [library] = await db
    .select()
    .from(formatStyleLibraries)
    .where(eq(formatStyleLibraries.id, id))
    .limit(1);

  if (!library) return null;

  // Get linked assets
  const linkedAssets = await db
    .select({
      asset_id: formatStyleLibraryAssets.asset_id,
      ref_type: formatStyleLibraryAssets.ref_type,
      display_order: formatStyleLibraryAssets.display_order,
    })
    .from(formatStyleLibraryAssets)
    .where(eq(formatStyleLibraryAssets.library_id, id))
    .orderBy(formatStyleLibraryAssets.display_order);

  return {
    ...library,
    reference_assets: linkedAssets,
  };
}

/**
 * Create a new format style library with linked reference assets.
 * Creates both the library and asset link entries.
 */
export async function createFormatStyleLibrary(
  data: CreateFormatStyleLibraryInput,
): Promise<FormatStyleLibrary> {
  // Create library
  const [library] = await db
    .insert(formatStyleLibraries)
    .values({
      name: data.name,
      description: data.description,
      format: data.format,
      text_guidelines: data.text_guidelines,
      metadata: data.metadata,
    } as NewFormatStyleLibrary)
    .returning();

  // Create asset links
  if (data.asset_refs.length > 0) {
    await db.insert(formatStyleLibraryAssets).values(
      data.asset_refs.map((ref, index) => ({
        library_id: library.id,
        asset_id: ref.asset_id,
        ref_type: ref.ref_type,
        display_order: ref.display_order ?? index,
      })),
    );
  }

  return library;
}

/**
 * Update format style library metadata.
 * Does NOT modify linked assets (use separate asset link management functions).
 */
export async function updateFormatStyleLibrary(
  id: string,
  patch: Partial<
    Pick<
      FormatStyleLibrary,
      | "name"
      | "description"
      | "text_guidelines"
      | "format"
      | "metadata"
      | "is_active"
    >
  >,
): Promise<FormatStyleLibrary | null> {
  const [updated] = await db
    .update(formatStyleLibraries)
    .set({ ...patch, updated_at: new Date() })
    .where(eq(formatStyleLibraries.id, id))
    .returning();

  return updated ?? null;
}

/**
 * Delete a format style library.
 * Cascade deletes asset links (formatStyleLibraryAssets) but preserves assets themselves.
 */
export async function deleteFormatStyleLibrary(id: string): Promise<void> {
  await db.delete(formatStyleLibraries).where(eq(formatStyleLibraries.id, id));
}

/**
 * Add an asset to a format style library.
 * Creates a link between the library and an asset.
 */
export async function addAssetToLibrary(
  libraryId: string,
  assetId: string,
  refType: string,
  displayOrder?: number,
): Promise<FormatStyleLibraryAsset> {
  // Get current max display_order if not provided
  if (displayOrder === undefined) {
    const existing = await db
      .select()
      .from(formatStyleLibraryAssets)
      .where(eq(formatStyleLibraryAssets.library_id, libraryId))
      .orderBy(desc(formatStyleLibraryAssets.display_order))
      .limit(1);

    displayOrder = existing.length > 0 ? existing[0].display_order + 1 : 0;
  }

  const [link] = await db
    .insert(formatStyleLibraryAssets)
    .values({
      library_id: libraryId,
      asset_id: assetId,
      ref_type: refType,
      display_order: displayOrder,
    } as NewFormatStyleLibraryAsset)
    .returning();

  return link;
}

/**
 * Remove an asset from a format style library.
 * Deletes the link but preserves the asset itself.
 */
export async function removeAssetFromLibrary(
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
