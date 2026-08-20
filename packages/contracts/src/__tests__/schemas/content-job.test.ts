import { describe, it, expect } from "vitest";
import { ContentJobSchema } from "../../schemas/content-job.js";
import { makeMinimalContentJob } from "../helpers.js";

describe("ContentJobSchema", () => {
  it("accepts a minimal valid job", () => {
    const result = ContentJobSchema.safeParse(makeMinimalContentJob());
    expect(result.success).toBe(true);
  });

  it("defaults retry_count to 0", () => {
    const input = makeMinimalContentJob();
    delete (input as Record<string, unknown>).retry_count;
    const result = ContentJobSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.retry_count).toBe(0);
  });

  // === Identity ===

  it("rejects non-UUID id", () => {
    const result = ContentJobSchema.safeParse(makeMinimalContentJob({ id: "not-a-uuid" }));
    expect(result.success).toBe(false);
  });

  it("rejects non-UUID channel_id", () => {
    const result = ContentJobSchema.safeParse(makeMinimalContentJob({ channel_id: "bad" }));
    expect(result.success).toBe(false);
  });

  it("rejects non-UUID template_id", () => {
    const result = ContentJobSchema.safeParse(makeMinimalContentJob({ template_id: "bad" }));
    expect(result.success).toBe(false);
  });

  // === Status ===

  it("rejects invalid job status", () => {
    const result = ContentJobSchema.safeParse(makeMinimalContentJob({ status: "RUNNING" }));
    expect(result.success).toBe(false);
  });

  it("accepts all valid job statuses", () => {
    const validStatuses = [
      "IDEA_GENERATION", "SCRIPTING", "ASSET_COLLECTION",
      "AWAITING_PRODUCTION_VA", "AWAITING_IMAGE_QC", "QMS_VALIDATING",
      "ROUTING_RENDER", "RENDERING_FFMPEG", "RENDERING_REMOTION",
      "AWAITING_QC", "AWAITING_UPLOADER", "UPLOADING", "PUBLISHED",
      "PAUSED", "CANCELLED",
      "FAILED_QMS", "FAILED_RENDER", "FAILED_UPLOAD", "FAILED_GENERAL",
      "MARKED_FOR_DELETION", "DELETED",
    ];
    for (const status of validStatuses) {
      const result = ContentJobSchema.safeParse(makeMinimalContentJob({ status }));
      expect(result.success, `status ${status} should be valid`).toBe(true);
    }
  });

  it("accepts null paused_from_status", () => {
    const result = ContentJobSchema.safeParse(makeMinimalContentJob({ paused_from_status: null }));
    expect(result.success).toBe(true);
  });

  it("accepts a valid paused_from_status", () => {
    const result = ContentJobSchema.safeParse(makeMinimalContentJob({ paused_from_status: "SCRIPTING" }));
    expect(result.success).toBe(true);
  });

  it("rejects invalid paused_from_status", () => {
    const result = ContentJobSchema.safeParse(makeMinimalContentJob({ paused_from_status: "RUNNING" }));
    expect(result.success).toBe(false);
  });

  // === Content ===

  it("rejects title shorter than 1 character", () => {
    const result = ContentJobSchema.safeParse(makeMinimalContentJob({ title: "" }));
    expect(result.success).toBe(false);
  });

  it("rejects title longer than 100 characters", () => {
    const result = ContentJobSchema.safeParse(makeMinimalContentJob({ title: "x".repeat(101) }));
    expect(result.success).toBe(false);
  });

  it("rejects description longer than 5000 characters", () => {
    const result = ContentJobSchema.safeParse(makeMinimalContentJob({ description: "x".repeat(5001) }));
    expect(result.success).toBe(false);
  });

  it("rejects invalid format", () => {
    const result = ContentJobSchema.safeParse(makeMinimalContentJob({ format: "COOKING_SHOW" }));
    expect(result.success).toBe(false);
  });

  it("rejects invalid production_version", () => {
    const result = ContentJobSchema.safeParse(makeMinimalContentJob({ production_version: "V4" }));
    expect(result.success).toBe(false);
  });

  // === Render ===

  it("accepts null render_engine", () => {
    const result = ContentJobSchema.safeParse(makeMinimalContentJob({ render_engine: null }));
    expect(result.success).toBe(true);
  });

  it("accepts valid render engines", () => {
    for (const engine of ["FFMPEG", "REMOTION"]) {
      const result = ContentJobSchema.safeParse(makeMinimalContentJob({ render_engine: engine }));
      expect(result.success, `engine ${engine} should be valid`).toBe(true);
    }
  });

  it("rejects invalid render_engine", () => {
    const result = ContentJobSchema.safeParse(makeMinimalContentJob({ render_engine: "HANDBRAKE" }));
    expect(result.success).toBe(false);
  });

  it("accepts valid aspect_ratio values", () => {
    for (const ratio of ["16:9", "9:16"]) {
      const result = ContentJobSchema.safeParse(makeMinimalContentJob({ aspect_ratio: ratio }));
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid aspect_ratio", () => {
    const result = ContentJobSchema.safeParse(makeMinimalContentJob({ aspect_ratio: "4:3" }));
    expect(result.success).toBe(false);
  });

  // === Numeric constraints ===

  it("rejects negative retry_count", () => {
    const result = ContentJobSchema.safeParse(makeMinimalContentJob({ retry_count: -1 }));
    expect(result.success).toBe(false);
  });

  it("rejects non-integer retry_count", () => {
    const result = ContentJobSchema.safeParse(makeMinimalContentJob({ retry_count: 1.5 }));
    expect(result.success).toBe(false);
  });

  it("rejects negative target_duration_seconds", () => {
    const result = ContentJobSchema.safeParse(makeMinimalContentJob({ target_duration_seconds: 0 }));
    expect(result.success).toBe(false);
  });

  // === Timestamps ===

  it("rejects invalid datetime for created_at", () => {
    const result = ContentJobSchema.safeParse(makeMinimalContentJob({ created_at: "not-a-date" }));
    expect(result.success).toBe(false);
  });

  it("rejects invalid datetime for status_updated_at", () => {
    const result = ContentJobSchema.safeParse(makeMinimalContentJob({ status_updated_at: "2026-04-01" }));
    expect(result.success).toBe(false);
  });

  // === Worker lease ===

  it("accepts null worker_lease_id", () => {
    const result = ContentJobSchema.safeParse(makeMinimalContentJob({ worker_lease_id: null }));
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID worker_lease_id", () => {
    const result = ContentJobSchema.safeParse(makeMinimalContentJob({ worker_lease_id: "not-a-uuid" }));
    expect(result.success).toBe(false);
  });
});
