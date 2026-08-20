import { z } from "zod";
import { ContentFormat } from "../enums/content-format.js";
import { RenderEngine } from "../enums/render-engine.js";

/**
 * Content Template Schema
 *
 * Templates define the pipeline shape, AI prompts, render configuration,
 * and asset requirements for each content format.
 *
 * Templates are stored in PostgreSQL JSONB and are intentionally flexible
 * to allow pipeline evolution without schema migration.
 *
 * New content formats are added by inserting a new template row,
 * not by modifying backend code.
 *
 * Fields:
 * - id: Unique template identifier
 * - name: Human-readable template name
 * - format: Content format enum (EXPLAINER, DOCUMENTARY, etc.)
 * - pipeline_stages: Ordered array of stage identifiers
 * - prompts: Record of stage-specific AI prompts
 * - render_config: Engine-specific configuration (aspect ratio, duration, etc.)
 * - required_assets: Asset types needed for this template
 * - metadata: Flexible additional data (tags, categories, etc.)
 */
export const ContentTemplateSchema = z.object({
  id: z.string().uuid().describe("Unique template identifier"),
  name: z.string().min(1).describe("Human-readable template name"),
  format: ContentFormat.describe("Content format category"),

  pipeline_stages: z
    .array(z.string())
    .min(1)
    .describe("Ordered array of stage identifiers"),

  prompts: z
    .record(z.string(), z.string())
    .describe("Record of stage-specific AI prompts (key: stage, value: prompt)"),

  render_config: z
    .object({
      engine: RenderEngine.optional().describe("Preferred render engine"),
      aspect_ratio: z.enum(["16:9", "9:16"]).optional(),
      target_duration_seconds: z.number().int().positive().optional(),
      default_resolution: z.enum(["1080p", "4k"]).optional(),
      // Runtime-consumed fields (read by processors and render workers)
      captions_enabled: z.boolean().optional().describe("Enable caption rendering"),
      voice_id: z.string().optional().describe("ElevenLabs voice ID for TTS"),
      image_model: z.string().optional().describe("AI image model preference (e.g. seedream)"),
      qc_image_review_required: z.boolean().optional().describe("Require VA to review scene images before QMS"),
      settings: z.object({
        fps: z.number().int().positive().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
      }).optional().describe("Remotion render settings"),
      hook_duration_seconds: z.number().positive().optional().describe("Duration of hook segment"),
      hook_scene_seconds: z.number().positive().optional().describe("Duration of each hook scene"),
    })
    .passthrough()
    .describe("Engine-specific configuration"),

  required_assets: z
    .array(z.string())
    .describe("Asset types needed for this template"),

  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Flexible additional data (tags, categories, etc.)"),

  created_at: z.string().datetime().describe("Template creation timestamp"),
  updated_at: z.string().datetime().describe("Template last update timestamp"),
});

export type ContentTemplate = z.infer<typeof ContentTemplateSchema>;
