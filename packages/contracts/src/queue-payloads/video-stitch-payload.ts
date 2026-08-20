import { z } from "zod";

/**
 * Video Stitch Queue Payload
 *
 * Used by queue-video-stitch lane for stitching multiple VA tutorial recordings
 * into single videos with optional voiceover, music, and captions.
 *
 * Pipeline:
 * 1. Normalize videos to consistent resolution/FPS (FFmpeg)
 * 2. Time-stretch voiceover to match total duration (if enabled)
 * 3. Run Whisper for caption generation (if enabled)
 * 4. Render final composition with transitions (Remotion)
 * 5. Mix audio (voiceover + music)
 *
 * Capacity-limited: Fixed concurrency of 1, monitors main render queue,
 * ensures <50% server resource usage.
 *
 * Fields:
 * - job_id: Video stitch job to process
 * - priority: Optional priority (higher = more urgent)
 */
export const VideoStitchPayloadSchema = z.object({
  job_id: z.string().uuid().describe("Video stitch job ID to process"),
  priority: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .default(5)
    .describe("Processing priority (0=lowest, 10=highest, default=5)"),
});

export type VideoStitchPayload = z.infer<typeof VideoStitchPayloadSchema>;
