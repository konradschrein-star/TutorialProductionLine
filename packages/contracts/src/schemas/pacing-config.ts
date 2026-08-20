import { z } from "zod";

/**
 * Pacing configuration for V2 image pipeline.
 * Stored in template.render_config.pacing (JSONB).
 * All fields have defaults — a missing or partial pacing object is valid.
 *
 * Zone model:
 *   Hook       (first ~15% of scenes): sub-sentence mode if hook_use_subsentences
 *   Early body (scenes up to early_body_end_pct%): sentence mode — 1 image per sentence
 *   Late body  (remaining scenes): grouped mode — random 2-4 sentences per image
 */
export const PacingConfigSchema = z.object({
  /** Use sub-sentence (clause) splitting for hook zone scenes. Default: true */
  hook_use_subsentences: z.boolean().default(true),

  /**
   * Early body ends at whichever threshold comes FIRST:
   * - early_body_end_pct  percent of total scenes elapsed
   * - early_body_end_seconds  seconds into video (approximated by scene position ratio)
   */
  early_body_end_pct: z.number().min(10).max(90).default(50),
  early_body_end_seconds: z.number().min(60).max(3600).default(480),

  /** Late body: min sentences grouped into one image. Default: 2 */
  late_body_sentences_per_image_min: z.number().int().min(1).max(4).default(2),
  /** Late body: max sentences grouped into one image. Default: 4 */
  late_body_sentences_per_image_max: z.number().int().min(2).max(8).default(4),

  /** Hard cap: no single image may span more than this many seconds of audio. Default: 30 */
  max_image_duration_seconds: z.number().min(5).max(120).default(30),

  /**
   * What triggers a KEY_FACT text card for a sentence:
   *   "content_detection" — sentence contains a number, %, $, or similar statistic
   *   "claude_flagged"    — Claude marks is_key_fact=true during scene analysis
   *   "disabled"          — KEY_FACT cards never appear
   */
  key_fact_trigger: z
    .enum(["content_detection", "claude_flagged", "disabled"])
    .default("content_detection"),

  /**
   * Custom regex string for content_detection mode (optional).
   * Default pattern detects numbers, %, $, statistics.
   */
  key_fact_content_pattern: z.string().optional(),
}).default({});

export type PacingConfig = z.infer<typeof PacingConfigSchema>;

/**
 * Read and validate PacingConfig from a template's render_config JSONB.
 * Safe to call with any shape — always returns a fully-defaulted PacingConfig.
 */
export function getPacingConfig(renderConfig: unknown): PacingConfig {
  const raw = (renderConfig as Record<string, unknown> | null)?.["pacing"] ?? {};
  const result = PacingConfigSchema.safeParse(raw);
  if (result.success) return result.data;
  // Fallback to all defaults on parse error
  return PacingConfigSchema.parse({});
}

/**
 * Determine which pacing zone a scene is in, given its index and total scene count.
 * Uses scene position ratio as a proxy for video time
 * (exact timing is only known at render time via Whisper).
 *
 * Zones:
 *   "hook"       — first 15% of scenes
 *   "early_body" — scenes 15% to early_body_end_pct%
 *   "late_body"  — scenes from early_body_end_pct% onwards
 */
export function getPacingZone(
  sceneIndex: number,
  totalScenes: number,
  config: PacingConfig,
): "hook" | "early_body" | "late_body" {
  const pct = (sceneIndex / Math.max(1, totalScenes)) * 100;
  if (pct < 15) return "hook";
  if (pct < config.early_body_end_pct) return "early_body";
  return "late_body";
}
