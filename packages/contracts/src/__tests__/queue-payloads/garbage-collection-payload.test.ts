import { describe, it, expect } from "vitest";
import { GarbageCollectionPayloadSchema } from "../../queue-payloads/garbage-collection-payload.js";

const JOB_ID = "00000000-0000-0000-0000-000000000001";

describe("GarbageCollectionPayloadSchema", () => {
  // === Valid cases ===

  it("accepts a minimal valid GC payload", () => {
    expect(GarbageCollectionPayloadSchema.safeParse({ job_id: JOB_ID }).success).toBe(true);
  });

  it("defaults force to false when omitted", () => {
    const result = GarbageCollectionPayloadSchema.safeParse({ job_id: JOB_ID });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.force).toBe(false);
  });

  it("accepts force: true (admin override)", () => {
    const result = GarbageCollectionPayloadSchema.safeParse({ job_id: JOB_ID, force: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.force).toBe(true);
  });

  it("accepts force: false explicitly", () => {
    expect(GarbageCollectionPayloadSchema.safeParse({ job_id: JOB_ID, force: false }).success).toBe(true);
  });

  // === Required fields ===

  it("rejects missing job_id", () => {
    expect(GarbageCollectionPayloadSchema.safeParse({}).success).toBe(false);
  });

  it("rejects non-UUID job_id", () => {
    expect(GarbageCollectionPayloadSchema.safeParse({ job_id: "not-valid" }).success).toBe(false);
  });

  // === Type constraints ===

  it("rejects non-boolean force value", () => {
    expect(GarbageCollectionPayloadSchema.safeParse({ job_id: JOB_ID, force: "yes" }).success).toBe(false);
  });
});
