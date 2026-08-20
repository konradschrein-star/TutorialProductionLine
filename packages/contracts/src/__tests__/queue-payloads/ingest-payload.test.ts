import { describe, it, expect } from "vitest";
import { IngestPayloadSchema } from "../../queue-payloads/ingest-payload.js";
import { makeValidIngestPayload } from "../helpers.js";

describe("IngestPayloadSchema", () => {
  // === Valid cases ===

  it("accepts a minimal valid ingest payload", () => {
    expect(IngestPayloadSchema.safeParse(makeValidIngestPayload()).success).toBe(true);
  });

  it("defaults production_version to V2", () => {
    const result = IngestPayloadSchema.safeParse(makeValidIngestPayload());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.production_version).toBe("V2");
  });

  it("defaults skip_image_qc to false", () => {
    const result = IngestPayloadSchema.safeParse(makeValidIngestPayload());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.skip_image_qc).toBe(false);
  });

  it("defaults skip_final_qc to false", () => {
    const result = IngestPayloadSchema.safeParse(makeValidIngestPayload());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.skip_final_qc).toBe(false);
  });

  it("defaults language to en", () => {
    const result = IngestPayloadSchema.safeParse(makeValidIngestPayload());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.language).toBe("en");
  });

  // === Required fields ===

  it("rejects missing channel_id", () => {
    const { channel_id: _, ...rest } = makeValidIngestPayload() as { channel_id: string };
    expect(IngestPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects non-UUID channel_id", () => {
    expect(IngestPayloadSchema.safeParse(makeValidIngestPayload({ channel_id: "bad-id" })).success).toBe(false);
  });

  it("rejects missing format", () => {
    const { format: _, ...rest } = makeValidIngestPayload() as { format: string };
    expect(IngestPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects invalid format", () => {
    expect(IngestPayloadSchema.safeParse(makeValidIngestPayload({ format: "COOKING_SHOW" })).success).toBe(false);
  });

  it("rejects missing template_id", () => {
    const { template_id: _, ...rest } = makeValidIngestPayload() as { template_id: string };
    expect(IngestPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects non-UUID template_id", () => {
    expect(IngestPayloadSchema.safeParse(makeValidIngestPayload({ template_id: "bad" })).success).toBe(false);
  });

  // === Format enum ===

  it("accepts all valid format values", () => {
    const formats = [
      "EXPLAINER", "NEWS_BROADCAST", "DOCUMENTARY", "POLITICAL_COMMENTARY",
      "TECH_COMPARISON", "DAY_IN_THE_LIFE", "HISTORICAL_WHAT_IF",
      "VIDEO_ESSAY", "CASUALLY_EXPLAINED", "STICKMAN_ANIMATION",
    ];
    for (const format of formats) {
      expect(IngestPayloadSchema.safeParse(makeValidIngestPayload({ format })).success, `format ${format}`).toBe(true);
    }
  });

  // === Production version ===

  it("accepts all valid production versions", () => {
    for (const v of ["V1", "V2", "V3"]) {
      expect(IngestPayloadSchema.safeParse(makeValidIngestPayload({ production_version: v })).success).toBe(true);
    }
  });

  it("rejects invalid production_version", () => {
    expect(IngestPayloadSchema.safeParse(makeValidIngestPayload({ production_version: "V4" })).success).toBe(false);
  });

  // === String length constraints ===

  it("rejects initial_topic longer than 1000 characters", () => {
    expect(IngestPayloadSchema.safeParse(makeValidIngestPayload({ initial_topic: "x".repeat(1001) })).success).toBe(false);
  });

  it("rejects script_text longer than 50000 characters", () => {
    expect(IngestPayloadSchema.safeParse(makeValidIngestPayload({ script_text: "x".repeat(50001) })).success).toBe(false);
  });

  it("rejects language longer than 10 characters", () => {
    expect(IngestPayloadSchema.safeParse(makeValidIngestPayload({ language: "x".repeat(11) })).success).toBe(false);
  });

  // === pre_uploaded_assets ===

  it("accepts pre_uploaded_assets with valid entries", () => {
    const result = IngestPayloadSchema.safeParse(makeValidIngestPayload({
      pre_uploaded_assets: [
        { key: "/media/channel1/job1/va-footage.mp4", type: "video/raw-va-footage", size_bytes: 104857600 },
      ],
    }));
    expect(result.success).toBe(true);
  });

  it("rejects pre_uploaded_assets exceeding 10 entries", () => {
    const entries = Array.from({ length: 11 }, (_, i) => ({
      key: `/media/job1/asset_${i}.mp4`,
      type: "video/raw-va-footage",
      size_bytes: 1000,
    }));
    expect(IngestPayloadSchema.safeParse(makeValidIngestPayload({ pre_uploaded_assets: entries })).success).toBe(false);
  });

  it("rejects asset entry with empty key", () => {
    const result = IngestPayloadSchema.safeParse(makeValidIngestPayload({
      pre_uploaded_assets: [{ key: "", type: "video/raw-va-footage", size_bytes: 1000 }],
    }));
    expect(result.success).toBe(false);
  });

  it("rejects asset entry with negative size_bytes", () => {
    const result = IngestPayloadSchema.safeParse(makeValidIngestPayload({
      pre_uploaded_assets: [{ key: "some/path.mp4", type: "video/raw-va-footage", size_bytes: -1 }],
    }));
    expect(result.success).toBe(false);
  });

  // === Optional flags ===

  it("accepts skip_image_qc: true", () => {
    expect(IngestPayloadSchema.safeParse(makeValidIngestPayload({ skip_image_qc: true })).success).toBe(true);
  });

  it("accepts skip_final_qc: true", () => {
    expect(IngestPayloadSchema.safeParse(makeValidIngestPayload({ skip_final_qc: true })).success).toBe(true);
  });

  it("defaults image_generation_mode to auto", () => {
    const result = IngestPayloadSchema.safeParse(makeValidIngestPayload());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.image_generation_mode).toBe("auto");
  });

  it("accepts image_generation_mode: auto", () => {
    expect(IngestPayloadSchema.safeParse(makeValidIngestPayload({ image_generation_mode: "auto" })).success).toBe(true);
  });

  it("accepts image_generation_mode: manual", () => {
    expect(IngestPayloadSchema.safeParse(makeValidIngestPayload({ image_generation_mode: "manual" })).success).toBe(true);
  });

  it("rejects invalid image_generation_mode", () => {
    expect(IngestPayloadSchema.safeParse(makeValidIngestPayload({ image_generation_mode: "invalid" })).success).toBe(false);
  });

  it("accepts narration_source_path", () => {
    expect(IngestPayloadSchema.safeParse(makeValidIngestPayload({
      narration_source_path: "/media/jobs/123/narration.mp3",
    })).success).toBe(true);
  });

  it("accepts metadata record", () => {
    expect(IngestPayloadSchema.safeParse(makeValidIngestPayload({
      metadata: { style_asset_context: "stick_figures", difficulty: "easy" },
    })).success).toBe(true);
  });
});
