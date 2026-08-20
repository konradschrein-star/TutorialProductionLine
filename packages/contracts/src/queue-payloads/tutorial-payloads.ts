import { z } from "zod";

export const TutorialGeneratePayloadSchema = z.object({
  jobId: z.string().uuid(),
  stage: z.enum(["script", "tts"]),
});
export type TutorialGeneratePayload = z.infer<
  typeof TutorialGeneratePayloadSchema
>;

export const TutorialSplicePayloadSchema = z.object({
  jobId: z.string().uuid(),
});
export type TutorialSplicePayload = z.infer<typeof TutorialSplicePayloadSchema>;

/**
 * Payload for the TUTORIAL_STITCH queue lane.
 * Triggered after all child segments of a SIX_MIN_STITCH parent are COMPLETED.
 */
export const TutorialStitchPayloadSchema = z.object({
  parentJobId: z.string().uuid(),
});
export type TutorialStitchPayload = z.infer<typeof TutorialStitchPayloadSchema>;
