import { describe, it, expect } from "vitest";
import {
  TutorialGeneratePayloadSchema,
  TutorialSplicePayloadSchema,
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
});
