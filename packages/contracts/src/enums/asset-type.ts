import { z } from "zod";

/**
 * Asset Type Enum
 *
 * MIME-style categorization of assets tracked in the asset manifest.
 * Used in r2_asset_manifest JSONB field for tracking all assets
 * associated with a content job.
 *
 * Categories:
 * - audio/*: TTS, background music, sound effects
 * - video/*: Raw VA footage (HeyGen), composition output, final render
 * - image/*: Thumbnails, b-roll assets
 * - text/*: Scripts, subtitle files
 *
 * Extensible design - new types can be added without schema migration.
 */
export const AssetType = z.enum([
  "audio/tts",
  "audio/music",
  "audio/sfx",
  "video/raw-va-footage",
  "video/composition",
  "video/final-render",
  "image/thumbnail",
  "image/broll",
  "text/script",
  "text/subtitles",
  // Comparison format — product images
  "image/product-hero-candidate", // Sourced or VA-uploaded candidate, not yet selected
  "image/product-hero-selected",  // VA-approved hero image used in the render
]);

export type AssetType = z.infer<typeof AssetType>;
