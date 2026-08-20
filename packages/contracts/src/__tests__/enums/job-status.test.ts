import { describe, it, expect } from "vitest";
import { JobStatus } from "../../enums/job-status.js";

const EXPECTED_VALUES = [
  "IDEA_GENERATION",
  "SCRIPTING",
  "AWAITING_RESEARCH",
  "RESEARCH_UPLOADED",
  "ASSET_COLLECTION",
  "CLIP_SELECTION",
  "AWAITING_CLIP_REVIEW",
  "FAILED_CLIP_SELECTION",
  "AWAITING_PRODUCTION_VA",
  "AWAITING_IMAGE_QC",
  "QMS_VALIDATING",
  "ROUTING_RENDER",
  "RENDERING_FFMPEG",
  "RENDERING_REMOTION",
  "AWAITING_QC",
  "AWAITING_UPLOADER",
  "UPLOADING",
  "PUBLISHED",
  "PAUSED",
  "CANCELLED",
  "FAILED_QMS",
  "FAILED_RENDER",
  "FAILED_UPLOAD",
  "FAILED_GENERAL",
  "FAILED_IRRECOVERABLE",
  "MARKED_FOR_DELETION",
  "DELETED",
] as const;

describe("JobStatus enum", () => {
  it("has exactly 52 values (guards against accidental deletion)", () => {
    expect(JobStatus.options.length).toBe(52);
  });

  it("contains no duplicate values", () => {
    const unique = new Set(JobStatus.options);
    expect(unique.size).toBe(JobStatus.options.length);
  });

  it("rejects an unknown status value", () => {
    expect(JobStatus.safeParse("RUNNING").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(JobStatus.safeParse("").success).toBe(false);
  });

  it("contains all expected pipeline stage values", () => {
    for (const value of EXPECTED_VALUES) {
      expect(
        JobStatus.safeParse(value).success,
        `${value} should be valid`,
      ).toBe(true);
    }
  });

  it("contains the human-in-the-loop statuses", () => {
    expect(JobStatus.safeParse("AWAITING_PRODUCTION_VA").success).toBe(true);
    expect(JobStatus.safeParse("AWAITING_IMAGE_QC").success).toBe(true);
    expect(JobStatus.safeParse("AWAITING_QC").success).toBe(true);
    expect(JobStatus.safeParse("AWAITING_UPLOADER").success).toBe(true);
  });

  it("contains all failure states", () => {
    expect(JobStatus.safeParse("FAILED_QMS").success).toBe(true);
    expect(JobStatus.safeParse("FAILED_RENDER").success).toBe(true);
    expect(JobStatus.safeParse("FAILED_UPLOAD").success).toBe(true);
    expect(JobStatus.safeParse("FAILED_GENERAL").success).toBe(true);
    expect(JobStatus.safeParse("FAILED_IRRECOVERABLE").success).toBe(true);
  });

  it("contains the deletion lifecycle states", () => {
    expect(JobStatus.safeParse("MARKED_FOR_DELETION").success).toBe(true);
    expect(JobStatus.safeParse("DELETED").success).toBe(true);
  });

  it("contains operational control states", () => {
    expect(JobStatus.safeParse("PAUSED").success).toBe(true);
    expect(JobStatus.safeParse("CANCELLED").success).toBe(true);
  });
});
