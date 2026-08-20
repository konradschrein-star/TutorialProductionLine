import { z } from "zod";
import { ContentFormat } from "../enums/content-format.js";
import { ProductionVersion } from "../enums/production-version.js";

/**
 * Ingest Queue Payload
 *
 * Used by queue-ingest lane for initial job creation and workflow setup.
 *
 * Lightweight reference payload following the doctrine:
 * "Queue payloads are lightweight references - database is source of truth,
 * prevents stale state in Redis"
 *
 * Fields:
 * - channel_id: YouTube channel for this job
 * - format: Content format to generate
 * - template_id: Template to use for pipeline configuration
 * - initial_topic: Optional topic/idea for generation
 */
export const IngestPayloadSchema = z.object({
  channel_id: z.string().uuid().describe("YouTube channel ID"),
  format: ContentFormat.describe("Content format to generate"),
  template_id: z
    .string()
    .uuid()
    .describe("Template ID for pipeline configuration"),
  production_version: ProductionVersion.optional()
    .default("V2")
    .describe(
      "Production version for rendering (V1=clean layout, V2=broadcast, V3=future)",
    ),
  initial_topic: z
    .string()
    .max(1_000)
    .optional()
    .describe("Optional topic/idea for content generation"),
  script_text: z
    .string()
    .max(50_000)
    .optional()
    .describe("Pre-written script — skips AI script generation when provided"),
  pre_uploaded_assets: z
    .array(
      z.object({
        key: z
          .string()
          .min(1)
          .describe("Asset path key (local path or logical identifier)"),
        type: z
          .string()
          .min(1)
          .describe("Asset type (e.g. video/raw-va-footage)"),
        size_bytes: z
          .number()
          .int()
          .nonnegative()
          .describe("File size in bytes"),
      }),
    )
    .max(10)
    .optional()
    .describe(
      "Pre-uploaded assets — written to r2_asset_manifest on job creation",
    ),
  skip_image_qc: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Skip AWAITING_IMAGE_QC — pipeline advances directly to QMS after asset collection",
    ),
  skip_final_qc: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Skip AWAITING_QC — pipeline advances directly to AWAITING_UPLOADER after render",
    ),
  skip_research: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "TECH_COMPARISON only: skip the AWAITING_RESEARCH human gate. The script is generated from the LLM's own knowledge instead of uploaded research files. For fully-automatic testing runs.",
    ),
  image_generation_mode: z
    .enum(["auto", "manual"])
    .optional()
    .default("auto")
    .describe(
      "Image generation mode — 'auto' uses AI generation, 'manual' requires operator upload",
    ),
  language: z
    .string()
    .max(10)
    .optional()
    .default("en")
    .describe(
      "Job language code — drives TTS voice selection (e.g. 'en', 'de')",
    ),
  narration_source_path: z
    .string()
    .optional()
    .describe(
      "Absolute local path to pre-uploaded narration file — skips TTS when set",
    ),
  archetype_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Archetype ID defining visual style — CRITICAL for per_video_assets assembly and reference image resolution",
    ),
  character_ids: z
    .array(z.string().uuid())
    .optional()
    .describe(
      "Character UUIDs to use for this job — used for illustration formats (CASUALLY_EXPLAINED)",
    ),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe(
      "Optional job-level metadata (e.g. style_asset_context for illustration formats)",
    ),
  target_duration_seconds: z
    .number()
    .int()
    .positive()
    .max(21600) // 6 hours max
    .optional()
    .describe(
      "Target video duration in seconds — drives script length and pacing",
    ),
  aspect_ratio: z
    .enum(["16:9", "9:16", "1:1", "4:3"])
    .optional()
    .default("16:9")
    .describe("Video aspect ratio — determines image generation dimensions"),
  bundestag_clip_paths: z
    .array(z.string())
    .optional()
    .describe(
      "Bundestag format only: absolute local filesystem paths to pre-uploaded video clips",
    ),
});

export type IngestPayload = z.infer<typeof IngestPayloadSchema>;
