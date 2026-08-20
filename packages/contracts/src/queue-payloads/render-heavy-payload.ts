import { z } from "zod";

/**
 * Render Heavy Queue Payload
 *
 * Used by queue-render-heavy lane for CPU-bound Remotion/FFmpeg rendering.
 *
 * This queue has the strictest concurrency limits (1-2 per VPS) to prevent
 * resource exhaustion. Heavy render work must never starve admin or
 * orchestration responsiveness.
 *
 * Routing between FFMPEG and Remotion engines happens before job enters
 * this queue (in ROUTING_RENDER status). This payload is engine-agnostic.
 *
 * Fields:
 * - job_id: Job to render
 * - priority: Optional priority (higher = more urgent)
 */
export const RenderHeavyPayloadSchema = z.object({
  job_id: z.string().uuid().describe("Job ID to render"),
  priority: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .default(5)
    .describe("Render priority (0=lowest, 10=highest, default=5)"),
});

export type RenderHeavyPayload = z.infer<typeof RenderHeavyPayloadSchema>;
