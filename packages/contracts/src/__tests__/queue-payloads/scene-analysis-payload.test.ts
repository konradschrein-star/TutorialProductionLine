import { describe, it, expect } from "vitest";
import { SceneAnalysisPayloadSchema } from "../../queue-payloads/scene-analysis-payload.js";

const JOB_ID = "00000000-0000-0000-0000-000000000001";
const TEMPLATE_ID = "00000000-0000-0000-0000-000000000010";
const SCRIPT = "In this video we explore the rise of artificial intelligence. AI has transformed every industry.";

describe("SceneAnalysisPayloadSchema", () => {
  // === Valid cases ===

  it("accepts a valid scene analysis payload", () => {
    const result = SceneAnalysisPayloadSchema.safeParse({
      job_id: JOB_ID,
      template_id: TEMPLATE_ID,
      script: SCRIPT,
    });
    expect(result.success).toBe(true);
  });

  // === Required fields ===

  it("rejects missing job_id", () => {
    expect(SceneAnalysisPayloadSchema.safeParse({ template_id: TEMPLATE_ID, script: SCRIPT }).success).toBe(false);
  });

  it("rejects non-UUID job_id", () => {
    expect(SceneAnalysisPayloadSchema.safeParse({
      job_id: "bad-id",
      template_id: TEMPLATE_ID,
      script: SCRIPT,
    }).success).toBe(false);
  });

  it("rejects missing template_id", () => {
    expect(SceneAnalysisPayloadSchema.safeParse({ job_id: JOB_ID, script: SCRIPT }).success).toBe(false);
  });

  it("rejects non-UUID template_id", () => {
    expect(SceneAnalysisPayloadSchema.safeParse({
      job_id: JOB_ID,
      template_id: "not-uuid",
      script: SCRIPT,
    }).success).toBe(false);
  });

  it("rejects missing script", () => {
    expect(SceneAnalysisPayloadSchema.safeParse({ job_id: JOB_ID, template_id: TEMPLATE_ID }).success).toBe(false);
  });

  // === String constraints ===

  it("rejects empty script (min 1)", () => {
    expect(SceneAnalysisPayloadSchema.safeParse({
      job_id: JOB_ID,
      template_id: TEMPLATE_ID,
      script: "",
    }).success).toBe(false);
  });

  it("rejects script longer than 500000 characters", () => {
    expect(SceneAnalysisPayloadSchema.safeParse({
      job_id: JOB_ID,
      template_id: TEMPLATE_ID,
      script: "x".repeat(500001),
    }).success).toBe(false);
  });

  it("accepts a script exactly at the max length of 500000 characters", () => {
    const result = SceneAnalysisPayloadSchema.safeParse({
      job_id: JOB_ID,
      template_id: TEMPLATE_ID,
      script: "x".repeat(500000),
    });
    expect(result.success).toBe(true);
  });
});
