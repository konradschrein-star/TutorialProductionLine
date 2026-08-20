import { z } from "zod";

/**
 * AI Generation Queue Payload
 *
 * Used by queue-ai-generation lane for TTS, LLM API calls, and external AI services.
 *
 * Discriminated union by generation_type with type-specific context.
 *
 * Generation types:
 * - tts: Text-to-speech generation (ElevenLabs/Qwen3)
 * - script: Script generation via LLM
 * - script_from_research: Script generation for comparison videos using uploaded research files
 * - scene_image: AI image generation for individual scenes
 * - sentence_image: AI image generation for a single sentence within a scene
 * - youtube_metadata: Generate humanized YouTube title, description, and tags from the
 *     finished script via local Gemma model. Runs in parallel with asset collection.
 *     Never changes job status � only enriches content_jobs.title/description/generated_tags.
 *     Also appends a full generation_log entry (prompt, raw output, timing).
 */

const BasePayloadSchema = z.object({
  job_id: z.string().uuid().describe("Job ID for this generation task"),
});

const TTSPayloadSchema = BasePayloadSchema.extend({
  generation_type: z.literal("tts"),
  voice_id: z.string().max(100).describe("Voice ID for TTS generation"),
  text: z.string().max(100_000).describe("Text to convert to speech"),
  language: z
    .string()
    .max(10)
    .optional()
    .describe("Language code (e.g., 'en', 'de')"),
});

const ScriptPayloadSchema = BasePayloadSchema.extend({
  generation_type: z.literal("script"),
  template_id: z.string().uuid().describe("Template ID for prompt selection"),
  topic: z.string().max(1_000).describe("Topic/idea for script generation"),
});

const SceneImagePayloadSchema = BasePayloadSchema.extend({
  generation_type: z.literal("scene_image"),
  scene_index: z.number().int().nonnegative(),
  image_prompt: z
    .string()
    .max(2_000)
    .describe("Generated visual description for this scene"),
  enriched_image_prompt: z
    .string()
    .max(5_000)
    .optional()
    .describe("Image prompt enriched with camera/lens/lighting specs"),
  aspect_ratio: z.string().max(10).default("16:9"),
});

const SentenceImagePayloadSchema = BasePayloadSchema.extend({
  generation_type: z.literal("sentence_image"),
  scene_index: z.number().int().nonnegative(),
  img_index: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "Index of this sentence image within the scene's sentence_images array",
    ),
  group_index: z
    .number()
    .int()
    .nonnegative()
    .describe("Pacing group this sentence belongs to"),
  image_prompt: z
    .string()
    .max(2_000)
    .describe("AI image generation prompt for this sentence"),
  enriched_image_prompt: z
    .string()
    .max(5_000)
    .nullable()
    .optional()
    .describe("Image prompt enriched with camera/lens/lighting specs"),
  aspect_ratio: z.string().max(10).default("16:9"),
});

const YouTubeMetadataPayloadSchema = BasePayloadSchema.extend({
  generation_type: z.literal("youtube_metadata"),
  topic: z
    .string()
    .max(1_000)
    .describe("Original ingested topic � used as context for prompt"),
  format: z
    .string()
    .max(50)
    .describe("Content format (e.g. CASUALLY_EXPLAINED, EXPLAINER)"),
  language: z
    .string()
    .max(10)
    .default("en")
    .describe("Language code for tone calibration"),
});

const ScriptFromResearchPayloadSchema = BasePayloadSchema.extend({
  generation_type: z.literal("script_from_research"),
  template_id: z.string().uuid().describe("Template ID for prompt selection"),
  product_a_name: z.string().max(200).describe("Product A name"),
  product_b_name: z.string().max(200).describe("Product B name"),
  subformat: z
    .enum(["TECH_SOFTWARE", "TECH_HARDWARE", "TECH_SAAS"])
    .describe("Comparison subformat"),
  skip_research: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "When true, generate the script from the LLM's own knowledge instead of requiring uploaded research files. For fully-automatic testing runs.",
    ),
});

export const AIGenerationPayloadSchema = z.discriminatedUnion(
  "generation_type",
  [
    TTSPayloadSchema,
    ScriptPayloadSchema,
    SceneImagePayloadSchema,
    SentenceImagePayloadSchema,
    YouTubeMetadataPayloadSchema,
    ScriptFromResearchPayloadSchema,
  ],
);

export type AIGenerationPayload = z.infer<typeof AIGenerationPayloadSchema>;
export type TTSPayload = z.infer<typeof TTSPayloadSchema>;
export type ScriptPayload = z.infer<typeof ScriptPayloadSchema>;
export type SceneImagePayload = z.infer<typeof SceneImagePayloadSchema>;
export type SentenceImagePayload = z.infer<typeof SentenceImagePayloadSchema>;
export type YouTubeMetadataPayload = z.infer<
  typeof YouTubeMetadataPayloadSchema
>;
export type ScriptFromResearchPayload = z.infer<
  typeof ScriptFromResearchPayloadSchema
>;
