import { z } from "zod";

/**
 * Style Reference Metadata
 *
 * Metadata about a single style reference image available for Claude to select.
 * Stored in job.metadata.style_refs_metadata after asset collection.
 */
export const StyleRefMetadataSchema = z.object({
  asset_id: z.string().uuid().describe("Asset UUID"),
  file_path: z.string().describe("Absolute filesystem path to reference image"),
  file_name: z
    .string()
    .describe("Filename for Claude to reference (e.g., 'style_ref_1.png')"),
  ref_type: z
    .string()
    .describe("Reference type: logo, typography, color_palette, scene_example"),
});

export type StyleRefMetadata = z.infer<typeof StyleRefMetadataSchema>;

/**
 * Narrator Pose Metadata
 *
 * Metadata about a single narrator pose image available for Claude to select.
 * Stored in job.metadata.narrator_poses_metadata after asset collection.
 */
export const NarratorPoseMetadataSchema = z.object({
  asset_id: z.string().uuid().describe("Asset UUID"),
  file_path: z
    .string()
    .describe("Absolute filesystem path to narrator pose image"),
  file_name: z
    .string()
    .describe(
      "Filename for Claude to reference (e.g., 'narrator_pointing_left.png')",
    ),
  pose_name: z
    .string()
    .describe(
      "Pose action name: pointing_left, neutral, excited, explaining, etc.",
    ),
});

export type NarratorPoseMetadata = z.infer<typeof NarratorPoseMetadataSchema>;

/**
 * Job Metadata Schema
 *
 * Defines the structure of content_jobs.metadata JSONB field.
 * Extends base metadata with style libraries and narrator system fields.
 *
 * **Style Library Fields:**
 * - style_library_id: Selected library UUID
 * - style_text_guidelines: Resolved text guidelines from library
 * - style_refs_metadata: Array of available style reference images
 *
 * **Narrator Fields:**
 * - narrator_id: Selected narrator UUID
 * - narrator_poses_metadata: Array of available narrator pose images
 *
 * **Legacy Fields:**
 * - style_asset_context: Old illustration format style context (deprecated, kept for backward compat)
 * - per_video_assets: Assembled reference assets (existing field)
 *
 * Usage: Validate job.metadata when assembling per-video assets or selecting references.
 */
export const JobMetadataSchema = z
  .object({
    // === Style Libraries ===
    style_library_id: z
      .string()
      .uuid()
      .optional()
      .describe("Selected style library UUID"),
    style_text_guidelines: z
      .string()
      .optional()
      .describe("Resolved text styling guidelines from style collection"),
    style_refs_metadata: z
      .array(StyleRefMetadataSchema)
      .optional()
      .describe("Available style reference images for Claude to select from"),

    // === Narrators ===
    narrator_id: z
      .string()
      .uuid()
      .optional()
      .describe("Selected PNG narrator UUID"),
    narrator_poses_metadata: z
      .array(NarratorPoseMetadataSchema)
      .optional()
      .describe("Available narrator pose images for Claude to select from"),

    // === Legacy / Existing Fields ===
    style_asset_context: z
      .string()
      .optional()
      .describe(
        "DEPRECATED: Old illustration format style context (replaced by style_collections)",
      ),
    per_video_assets: z
      .record(z.unknown())
      .optional()
      .describe("Assembled per-video reference assets (existing field)"),

    // === Comparison Format ===
    comparison: z
      .record(z.unknown())
      .optional()
      .describe("Tech comparison format metadata"),

    // === Generic Extension ===
    // Allow other fields for format-specific metadata
  })
  .passthrough();

export type JobMetadata = z.infer<typeof JobMetadataSchema>;
