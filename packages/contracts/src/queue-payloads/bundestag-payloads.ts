import { z } from "zod";

/**
 * Bundestag Clip Analysis Queue Payload
 *
 * Dispatched to queue-bundestag-clip-analysis for transcription and analysis of
 * parliamentary debate video.
 *
 * Single-stream architecture: Accepts ONE video file (Bundestag live stream).
 * The source stream already has camera angles switched. Downstream processing will:
 * 1. Extract audio and transcribe using speech-to-text
 * 2. Analyze transcript for speaker identification (OCR at lectern)
 * 3. Segment by party affiliation
 * 4. Create clip records for each speech segment
 *
 * Workload: Medium concurrency, longer timeout (transcription + API calls)
 * Typical duration: 2-10 minutes per video
 */
export const BundestagClipAnalysisPayloadSchema = z.object({
  job_id: z.string().uuid().describe("Bundestag job ID"),
  video_file_path: z
    .string()
    .min(1)
    .describe("Absolute path to single parliamentary session video file"),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe(
      "Optional job-level metadata (session date, topic, duration, etc)",
    ),
});

/**
 * Bundestag Playbook Generation Queue Payload
 *
 * Dispatched to queue-bundestag-playbook-generation after clip analysis completes.
 *
 * The processor:
 * 1. Fetches analyzed clips from job metadata
 * 2. Calls LLM (local Ollama or remote) with editing style prompt
 * 3. Generates structured playbook with edit points, transitions, and effects
 * 4. Stores playbook in job metadata for render phase
 *
 * Workload: Low concurrency (resource-intensive), short timeout (LLM inference)
 * Typical duration: 1-5 minutes
 */
export const BundestagPlaybookGenerationPayloadSchema = z.object({
  job_id: z.string().uuid().describe("Bundestag job ID"),
  use_local_llm: z
    .boolean()
    .default(true)
    .describe("If true, use local Ollama; if false, use remote AI service"),
  editing_style: z
    .enum(["dynamic", "conservative", "highlight-focused"])
    .default("dynamic")
    .describe(
      "Editing style preference: dynamic (fast cuts), conservative (minimal cuts), highlight-focused (focus on key moments)",
    ),
  max_total_duration_seconds: z
    .number()
    .positive()
    .optional()
    .describe("Target final video duration (optional constraint)"),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe("Optional job-level metadata for playbook generation context"),
});

/**
 * Bundestag Render Queue Payload
 *
 * Dispatched to queue-bundestag-render for FFmpeg-based video composition.
 *
 * The processor:
 * 1. Fetches playbook from job metadata
 * 2. Reads clip files and applies edit points, transitions, effects per playbook
 * 3. Renders multiple output variants with different aspect ratios and durations
 * 4. Stores final video paths in job assets for distribution
 *
 * Workload: Concurrency 1-2 per VPS, very long timeout (CPU-bound)
 * Typical duration: 5-30+ minutes depending on output resolution and effects
 */
export const BundestagRenderPayloadSchema = z.object({
  job_id: z.string().uuid().describe("Bundestag job ID"),
  output_variants: z
    .array(
      z.object({
        variant_id: z
          .string()
          .optional()
          .describe("Optional variant identifier"),
        aspect_ratio: z
          .enum(["16:9", "9:16", "1:1"])
          .describe("Output aspect ratio"),
        duration_type: z
          .enum(["full", "highlight", "teaser"])
          .describe(
            "Duration type: full (complete video), highlight (key moments), teaser (30s)",
          ),
        target_duration_seconds: z
          .number()
          .positive()
          .optional()
          .describe(
            "Target duration override (if not using duration_type defaults)",
          ),
        quality_preset: z
          .enum(["1080p", "720p", "480p"])
          .optional()
          .default("1080p")
          .describe("Output video quality preset"),
      }),
    )
    .min(1)
    .describe("Array of output variants to render"),
  apply_effects: z
    .boolean()
    .default(true)
    .describe("If true, apply transitions and effects per playbook"),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe(
      "Optional job-level metadata (style presets, color schemes, etc)",
    ),
});

/**
 * Inferred TypeScript types from Zod schemas
 */
export type BundestagClipAnalysisPayload = z.infer<
  typeof BundestagClipAnalysisPayloadSchema
>;
export type BundestagPlaybookGenerationPayload = z.infer<
  typeof BundestagPlaybookGenerationPayloadSchema
>;
export type BundestagRenderPayload = z.infer<
  typeof BundestagRenderPayloadSchema
>;
