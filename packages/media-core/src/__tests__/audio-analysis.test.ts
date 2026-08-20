/**
 * Audio Analysis Tests
 *
 * Tests for LUFS loudness measurement and YouTube compliance validation.
 * Uses FFmpeg ebur128 filter for integrated loudness analysis.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock execa before importing the module under test
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { measureLoudness, validateLoudness } from "../audio-analysis.js";
import { execa } from "execa";

const mockExeca = vi.mocked(execa);

// ---------------------------------------------------------------------------
// measureLoudness Tests
// ---------------------------------------------------------------------------

describe("measureLoudness", () => {
  beforeEach(() => {
    mockExeca.mockClear();
  });

  it("returns parsed LUFS value from FFmpeg ebur128 output", async () => {
    const ffmpegOutput = `
      [ebur128 @ 0x123] Target: -23 LUFS
      [ebur128 @ 0x123] Integrated loudness: -14.5 LUFS
      [ebur128 @ 0x123] True peak: -0.5 dBFS
      [ebur128 @ 0x123] Loudness range: 4.5 LU
    `;

    mockExeca.mockResolvedValue({
      stderr: ffmpegOutput,
      stdout: "",
    } as any);

    const result = await measureLoudness("/path/to/video.mp4");

    expect(result).toEqual({
      integrated_lufs: -14.5,
      true_peak_dbfs: -0.5,
      loudness_range_lu: 4.5,
    });
  });

  it("calls ffmpeg with correct ebur128 filter and options", async () => {
    mockExeca.mockResolvedValue({
      stderr:
        "[ebur128 @ 0x123] Integrated loudness: -14.0 LUFS\n[ebur128 @ 0x123] True peak: -1.0 dBFS\n[ebur128 @ 0x123] Loudness range: 5.0 LU",
      stdout: "",
    } as any);

    const videoPath = "/renders/job-123/output.mp4";
    await measureLoudness(videoPath);

    // Verify the call signature: execa(binary, args, options)
    const [binary, args, options] = mockExeca.mock.calls[0];

    expect(binary).toBe("ffmpeg");
    expect(args).toEqual([
      "-i",
      videoPath,
      "-af",
      "ebur128=video=1",
      "-f",
      "null",
      "-",
    ]);
    expect(options).toMatchObject({
      timeout: 120000,
      reject: false,
    });
  });

  it("throws error when LUFS not found in output", async () => {
    mockExeca.mockResolvedValue({
      stderr: "[ebur128 @ 0x123] Some other output without LUFS",
      stdout: "",
    } as any);

    await expect(measureLoudness("/video.mp4")).rejects.toThrow(
      /LUFS loudness measurement not found/i,
    );
  });

  it("throws error when loudness range not found in output", async () => {
    mockExeca.mockResolvedValue({
      stderr:
        "[ebur128 @ 0x123] Integrated loudness: -14.0 LUFS\n[ebur128 @ 0x123] True peak: -1.0 dBFS",
      stdout: "",
    } as any);

    await expect(measureLoudness("/video.mp4")).rejects.toThrow(
      /Loudness range measurement not found/i,
    );
  });

  it("throws error when true peak not found in output", async () => {
    mockExeca.mockResolvedValue({
      stderr:
        "[ebur128 @ 0x123] Integrated loudness: -14.0 LUFS\n[ebur128 @ 0x123] Missing true peak",
      stdout: "",
    } as any);

    await expect(measureLoudness("/video.mp4")).rejects.toThrow(
      /true peak measurement not found/i,
    );
  });

  it("parses negative LUFS values correctly", async () => {
    mockExeca.mockResolvedValue({
      stderr:
        "[ebur128 @ 0x123] Integrated loudness: -16.5 LUFS\n[ebur128 @ 0x123] True peak: -2.5 dBFS\n[ebur128 @ 0x123] Loudness range: 3.2 LU",
      stdout: "",
    } as any);

    const result = await measureLoudness("/video.mp4");

    expect(result.integrated_lufs).toBe(-16.5);
    expect(result.true_peak_dbfs).toBe(-2.5);
    expect(result.loudness_range_lu).toBe(3.2);
  });

  it("parses positive true peak values correctly", async () => {
    mockExeca.mockResolvedValue({
      stderr:
        "[ebur128 @ 0x123] Integrated loudness: -14.0 LUFS\n[ebur128 @ 0x123] True peak: 0.5 dBFS\n[ebur128 @ 0x123] Loudness range: 6.0 LU",
      stdout: "",
    } as any);

    const result = await measureLoudness("/video.mp4");

    expect(result.true_peak_dbfs).toBe(0.5);
  });

  it("respects FFMPEG_PATH environment variable", async () => {
    const originalEnv = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = "/custom/ffmpeg";

    mockExeca.mockResolvedValue({
      stderr:
        "[ebur128 @ 0x123] Integrated loudness: -14.0 LUFS\n[ebur128 @ 0x123] True peak: -1.0 dBFS\n[ebur128 @ 0x123] Loudness range: 5.5 LU",
      stdout: "",
    } as any);

    await measureLoudness("/video.mp4");

    const [binary] = mockExeca.mock.calls[0];
    expect(binary).toBe("/custom/ffmpeg");

    process.env.FFMPEG_PATH = originalEnv;
  });

  it("uses default ffmpeg when FFMPEG_PATH not set", async () => {
    delete process.env.FFMPEG_PATH;

    mockExeca.mockResolvedValue({
      stderr:
        "[ebur128 @ 0x123] Integrated loudness: -14.0 LUFS\n[ebur128 @ 0x123] True peak: -1.0 dBFS\n[ebur128 @ 0x123] Loudness range: 5.5 LU",
      stdout: "",
    } as any);

    await measureLoudness("/video.mp4");

    const [binary] = mockExeca.mock.calls[0];
    expect(binary).toBe("ffmpeg");
  });

  it("accepts optional execFn parameter for dependency injection", async () => {
    const mockExecFn = vi.fn().mockResolvedValue({
      stderr:
        "[ebur128 @ 0x123] Integrated loudness: -14.0 LUFS\n[ebur128 @ 0x123] True peak: -1.0 dBFS\n[ebur128 @ 0x123] Loudness range: 5.0 LU",
      stdout: "",
    });

    const result = await measureLoudness("/video.mp4", mockExecFn as any);

    expect(mockExecFn).toHaveBeenCalled();
    expect(result.integrated_lufs).toBe(-14.0);
  });
});

// ---------------------------------------------------------------------------
// validateLoudness Tests
// ---------------------------------------------------------------------------

describe("validateLoudness", () => {
  it("returns valid for -14 LUFS (YouTube target)", () => {
    const result = validateLoudness({
      integrated_lufs: -14.0,
      true_peak_dbfs: -1.5,
      loudness_range_lu: 5.0,
    });

    expect(result.passed).toBe(true);
    expect(result.integrated_lufs_ok).toBe(true);
    expect(result.true_peak_ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("rejects LUFS too low (< -16)", () => {
    const result = validateLoudness({
      integrated_lufs: -18.0,
      true_peak_dbfs: -1.5,
      loudness_range_lu: 5.0,
    });

    expect(result.passed).toBe(false);
    expect(result.integrated_lufs_ok).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("rejects LUFS too high (> -13)", () => {
    const result = validateLoudness({
      integrated_lufs: -12.0,
      true_peak_dbfs: -1.5,
      loudness_range_lu: 5.0,
    });

    expect(result.passed).toBe(false);
    expect(result.integrated_lufs_ok).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("rejects true peak above -1.0 dBFS", () => {
    const result = validateLoudness({
      integrated_lufs: -14.0,
      true_peak_dbfs: 0.5,
      loudness_range_lu: 5.0,
    });

    expect(result.passed).toBe(false);
    expect(result.true_peak_ok).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns object with passed, integrated_lufs_ok, true_peak_ok and warnings fields", () => {
    const result = validateLoudness({
      integrated_lufs: -14.0,
      true_peak_dbfs: -1.5,
      loudness_range_lu: 5.0,
    });

    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("integrated_lufs_ok");
    expect(result).toHaveProperty("true_peak_ok");
    expect(result).toHaveProperty("warnings");
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("returns empty warnings array when valid", () => {
    const result = validateLoudness({
      integrated_lufs: -14.5,
      true_peak_dbfs: -2.0,
      loudness_range_lu: 4.0,
    });

    expect(result.warnings).toEqual([]);
  });

  it("returns failed status for combined non-compliant case: -10 LUFS (too high), -0.5 dBFS (too high)", () => {
    const result = validateLoudness({
      integrated_lufs: -10.0,
      true_peak_dbfs: -0.5,
      loudness_range_lu: 5.0,
    });

    expect(result.passed).toBe(false);
    expect(result.integrated_lufs_ok).toBe(false);
    expect(result.true_peak_ok).toBe(false);
    expect(result.warnings.length).toBe(2);
  });
});
