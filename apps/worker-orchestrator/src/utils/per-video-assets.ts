import { readFile, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { eq, and, isNull, or, inArray, desc } from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";
import { assets } from "@repo/db";
import { resolveAssets } from "@repo/domain";
import type { AssetResolutionContext } from "@repo/domain";

export interface ResolvedAssetRef {
  asset_id: string;
  file_path: string; // path in the per-video ref directory
  description?: string; // asset description field for name/context matching
}

export interface PerVideoAssets {
  style_guide?: ResolvedAssetRef;
  layout_reference?: ResolvedAssetRef;
  characters: ResolvedAssetRef[];
  backgrounds: ResolvedAssetRef[];
}

/**
 * Assemble the per-video reference folder for a production job.
 *
 * Queries the asset graph using the production context (channel + archetype),
 * copies resolved assets into a job-specific reference directory on SSD,
 * and returns the assembled PerVideoAssets map with local file paths.
 *
 * The reference folder is used by ai-generation.ts to load reference images
 * and pass them to AI33 via buildReferenceInjectedPrompt().
 *
 * The returned PerVideoAssets map should be written to job.metadata.per_video_assets
 * by the caller (asset-collection processor).
 *
 * @param db           - Drizzle client
 * @param context      - Production context (channel_id, archetype_id, format)
 * @param refDir       - Target directory: {LOCAL_MEDIA_ROOT}/{job_id}/ref/
 */
export async function assemblePerVideoAssets(
  db: DrizzleClient,
  context: AssetResolutionContext,
  refDir: string,
): Promise<PerVideoAssets> {
  console.log(
    JSON.stringify({
      level: "debug",
      message: "Starting per-video asset assembly",
      channel_id: context.channel_id,
      archetype_id: context.archetype_id,
      format: context.format,
      ref_dir: refDir,
    }),
  );

  await mkdir(refDir, { recursive: true });

  // Historically CE skipped the style_guide slot entirely: the only seeded CE
  // style_guide was a "colored boxes" asset for an unimplemented layout system
  // that poisoned generation (the model copied the boxes instead of drawing
  // CE-style minimalist line art). That skip is no longer needed — a real
  // approved CE line-art style_guide now exists, and resolveAssets below
  // requires `approved` status, so the old colored-box drafts can never be
  // selected. Injecting the real reference is exactly what makes CE art
  // consistent, so we no longer skip it.
  const requestedAssetTypes = [
    "style_guide",
    "character",
    "character_state",
    "background",
    "layout_reference",
  ];

  const spec = resolveAssets(context, {
    asset_types: requestedAssetTypes,
    require_approved: true,
  });

  // Execute the tiered query — try tiers in priority order, return first non-empty result per type
  const resolvedByType: Record<string, (typeof assets.$inferSelect)[]> = {
    style_guide: [],
    character: [],
    character_state: [],
    background: [],
    layout_reference: [],
  };

  for (const tier of spec.tiers) {
    const remaining = spec.asset_types.filter(
      (t) => resolvedByType[t]!.length === 0,
    );
    if (remaining.length === 0) break;

    // Build WHERE conditions for this tier
    const conditions = [
      inArray(
        assets.asset_type,
        remaining as (typeof assets.$inferSelect.asset_type)[],
      ),
      eq(assets.status, "approved"),
    ];

    if (tier.channel_id)
      conditions.push(eq(assets.channel_id, tier.channel_id));
    else conditions.push(isNull(assets.channel_id));

    if (tier.archetype_id)
      conditions.push(eq(assets.archetype_id, tier.archetype_id));
    else conditions.push(isNull(assets.archetype_id));

    if (tier.format) conditions.push(eq(assets.format, tier.format));
    else conditions.push(isNull(assets.format));

    const rows = await db
      .select()
      .from(assets)
      .where(and(...conditions))
      .orderBy(desc(assets.quality_rating), desc(assets.updated_at));

    for (const row of rows) {
      if ((resolvedByType[row.asset_type]?.length ?? 0) === 0) {
        resolvedByType[row.asset_type] = [row];
      }
    }
  }

  // Copy resolved assets into the ref directory and build the result map
  const result: PerVideoAssets = { characters: [], backgrounds: [] }; // layout_reference and style_guide added conditionally below

  const copyAsset = async (
    asset: typeof assets.$inferSelect,
    slotName: string,
  ): Promise<ResolvedAssetRef | null> => {
    if (!asset.file_path || !existsSync(asset.file_path)) {
      console.log(
        JSON.stringify({
          level: "warn",
          message: "Per-video asset file not found on SSD — skipping",
          asset_id: asset.id,
          file_path: asset.file_path,
        }),
      );
      return null;
    }
    const ext = extname(asset.file_name) || ".png";
    const destName = `${slotName}_${asset.id}${ext}`;
    const destPath = join(refDir, destName);

    // Retry on ENOENT to handle race conditions (file deleted between existsSync and copyFile)
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await copyFile(asset.file_path, destPath);
        return {
          asset_id: asset.id,
          file_path: destPath,
          description: asset.description ?? undefined,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT" && attempt < 2) {
          // File disappeared — wait briefly and retry (may have been temporarily moved)
          await new Promise((resolve) =>
            setTimeout(resolve, 100 * (attempt + 1)),
          );
          continue;
        }
        // Non-retryable error or max retries reached
        break;
      }
    }

    console.error(
      JSON.stringify({
        level: "error",
        message: "Per-video asset copy failed after retries",
        asset_id: asset.id,
        file_path: asset.file_path,
        error: lastError?.message,
      }),
    );
    return null;
  };

  const styleGuideRows = resolvedByType["style_guide"] ?? [];
  if (styleGuideRows.length > 0) {
    const ref = await copyAsset(styleGuideRows[0]!, "style_guide");
    if (ref) result.style_guide = ref;
  }

  const layoutRefRows = resolvedByType["layout_reference"] ?? [];
  if (layoutRefRows.length > 0) {
    const ref = await copyAsset(layoutRefRows[0]!, "layout_reference");
    if (ref) result.layout_reference = ref;
  }

  for (const char of resolvedByType["character"] ?? []) {
    const ref = await copyAsset(char, `character_${char.id.slice(0, 8)}`);
    if (ref) result.characters.push(ref);
  }

  for (const bg of resolvedByType["background"] ?? []) {
    const ref = await copyAsset(bg, `background_${bg.id.slice(0, 8)}`);
    if (ref) result.backgrounds.push(ref);
  }

  console.log(
    JSON.stringify({
      level: "info",
      message: "Per-video reference assets assembled",
      ref_dir: refDir,
      style_guide: !!result.style_guide,
      layout_reference: !!result.layout_reference,
      character_count: result.characters.length,
      background_count: result.backgrounds.length,
    }),
  );

  return result;
}

/**
 * Load a reference image from disk into a Buffer with corruption detection.
 * Validates image format (PNG/JPEG magic numbers) and size constraints.
 * Returns null if the file doesn't exist or is corrupt (graceful degradation).
 */
export async function loadReferenceImage(
  filePath: string,
): Promise<Buffer | null> {
  console.log(
    JSON.stringify({
      level: "debug",
      message: "Loading reference image",
      file_path: filePath,
    }),
  );

  try {
    const buffer = await readFile(filePath);

    // Validate image format via magic number (first 4 bytes)
    const isPNG =
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47;
    const isJPEG =
      buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

    if (!isPNG && !isJPEG) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "Reference image corruption detected (invalid magic number)",
          file_path: filePath,
          size_bytes: buffer.length,
          first_bytes: buffer.slice(0, 4).toString("hex"),
        }),
      );
      return null;
    }

    // Validate reasonable size constraints (> 1KB, < 50MB)
    if (buffer.length < 1024) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "Reference image too small (likely corrupt or truncated)",
          file_path: filePath,
          size_bytes: buffer.length,
        }),
      );
      return null;
    }

    if (buffer.length > 50 * 1024 * 1024) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "Reference image exceeds size limit (> 50MB)",
          file_path: filePath,
          size_bytes: buffer.length,
        }),
      );
      return null;
    }

    const magicNumber = isPNG ? "PNG" : "JPEG";
    console.log(
      JSON.stringify({
        level: "info",
        message: "Reference image loaded successfully",
        file_path: filePath,
        size_bytes: buffer.length,
        format: magicNumber,
      }),
    );

    return buffer;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;

    // ENOENT is expected when a reference doesn't exist — soft degradation
    if (code === "ENOENT") {
      console.error(
        JSON.stringify({
          level: "error",
          message: "Reference image load failed",
          file_path: filePath,
          reason: "File not found (ENOENT)",
        }),
      );
      return null;
    }

    // Log unexpected errors (permission issues, I/O errors, etc.)
    console.error(
      JSON.stringify({
        level: "error",
        message: "Reference image load failed",
        file_path: filePath,
        error_code: code,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  }
}
