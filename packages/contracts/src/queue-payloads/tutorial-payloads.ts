import { z } from "zod";

/**
 * The only languages an unattended translation action may enqueue.
 * Other languages remain representable for deliberate one-off/manual work.
 */
export const AUTOMATIC_TUTORIAL_LANGUAGE_CODES = [
  "de",
  "fr",
  "es",
  "ja",
  "ko",
] as const;
export type AutomaticTutorialLanguage =
  (typeof AUTOMATIC_TUTORIAL_LANGUAGE_CODES)[number];

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
 * Payload for the TUTORIAL_TRANSLATE queue lane.
 *
 * One job is fanned out per target language from a COMPLETED English source
 * tutorial. The translate processor LLM-translates the narration + metadata,
 * re-synthesises TTS in the target language, creates a CHILD tutorial_job that
 * reuses the source's screen recording, then enqueues the existing
 * TUTORIAL_SPLICE lane for the child.
 */
export const TutorialTranslatePayloadSchema = z.object({
  sourceJobId: z.string().uuid(),
  targetLanguage: z.enum([
    "de",
    "fr",
    "it",
    "es",
    "nl",
    "sv",
    "no",
    "da",
    "pt",
    "pl",
    "cs",
    "ru",
    "ar",
    "zh",
    "ja",
    "ko",
    "id",
  ]),
});
export type TutorialTranslatePayload = z.infer<
  typeof TutorialTranslatePayloadSchema
>;

/**
 * Payload for the TUTORIAL_STITCH queue lane.
 * Triggered after all child segments of a SIX_MIN_STITCH parent are COMPLETED.
 */
export const TutorialStitchPayloadSchema = z.object({
  parentJobId: z.string().uuid(),
});
export type TutorialStitchPayload = z.infer<typeof TutorialStitchPayloadSchema>;
