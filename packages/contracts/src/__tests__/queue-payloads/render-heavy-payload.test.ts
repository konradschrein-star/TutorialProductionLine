import { describe, it, expect } from "vitest";
import { RenderHeavyPayloadSchema } from "../../queue-payloads/render-heavy-payload.js";

const JOB_ID = "00000000-0000-0000-0000-000000000001";

describe("RenderHeavyPayloadSchema", () => {
  // === Valid cases ===

  it("accepts a minimal valid render payload (job_id only)", () => {
    const result = RenderHeavyPayloadSchema.safeParse({ job_id: JOB_ID });
    expect(result.success).toBe(true);
  });

  it("defaults priority to 5 when omitted", () => {
    const result = RenderHeavyPayloadSchema.safeParse({ job_id: JOB_ID });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.priority).toBe(5);
  });

  it("accepts a payload with explicit priority", () => {
    expect(RenderHeavyPayloadSchema.safeParse({ job_id: JOB_ID, priority: 10 }).success).toBe(true);
  });

  it("accepts priority of 0 (lowest)", () => {
    expect(RenderHeavyPayloadSchema.safeParse({ job_id: JOB_ID, priority: 0 }).success).toBe(true);
  });

  it("accepts priority of 10 (highest)", () => {
    expect(RenderHeavyPayloadSchema.safeParse({ job_id: JOB_ID, priority: 10 }).success).toBe(true);
  });

  // === Required fields ===

  it("rejects missing job_id", () => {
    expect(RenderHeavyPayloadSchema.safeParse({}).success).toBe(false);
  });

  it("rejects non-UUID job_id", () => {
    expect(RenderHeavyPayloadSchema.safeParse({ job_id: "not-a-uuid" }).success).toBe(false);
  });

  // === Numeric constraints ===

  it("rejects priority below 0", () => {
    expect(RenderHeavyPayloadSchema.safeParse({ job_id: JOB_ID, priority: -1 }).success).toBe(false);
  });

  it("rejects priority above 10", () => {
    expect(RenderHeavyPayloadSchema.safeParse({ job_id: JOB_ID, priority: 11 }).success).toBe(false);
  });

  it("rejects non-integer priority", () => {
    expect(RenderHeavyPayloadSchema.safeParse({ job_id: JOB_ID, priority: 4.5 }).success).toBe(false);
  });
});
