import { describe, it, expect } from "vitest";
import { PipelineErrorCode, MediaValidationError } from "@repo/domain";
import type { MediaProbeResult } from "../ffmpeg/full-probe.js";
import {
  validateAspectRatio,
  validateResolution,
  validateFileType,
  validateDuration,
  validateAssetHealth,
} from "../validation/media-validators.js";

// ── Fixtures ──────────────────────────────────────────────────────

const VIDEO_PROBE: MediaProbeResult = {
  durationSeconds: 120,
  sizeBytes: 50_000_000,
  formatName: "mov,mp4,m4a,3gp,3g2,mj2",
  video: {
    codec: "h264",
    width: 1920,
    height: 1080,
    fps: 30,
    aspectRatio: "16:9",
  },
  audio: {
    codec: "aac",
    sampleRate: 44100,
    channels: 2,
  },
};

const AUDIO_ONLY_PROBE: MediaProbeResult = {
  durationSeconds: 243,
  sizeBytes: 3_891_200,
  formatName: "mp3",
  audio: {
    codec: "mp3",
    sampleRate: 48000,
    channels: 1,
  },
};

// ── validateAspectRatio ───────────────────────────────────────────

describe("validateAspectRatio", () => {
  it("passes when aspect ratio matches expected", () => {
    const result = validateAspectRatio(VIDEO_PROBE, "16:9");
    expect(result.success).toBe(true);
  });

  it("fails when aspect ratio does not match", () => {
    const result = validateAspectRatio(VIDEO_PROBE, "9:16");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(MediaValidationError);
      expect(result.error.code).toBe(PipelineErrorCode.INVALID_ASPECT_RATIO);
      expect(result.error.expected).toBe("9:16");
      expect(result.error.actual).toBe("16:9");
    }
  });

  it("fails when no video stream is present", () => {
    const result = validateAspectRatio(AUDIO_ONLY_PROBE, "16:9");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(PipelineErrorCode.INVALID_ASPECT_RATIO);
    }
  });
});

// ── validateResolution ────────────────────────────────────────────

describe("validateResolution", () => {
  it("passes when resolution meets minimum", () => {
    const result = validateResolution(VIDEO_PROBE, 1280, 720);
    expect(result.success).toBe(true);
  });

  it("fails when width is below minimum", () => {
    const result = validateResolution(VIDEO_PROBE, 2560, 1080);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(PipelineErrorCode.INVALID_RESOLUTION);
    }
  });

  it("fails when height is below minimum", () => {
    const result = validateResolution(VIDEO_PROBE, 1920, 1440);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(PipelineErrorCode.INVALID_RESOLUTION);
    }
  });

  it("fails when no video stream is present", () => {
    const result = validateResolution(AUDIO_ONLY_PROBE, 1280, 720);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(PipelineErrorCode.INVALID_RESOLUTION);
    }
  });
});

// ── validateFileType ──────────────────────────────────────────────

describe("validateFileType", () => {
  it("passes for an allowed extension", () => {
    const result = validateFileType("/path/to/video.mp4", [".mp4", ".mov"]);
    expect(result.success).toBe(true);
  });

  it("fails for a disallowed extension", () => {
    const result = validateFileType("/path/to/video.avi", [".mp4", ".mov"]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(PipelineErrorCode.INVALID_FILE_TYPE);
      expect(result.error.actual).toBe(".avi");
    }
  });

  it("handles uppercase extensions (case-insensitive)", () => {
    const result = validateFileType("/path/to/VIDEO.MP4", [".mp4", ".mov"]);
    expect(result.success).toBe(true);
  });

  it("handles allowed extensions without leading dots", () => {
    const result = validateFileType("/path/to/video.mp4", ["mp4", "mov"]);
    expect(result.success).toBe(true);
  });
});

// ── validateDuration ──────────────────────────────────────────────

describe("validateDuration", () => {
  it("passes when duration is within bounds", () => {
    const result = validateDuration(VIDEO_PROBE, {
      minSeconds: 60,
      maxSeconds: 300,
    });
    expect(result.success).toBe(true);
  });

  it("fails when duration is too short", () => {
    const result = validateDuration(VIDEO_PROBE, {
      minSeconds: 180,
      maxSeconds: 600,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(PipelineErrorCode.INVALID_DURATION);
      expect(result.error.expected).toContain("180");
    }
  });

  it("fails when duration is too long", () => {
    const result = validateDuration(VIDEO_PROBE, {
      minSeconds: 10,
      maxSeconds: 60,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(PipelineErrorCode.INVALID_DURATION);
      expect(result.error.expected).toContain("60");
    }
  });
});

// ── validateAssetHealth ───────────────────────────────────────────

describe("validateAssetHealth", () => {
  it("passes when all checks pass", () => {
    const result = validateAssetHealth(VIDEO_PROBE, "/path/to/video.mp4", {
      expectedAspectRatio: "16:9",
      allowedFileTypes: [".mp4"],
      minDurationSeconds: 60,
      maxDurationSeconds: 300,
      minWidth: 1280,
      minHeight: 720,
    });
    expect(result.success).toBe(true);
  });

  it("collects multiple errors when multiple checks fail", () => {
    const result = validateAssetHealth(VIDEO_PROBE, "/path/to/video.avi", {
      expectedAspectRatio: "9:16",
      allowedFileTypes: [".mp4"],
      minDurationSeconds: 180,
      maxDurationSeconds: 600,
      minWidth: 2560,
      minHeight: 1440,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // Should have errors for: aspect ratio, file type, duration, resolution
      expect(result.error.length).toBeGreaterThanOrEqual(4);
      const codes = result.error.map((e) => e.code);
      expect(codes).toContain(PipelineErrorCode.INVALID_ASPECT_RATIO);
      expect(codes).toContain(PipelineErrorCode.INVALID_FILE_TYPE);
      expect(codes).toContain(PipelineErrorCode.INVALID_DURATION);
      expect(codes).toContain(PipelineErrorCode.INVALID_RESOLUTION);
    }
  });

  it("passes with no params (all optional)", () => {
    const result = validateAssetHealth(VIDEO_PROBE, "/path/to/video.mp4", {});
    expect(result.success).toBe(true);
  });
});
