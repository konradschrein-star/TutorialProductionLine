import { describe, it, expect } from "vitest";
import {
  ACTIVE_TUTORIAL_UPLOAD_LANGUAGE_CODES,
  AUTOMATIC_TUTORIAL_LANGUAGE_CODES,
  isActiveTutorialUploadLanguage,
  normalizeTutorialLanguage,
  TutorialGeneratePayloadSchema,
  TutorialSplicePayloadSchema,
  TutorialTranslatePayloadSchema,
} from "../../queue-payloads/tutorial-payloads.js";

describe("tutorial payloads", () => {
  it("accepts a script-stage generate payload", () => {
    const r = TutorialGeneratePayloadSchema.safeParse({
      jobId: "11111111-1111-1111-1111-111111111111",
      stage: "script",
    });
    expect(r.success).toBe(true);
  });
  it("accepts a tts-stage generate payload", () => {
    expect(
      TutorialGeneratePayloadSchema.safeParse({
        jobId: "11111111-1111-1111-1111-111111111111",
        stage: "tts",
      }).success,
    ).toBe(true);
  });
  it("rejects an unknown stage", () => {
    expect(
      TutorialGeneratePayloadSchema.safeParse({
        jobId: "11111111-1111-1111-1111-111111111111",
        stage: "bogus",
      }).success,
    ).toBe(false);
  });
  it("validates a splice payload", () => {
    expect(
      TutorialSplicePayloadSchema.safeParse({
        jobId: "11111111-1111-1111-1111-111111111111",
      }).success,
    ).toBe(true);
  });

  it("locks unattended translation to the four production languages", () => {
    expect(AUTOMATIC_TUTORIAL_LANGUAGE_CODES).toEqual(["de", "fr", "it", "sv"]);
    // The queue contract remains wider for one-off manual translations; the
    // automatic API and batch scripts consume the narrower constant above.
    expect(
      TutorialTranslatePayloadSchema.safeParse({
        sourceJobId: "11111111-1111-1111-1111-111111111111",
        targetLanguage: "nl",
      }).success,
    ).toBe(true);
  });

  it("defines the exact five-language upload network without Dutch", () => {
    expect(ACTIVE_TUTORIAL_UPLOAD_LANGUAGE_CODES).toEqual([
      "en",
      "de",
      "fr",
      "it",
      "sv",
    ]);
    expect(isActiveTutorialUploadLanguage("English")).toBe(true);
    expect(isActiveTutorialUploadLanguage("nl")).toBe(false);
    expect(normalizeTutorialLanguage(null)).toBeNull();
  });
});
