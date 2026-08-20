import { z } from "zod";

/**
 * QMS Validation Queue Payload
 *
 * Used by queue-qms-validation lane for lightweight pre-flight checks
 * before expensive operations.
 *
 * Quality Management System (QMS) validates:
 * - Schema correctness before rendering
 * - Asset existence before composition
 * - Pre-conditions before state transitions
 * - Cost/quota limits before AI generation
 *
 * If validation fails, job routes to FAILED_QMS status and alerts dashboard.
 * No blind retries on validation failures.
 *
 * Fields:
 * - job_id: Job to validate
 * - validation_stage: Which stage to validate (pre-render, pre-upload, etc.)
 */
export const QMSValidationPayloadSchema = z.object({
  job_id: z.string().uuid().describe("Job ID to validate"),
  validation_stage: z
    .enum([
      "pre-render",       // Validate all assets present before render
      "pre-upload",       // Validate final video exists and meets YouTube requirements
      "pre-ai-generation", // Check quota/rate limits before AI API calls
      "pre-state-transition", // Validate pre-conditions before status change
    ])
    .describe("Which validation stage to perform"),
});

export type QMSValidationPayload = z.infer<typeof QMSValidationPayloadSchema>;
