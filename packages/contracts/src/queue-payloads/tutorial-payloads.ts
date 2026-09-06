import { z } from "zod";

/**
 * The only languages an unattended translation action may enqueue.
 * Other languages remain representable for deliberate one-off/manual work.
 */
export const AUTOMATIC_TUTORIAL_LANGUAGE_CODES = [
  "de",
  "fr",
  "it",
  "sv",
] as const;
export type AutomaticTutorialLanguage =
  (typeof AUTOMATIC_TUTORIAL_LANGUAGE_CODES)[number];

/**
 * The complete unattended publication network. English is the source variant;
 * the remaining entries are the automatic translation fan-out above. Dutch
 * and the wider manual translation catalog deliberately do not belong here.
 */
export const ACTIVE_TUTORIAL_UPLOAD_LANGUAGE_CODES = [
  "en",
  ...AUTOMATIC_TUTORIAL_LANGUAGE_CODES,
] as const;
export type ActiveTutorialUploadLanguage =
  (typeof ACTIVE_TUTORIAL_UPLOAD_LANGUAGE_CODES)[number];

const TUTORIAL_LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  english: "en",
  german: "de",
  french: "fr",
  italian: "it",
  dutch: "nl",
  swedish: "sv",
};

/** Normalize persisted display names and short codes without inventing a default. */
export function normalizeTutorialLanguage(
  language: string | null | undefined,
): string | null {
  const value = language?.trim().toLowerCase();
  if (!value) return null;
  return TUTORIAL_LANGUAGE_ALIASES[value] ?? value;
}

export function isActiveTutorialUploadLanguage(
  language: string | null | undefined,
): language is ActiveTutorialUploadLanguage {
  const normalized = normalizeTutorialLanguage(language);
  return (
    normalized !== null &&
    (ACTIVE_TUTORIAL_UPLOAD_LANGUAGE_CODES as readonly string[]).includes(
      normalized,
    )
  );
}

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
