import { z } from "zod";
import { AssetType } from "../enums/asset-type.js";

/**
 * Asset Manifest Entry Schema
 *
 * Represents a single asset tracked for a content job.
 * Stored in the r2_asset_manifest JSONB field on content_jobs table.
 *
 * The `key` field now holds a local filesystem path relative to LOCAL_MEDIA_ROOT,
 * or a logical job-scoped identifier (e.g. "{channel_id}/{job_id}/{filename}").
 * Assets are stored on the local VPS filesystem under LOCAL_MEDIA_ROOT.
 *
 * This manifest is the authoritative list for garbage collection.
 * When a job is deleted, the GC worker iterates the manifest and
 * deletes every listed local file. No orphaned files by design.
 */
export const AssetManifestEntrySchema = z.object({
  key: z.string().min(1).describe("Asset path key (local filesystem path or logical identifier)"),
  type: AssetType.describe("Asset category"),
  size_bytes: z.number().int().nonnegative().describe("File size in bytes"),
  scene_index: z.number().int().nonnegative().optional().describe("Scene index for per-scene assets (e.g. broll images)"),
});

export type AssetManifestEntry = z.infer<typeof AssetManifestEntrySchema>;

/**
 * Asset Manifest Schema
 *
 * Array of all assets associated with a content job.
 * Stored in PostgreSQL as JSONB.
 */
export const AssetManifestSchema = z.array(AssetManifestEntrySchema);

export type AssetManifest = z.infer<typeof AssetManifestSchema>;
