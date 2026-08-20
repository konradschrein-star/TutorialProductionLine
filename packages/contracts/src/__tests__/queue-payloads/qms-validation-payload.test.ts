import { describe, it, expect } from "vitest";
import { QMSValidationPayloadSchema } from "../../queue-payloads/qms-validation-payload.js";

const JOB_ID = "00000000-0000-0000-0000-000000000001";

describe("QMSValidationPayloadSchema", () => {
  // === Valid cases ===

  it("accepts a valid pre-render validation payload", () => {
    const result = QMSValidationPayloadSchema.safeParse({
      job_id: JOB_ID,
      validation_stage: "pre-render",
    });
    expect(result.success).toBe(true);
  });

  it("accepts all valid validation stages", () => {
    const stages = ["pre-render", "pre-upload", "pre-ai-generation", "pre-state-transition"];
    for (const validation_stage of stages) {
      const result = QMSValidationPayloadSchema.safeParse({ job_id: JOB_ID, validation_stage });
      expect(result.success, `stage ${validation_stage} should be valid`).toBe(true);
    }
  });

  // === Required fields ===

  it("rejects missing job_id", () => {
    expect(QMSValidationPayloadSchema.safeParse({ validation_stage: "pre-render" }).success).toBe(false);
  });

  it("rejects non-UUID job_id", () => {
    expect(QMSValidationPayloadSchema.safeParse({
      job_id: "not-a-uuid",
      validation_stage: "pre-render",
    }).success).toBe(false);
  });

  it("rejects missing validation_stage", () => {
    expect(QMSValidationPayloadSchema.safeParse({ job_id: JOB_ID }).success).toBe(false);
  });

  // === Enum constraints ===

  it("rejects invalid validation_stage", () => {
    expect(QMSValidationPayloadSchema.safeParse({
      job_id: JOB_ID,
      validation_stage: "post-render",
    }).success).toBe(false);
  });

  it("rejects empty string for validation_stage", () => {
    expect(QMSValidationPayloadSchema.safeParse({
      job_id: JOB_ID,
      validation_stage: "",
    }).success).toBe(false);
  });
});
