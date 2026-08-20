import { z } from "zod";
import { CompositionPlanSchema } from "./composition-plan.js";
import { ClauseTimingSchema } from "../clip-library.js";

/**
 * Visual type enum for scene asset sourcing.
 * Extensible: new types added here as new asset providers are integrated.
 *
 * Current:
 * - AVATAR_ON_CAMERA: HeyGen avatar video (VA-uploaded)
 * - BROLL_IMAGE: AI-generated still image with Ken Burns effect
 * - BROLL_VIDEO: Stock video clip (Phase 2 — Pexels/Storyblocks)
 *
 * Future procedural generation will use this field as a "structure type"
 * (like Minecraft dungeon/village/etc.) to drive composition layout.
 */
export const VisualTypeSchema = z.enum([
  "AVATAR_ON_CAMERA",
  "AVATAR_PIP",
  "BROLL_IMAGE",
  "BROLL_VIDEO",
]);

export type VisualType = z.infer<typeof VisualTypeSchema>;

/**
 * Scene-level structure for video composition.
 *
 * Lifecycle:
 * - Created by scene-analysis processor (no timing, no asset keys yet)
 * - visual_asset_key populated by asset-collection after image generation completes
 * - start_frame / end_frame / duration_frames computed by render worker from HeyGen duration
 */
export const SceneSchema = z.object({
  scene_index: z.number().int().nonnegative(),

  // Timing — null until render worker computes from HeyGen duration + pacing algo
  start_frame: z.number().int().nonnegative().nullable().default(null),
  end_frame: z.number().int().nonnegative().nullable().default(null),
  duration_frames: z.number().int().positive().nullable().default(null),

  paragraph: z.string().describe("Script paragraph spoken during this scene"),

  // Asset sourcing — null until asset collection populates it
  visual_asset_key: z
    .string()
    .nullable()
    .default(null)
    .describe("R2 object key for the visual asset (image or video)"),

  visual_type: VisualTypeSchema,

  // Scene metadata — populated by scene-analysis, used for ticker and image gen
  image_prompt: z
    .string()
    .nullable()
    .default(null)
    .describe("Prompt used to generate the BROLL_IMAGE for this scene"),

  enriched_image_prompt: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Image prompt enriched with camera/lens/lighting specs by prompt-builder",
    ),

  ticker_headline: z
    .string()
    .max(200)
    .nullable()
    .default(null)
    .describe("Scrolling news ticker headline for this scene"),

  // Shot composition metadata — populated by scene-analysis for visual variety
  shot_type: z
    .enum([
      "establishing",
      "wide",
      "medium",
      "medium_closeup",
      "closeup",
      "detail",
      "over_shoulder",
    ])
    .optional()
    .describe("Cinematographic shot type for this scene"),

  camera_angle: z
    .string()
    .optional()
    .describe("Camera angle descriptor (e.g., eye_level, high_angle)"),

  visual_theme: z
    .object({
      setting: z.string(),
      timeOfDay: z.string(),
      colorPalette: z.string(),
      mood: z.string(),
      weatherConditions: z.string().optional(),
    })
    .optional()
    .describe("Visual theme for consistency across scenes"),

  // Comparison format — populated by scene-analysis when format === TECH_COMPARISON.
  // Drives Remotion component dispatch in ComparisonXvsYComposition.
  // Null for all other formats.

  character_ids: z
    .array(z.string().uuid())
    .optional()
    .describe(
      "IDs of format_style_library_assets (ref_type=character) assigned to this scene. Only populated when template.supports_character_tracking = true.",
    ),
});

export type Scene = z.infer<typeof SceneSchema>;
export type SceneInput = z.input<typeof SceneSchema>;

/**
 * Word-level timestamp from Whisper.
 * Used for animated caption synchronization.
 */
export const WordTimestampSchema = z.object({
  word: z.string(),
  start: z.number().nonnegative().describe("Start time in seconds"),
  end: z.number().nonnegative().describe("End time in seconds"),
});

export type WordTimestamp = z.infer<typeof WordTimestampSchema>;

/**
 * Ticker item for News Broadcast scrolling ticker.
 */
export const TickerItemSchema = z.object({
  text: z.string().max(200).describe("Headline text"),
});

export type TickerItem = z.infer<typeof TickerItemSchema>;

/**
 * Complete Assembly Manifest.
 * Stored in content_jobs.assembly_manifest JSONB field.
 */
export const AssemblyManifestSchema = z.object({
  scenes: z.array(SceneSchema).min(1),
  word_timestamps: z
    .array(WordTimestampSchema)
    .optional()
    .describe("Populated by render worker after Whisper"),
  ticker_items: z
    .array(TickerItemSchema)
    .optional()
    .describe("For News Broadcast format"),
  render_seed: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Deterministic seed for Ken Burns randomization (Phase 2)"),
  global_visual_theme: z
    .object({
      setting: z.string(),
      timeOfDay: z.string(),
      colorPalette: z.string(),
      mood: z.string(),
      weatherConditions: z.string().optional(),
    })
    .optional()
    .describe("Shared visual theme for consistency across all scenes"),
  composition_plan: CompositionPlanSchema.optional().describe(
    "V2+ biome-based composition plan: layout stretches, transitions, structural zones",
  ),
  clause_timings: z
    .array(ClauseTimingSchema)
    .optional()
    .describe(
      "Word-aligned timings for each clause (comma/conjunction split). Populated by asset-collection after TTS word timestamps are available.",
    ),
});

export type AssemblyManifest = z.infer<typeof AssemblyManifestSchema>;
