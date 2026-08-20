import { z } from "zod";

/**
 * Bundestag Playbook Schema
 *
 * Zod validation schema for LLM-generated editing playbooks.
 *
 * This schema validates the JSON structure returned by Gemini or Claude
 * before business rule validation (clip ID cross-references, timeline continuity).
 *
 * Two-stage validation:
 * 1. Zod schema (structure, types, required fields) - MUST pass, no retries on failure
 * 2. Business rules (clip IDs exist, timeline gaps, audio continuity) - in processor
 *
 * Used by: apps/worker-orchestrator/src/processors/bundestag-playbook-generation.ts
 */

/**
 * Playbook Segment Schema
 *
 * Defines a single segment in the editing timeline.
 * Each segment specifies which clip to use, timing, and subtitle information.
 */
export const BundestagPlaybookSegmentSchema = z
  .object({
    sequence_number: z
      .number()
      .int()
      .positive()
      .describe("Segment order in timeline (1-indexed)"),

    timestamp_start: z
      .number()
      .nonnegative()
      .describe("Start timestamp in final video (seconds)"),

    timestamp_end: z
      .number()
      .positive()
      .describe("End timestamp in final video (seconds)"),

    primary_clip_id: z
      .string()
      .min(1)
      .describe("Video clip ID to use for this segment"),

    clip_start_offset: z
      .number()
      .nonnegative()
      .describe("Start offset into source clip (seconds)"),

    clip_end_offset: z
      .number()
      .positive()
      .describe("End offset into source clip (seconds)"),

    audio_clip_id: z
      .string()
      .min(1)
      .describe("Audio clip ID (usually same as primary_clip_id)"),

    subtitle_text: z
      .string()
      .describe("Subtitle text for this segment (can be empty)"),

    subtitle_style: z
      .enum(["normal", "emphasis", "bold"])
      .default("normal")
      .describe("Subtitle styling"),

    overlay_ids: z
      .array(z.string())
      .optional()
      .describe("Optional branding overlay asset IDs"),

    cut_reason: z
      .string()
      .min(1)
      .describe("Editorial reasoning for this segment (LLM explanation)"),

    transition: z
      .enum(["cut", "fade", "wipe"])
      .default("cut")
      .describe("Transition effect into this segment"),
  })
  .refine((data) => data.timestamp_end > data.timestamp_start, {
    message: "timestamp_end must be greater than timestamp_start",
    path: ["timestamp_end"],
  })
  .refine((data) => data.clip_end_offset > data.clip_start_offset, {
    message: "clip_end_offset must be greater than clip_start_offset",
    path: ["clip_end_offset"],
  });

/**
 * Full Playbook Schema
 *
 * Top-level structure returned by LLM.
 * Includes segments array and optional reasoning.
 */
export const BundestagPlaybookSchema = z.object({
  segments: z
    .array(BundestagPlaybookSegmentSchema)
    .min(1)
    .describe("Array of timeline segments"),

  reasoning: z
    .string()
    .optional()
    .describe("Optional LLM explanation of editing approach"),
});

/**
 * Inferred TypeScript types
 */
export type BundestagPlaybookSegment = z.infer<
  typeof BundestagPlaybookSegmentSchema
>;
export type BundestagPlaybook = z.infer<typeof BundestagPlaybookSchema>;

/**
 * Validation Error Result
 *
 * Structured error object for storing validation failures.
 * Used in job.metadata.validation_errors field.
 */
export type PlaybookValidationError = {
  stage: "zod_schema" | "business_rules";
  timestamp: string;
  errors: Array<{
    field?: string;
    message: string;
    code?: string;
  }>;
  raw_llm_output?: string; // Store invalid JSON for debugging
};

/**
 * Helper: Format Zod errors for storage
 *
 * Converts Zod validation errors into structured format for database storage.
 */
export function formatZodValidationError(
  zodError: z.ZodError,
  rawOutput?: string,
): PlaybookValidationError {
  return {
    stage: "zod_schema",
    timestamp: new Date().toISOString(),
    errors: zodError.errors.map((err) => ({
      field: err.path.join("."),
      message: err.message,
      code: err.code,
    })),
    raw_llm_output: rawOutput,
  };
}

/**
 * Helper: Format business rule errors for storage
 *
 * Converts business rule validation errors into structured format.
 */
export function formatBusinessRuleValidationError(
  errors: string[],
): PlaybookValidationError {
  return {
    stage: "business_rules",
    timestamp: new Date().toISOString(),
    errors: errors.map((msg) => ({ message: msg })),
  };
}
