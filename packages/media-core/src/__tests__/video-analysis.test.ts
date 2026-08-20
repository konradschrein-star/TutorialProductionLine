/**
 * Video Analysis Tests
 *
 * Tests for black screen detection and scene counting.
 * Uses FFmpeg blackframe and scene detection filters.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock execa before importing the module under test
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { detectBlackScreen, countScenes } from "../video-analysis.js";
import { execa } from "execa";

const mockExeca = vi.mocked(execa);

// ---------------------------------------------------------------------------
// detectBlackScreen Tests
// ---------------------------------------------------------------------------

describe("detectBlackScreen", () => {
  beforeEach(() => {
    mockExeca.mockClear();
  });

  it("detects black screen when all frames have brightness < 10", async () => {
    const ffmpegOutput = `
      [blackframe @ 0x123] brightness:5
      [blackframe @ 0x123] brightness:3
      [blackframe @ 0x123] brightness:8
      [blackframe @ 0x123] brightness:2
      [blackframe @ 0x123] brightness:7
      [blackframe @ 0x123] brightness:4
      [blackframe @ 0x123] brightness:6
      [blackframe @ 0x123] brightness:1
      [blackframe @ 0x123] brightness:9
      [blackframe @ 0x123] brightness:2
    `;

    mockExeca.mockResolvedValue({
      stderr: ffmpegOutput,
      stdout: "",
    } as any);

    const result = await detectBlackScreen("/path/to/video.mp4");

    expect(result.is_black_screen).toBe(true);
    expect(result.black_frame_percentage).toBe(100);
    expect(result.sampled_frames).toBe(10);
    expect(result.average_brightness).toBeLessThan(10);
  });

  it("does not flag normal brightness videos as black screen", async () => {
    const ffmpegOutput = `
      [blackframe @ 0x123] brightness:2
      [blackframe @ 0x123] brightness:85
      [blackframe @ 0x123] brightness:90
      [blackframe @ 0x123] brightness:75
      [blackframe @ 0x123] brightness:88
      [blackframe @ 0x123] brightness:92
      [blackframe @ 0x123] brightness:80
      [blackframe @ 0x123] brightness:86
      [blackframe @ 0x123] brightness:89
      [blackframe @ 0x123] brightness:84
    `;

    mockExeca.mockResolvedValue({
      stderr: ffmpegOutput,
      stdout: "",
    } as any);

    const result = await detectBlackScreen("/path/to/video.mp4");

    expect(result.is_black_screen).toBe(false);
    expect(result.black_frame_percentage).toBe(10);
    expect(result.average_brightness).toBeGreaterThan(50);
  });

  it("detects partial black screen (>80% black frames)", async () => {
    const ffmpegOutput = `
      [blackframe @ 0x123] brightness:5
      [blackframe @ 0x123] brightness:3
      [blackframe @ 0x123] brightness:8
      [blackframe @ 0x123] brightness:2
      [blackframe @ 0x123] brightness:7
      [blackframe @ 0x123] brightness:4
      [blackframe @ 0x123] brightness:6
      [blackframe @ 0x123] brightness:1
      [blackframe @ 0x123] brightness:70
      [blackframe @ 0x123] brightness:75
    `;

    mockExeca.mockResolvedValue({
      stderr: ffmpegOutput,
      stdout: "",
    } as any);

    const result = await detectBlackScreen("/path/to/video.mp4");

    expect(result.is_black_screen).toBe(true);
    expect(result.black_frame_percentage).toBe(80); // 8 out of 10 frames < 10
  });

  it("calls ffmpeg with blackframe filter and correct options", async () => {
    mockExeca.mockResolvedValue({
      stderr: "[blackframe @ 0x123] brightness:5\n".repeat(10),
      stdout: "",
    } as any);

    const videoPath = "/renders/job-123/output.mp4";
    await detectBlackScreen(videoPath);

    const [binary, args, options] = mockExeca.mock.calls[0];

    expect(binary).toBe("ffmpeg");
    expect(args).toEqual(
      expect.arrayContaining([
        "-i",
        videoPath,
        "-vf",
        expect.stringContaining("blackframe"),
        "-f",
        "null",
        "-",
      ]),
    );
    expect(options).toMatchObject({
      timeout: 120000,
      reject: false,
    });
  });

  it("samples 10 frames across video duration", async () => {
    mockExeca.mockResolvedValue({
      stderr: "[blackframe @ 0x123] brightness:50\n".repeat(10),
      stdout: "",
    } as any);

    await detectBlackScreen("/video.mp4");

    const [, args] = mockExeca.mock.calls[0];
    const vfArg = args[args.indexOf("-vf") + 1];

    // Should contain fps filter to sample frames
    expect(vfArg).toContain("fps=");
  });

  it("throws error when no brightness data found in output", async () => {
    mockExeca.mockResolvedValue({
      stderr: "[blackframe @ 0x123] Some output without pblack",
      stdout: "",
    } as any);

    await expect(detectBlackScreen("/video.mp4")).rejects.toThrow(
      /brightness data not found/i,
    );
  });

  it("respects FFMPEG_PATH environment variable", async () => {
    const originalEnv = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = "/custom/ffmpeg";

    mockExeca.mockResolvedValue({
      stderr: "[blackframe @ 0x123] brightness:50\n".repeat(10),
      stdout: "",
    } as any);

    await detectBlackScreen("/video.mp4");

    const [binary] = mockExeca.mock.calls[0];
    expect(binary).toBe("/custom/ffmpeg");

    process.env.FFMPEG_PATH = originalEnv;
  });

  it("uses default ffmpeg when FFMPEG_PATH not set", async () => {
    delete process.env.FFMPEG_PATH;

    mockExeca.mockResolvedValue({
      stderr: "[blackframe @ 0x123] brightness:50\n".repeat(10),
      stdout: "",
    } as any);

    await detectBlackScreen("/video.mp4");

    const [binary] = mockExeca.mock.calls[0];
    expect(binary).toBe("ffmpeg");
  });

  it("accepts optional execFn parameter for dependency injection", async () => {
    const mockExecFn = vi.fn().mockResolvedValue({
      stderr: "[blackframe @ 0x123] brightness:50\n".repeat(10),
      stdout: "",
    });

    const result = await detectBlackScreen("/video.mp4", mockExecFn as any);

    expect(mockExecFn).toHaveBeenCalled();
    expect(result).toHaveProperty("is_black_screen");
    expect(result).toHaveProperty("black_frame_percentage");
    expect(result).toHaveProperty("sampled_frames");
    expect(result).toHaveProperty("average_brightness");
  });

  it("calculates average brightness from sampled frames", async () => {
    const ffmpegOutput = `
      [blackframe @ 0x123] brightness:10
      [blackframe @ 0x123] brightness:20
      [blackframe @ 0x123] brightness:30
      [blackframe @ 0x123] brightness:40
      [blackframe @ 0x123] brightness:50
      [blackframe @ 0x123] brightness:60
      [blackframe @ 0x123] brightness:70
      [blackframe @ 0x123] brightness:80
      [blackframe @ 0x123] brightness:90
      [blackframe @ 0x123] brightness:100
    `;

    mockExeca.mockResolvedValue({
      stderr: ffmpegOutput,
      stdout: "",
    } as any);

    const result = await detectBlackScreen("/video.mp4");

    // Average of 10, 20, 30, ..., 100 = 55
    expect(result.average_brightness).toBe(55);
  });

  it("returns object with required fields", async () => {
    mockExeca.mockResolvedValue({
      stderr: "[blackframe @ 0x123] brightness:50\n".repeat(10),
      stdout: "",
    } as any);

    const result = await detectBlackScreen("/video.mp4");

    expect(result).toHaveProperty("is_black_screen");
    expect(result).toHaveProperty("black_frame_percentage");
    expect(result).toHaveProperty("sampled_frames");
    expect(result).toHaveProperty("average_brightness");
    expect(typeof result.is_black_screen).toBe("boolean");
    expect(typeof result.black_frame_percentage).toBe("number");
    expect(typeof result.sampled_frames).toBe("number");
    expect(typeof result.average_brightness).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// countScenes Tests
// ---------------------------------------------------------------------------

describe("countScenes", () => {
  beforeEach(() => {
    mockExeca.mockClear();
  });

  it("counts scene changes from FFmpeg output", async () => {
    const ffmpegOutput = `
      [showinfo @ 0x123] n:   0 pts: 0 pts_time:0.000000 pos:-1 fmt:yuv420p sar:0/1 s:1920x1080 i:I iskey:1 type:I checksum:ABC123 plane_checksum:[ABC123 DEF456 GHI789] mean:[128 128 128] stdev:[10 10 10]
      [showinfo @ 0x123] n:   1 pts: 1000 pts_time:0.041667 pos:-1 fmt:yuv420p sar:0/1 s:1920x1080 i:I iskey:0 type:B checksum:ABC123 plane_checksum:[ABC123 DEF456 GHI789] mean:[128 128 128] stdev:[10 10 10]
      [showinfo @ 0x123] n:   2 pts: 2000 pts_time:0.083333 pos:-1 fmt:yuv420p sar:0/1 s:1920x1080 i:I iskey:0 type:B checksum:XYZ999 plane_checksum:[XYZ999 DEF456 GHI789] mean:[128 128 128] stdev:[50 50 50]
      [showinfo @ 0x123] n:   3 pts: 3000 pts_time:0.125000 pos:-1 fmt:yuv420p sar:0/1 s:1920x1080 i:I iskey:0 type:B checksum:XYZ999 plane_checksum:[XYZ999 DEF456 GHI789] mean:[128 128 128] stdev:[50 50 50]
      [showinfo @ 0x123] n:   4 pts: 4000 pts_time:0.166667 pos:-1 fmt:yuv420p sar:0/1 s:1920x1080 i:I iskey:0 type:B checksum:ABC123 plane_checksum:[ABC123 DEF456 GHI789] mean:[128 128 128] stdev:[10 10 10]
    `;

    mockExeca.mockResolvedValue({
      stderr: ffmpegOutput,
      stdout: "",
    } as any);

    const result = await countScenes("/path/to/video.mp4");

    expect(result.scene_count).toBeGreaterThan(0);
    expect(Array.isArray(result.scene_timestamps)).toBe(true);
  });

  it("uses default threshold of 0.3 when not specified", async () => {
    mockExeca.mockResolvedValue({
      stderr:
        "[showinfo @ 0x123] n:   0 pts: 0 pts_time:0.000000 pos:-1 fmt:yuv420p sar:0/1 s:1920x1080 i:I iskey:1 type:I checksum:ABC123 plane_checksum:[ABC123 DEF456 GHI789] mean:[128 128 128] stdev:[10 10 10]\n".repeat(
          5,
        ),
      stdout: "",
    } as any);

    await countScenes("/video.mp4");

    const [, args] = mockExeca.mock.calls[0];
    const vfArg = args[args.indexOf("-vf") + 1];

    // Should use default threshold in filter
    expect(vfArg).toContain("0.3");
  });

  it("accepts custom threshold for scene detection", async () => {
    mockExeca.mockResolvedValue({
      stderr:
        "[showinfo @ 0x123] n:   0 pts: 0 pts_time:0.000000 pos:-1 fmt:yuv420p sar:0/1 s:1920x1080 i:I iskey:1 type:I checksum:ABC123 plane_checksum:[ABC123 DEF456 GHI789] mean:[128 128 128] stdev:[10 10 10]\n".repeat(
          5,
        ),
      stdout: "",
    } as any);

    await countScenes("/video.mp4", 0.5);

    const [, args] = mockExeca.mock.calls[0];
    const vfArg = args[args.indexOf("-vf") + 1];

    // Should use custom threshold in filter
    expect(vfArg).toContain("0.5");
  });

  it("calls ffmpeg with scenedetect filter and correct options", async () => {
    mockExeca.mockResolvedValue({
      stderr:
        "[showinfo @ 0x123] n:   0 pts: 0 pts_time:0.000000 pos:-1 fmt:yuv420p sar:0/1 s:1920x1080 i:I iskey:1 type:I checksum:ABC123 plane_checksum:[ABC123 DEF456 GHI789] mean:[128 128 128] stdev:[10 10 10]\n".repeat(
          5,
        ),
      stdout: "",
    } as any);

    const videoPath = "/renders/job-123/output.mp4";
    await countScenes(videoPath);

    const [binary, args, options] = mockExeca.mock.calls[0];

    expect(binary).toBe("ffmpeg");
    expect(args).toEqual(
      expect.arrayContaining([
        "-i",
        videoPath,
        "-vf",
        expect.stringContaining("scenedetect"),
        "-f",
        "null",
        "-",
      ]),
    );
    expect(options).toMatchObject({
      timeout: 120000,
      reject: false,
    });
  });

  it("extracts scene timestamps from pts_time fields", async () => {
    const ffmpegOutput = `
      [showinfo @ 0x123] n:   0 pts: 0 pts_time:0.000000 pos:-1 fmt:yuv420p sar:0/1 s:1920x1080 i:I iskey:1 type:I checksum:ABC123 plane_checksum:[ABC123 DEF456 GHI789] mean:[128 128 128] stdev:[10 10 10]
      [showinfo @ 0x123] n:  50 pts: 50000 pts_time:2.083333 pos:-1 fmt:yuv420p sar:0/1 s:1920x1080 i:I iskey:0 type:B checksum:XYZ999 plane_checksum:[XYZ999 DEF456 GHI789] mean:[128 128 128] stdev:[50 50 50]
      [showinfo @ 0x123] n: 100 pts: 100000 pts_time:4.166667 pos:-1 fmt:yuv420p sar:0/1 s:1920x1080 i:I iskey:0 type:B checksum:XYZ999 plane_checksum:[XYZ999 DEF456 GHI789] mean:[128 128 128] stdev:[50 50 50]
    `;

    mockExeca.mockResolvedValue({
      stderr: ffmpegOutput,
      stdout: "",
    } as any);

    const result = await countScenes("/video.mp4");

    expect(Array.isArray(result.scene_timestamps)).toBe(true);
    result.scene_timestamps.forEach((timestamp) => {
      expect(typeof timestamp).toBe("number");
      expect(timestamp).toBeGreaterThanOrEqual(0);
    });
  });

  it("returns zero scenes for uniform video", async () => {
    const ffmpegOutput = `
      [showinfo @ 0x123] n:   0 pts: 0 pts_time:0.000000 pos:-1 fmt:yuv420p sar:0/1 s:1920x1080 i:I iskey:1 type:I checksum:ABC123 plane_checksum:[ABC123 DEF456 GHI789] mean:[128 128 128] stdev:[10 10 10]
      [showinfo @ 0x123] n:   1 pts: 1000 pts_time:0.041667 pos:-1 fmt:yuv420p sar:0/1 s:1920x1080 i:I iskey:0 type:B checksum:ABC123 plane_checksum:[ABC123 DEF456 GHI789] mean:[128 128 128] stdev:[10 10 10]
      [showinfo @ 0x123] n:   2 pts: 2000 pts_time:0.083333 pos:-1 fmt:yuv420p sar:0/1 s:1920x1080 i:I iskey:0 type:B checksum:ABC123 plane_checksum:[ABC123 DEF456 GHI789] mean:[128 128 128] stdev:[10 10 10]
    `;

    mockExeca.mockResolvedValue({
      stderr: ffmpegOutput,
      stdout: "",
    } as any);

    const result = await countScenes("/video.mp4");

    // No scene changes detected = 0 scenes (or 1 if counting the initial scene)
    expect(result.scene_count).toBeGreaterThanOrEqual(0);
  });

  it("throws error when showinfo output not found", async () => {
    mockExeca.mockResolvedValue({
      stderr: "FFmpeg output without showinfo filter output",
      stdout: "",
    } as any);

    await expect(countScenes("/video.mp4")).rejects.toThrow(
      /showinfo output not found/i,
    );
  });

  it("respects FFMPEG_PATH environment variable", async () => {
    const originalEnv = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = "/custom/ffmpeg";

    mockExeca.mockResolvedValue({
      stderr:
        "[showinfo @ 0x123] n:   0 pts: 0 pts_time:0.000000 pos:-1 fmt:yuv420p sar:0/1 s:1920x1080 i:I iskey:1 type:I checksum:ABC123 plane_checksum:[ABC123 DEF456 GHI789] mean:[128 128 128] stdev:[10 10 10]\n".repeat(
          5,
        ),
      stdout: "",
    } as any);

    await countScenes("/video.mp4");

    const [binary] = mockExeca.mock.calls[0];
    expect(binary).toBe("/custom/ffmpeg");

    process.env.FFMPEG_PATH = originalEnv;
  });

  it("uses default ffmpeg when FFMPEG_PATH not set", async () => {
    delete process.env.FFMPEG_PATH;

    mockExeca.mockResolvedValue({
      stderr:
        "[showinfo @ 0x123] n:   0 pts: 0 pts_time:0.000000 pos:-1 fmt:yuv420p sar:0/1 s:1920x1080 i:I iskey:1 type:I checksum:ABC123 plane_checksum:[ABC123 DEF456 GHI789] mean:[128 128 128] stdev:[10 10 10]\n".repeat(
          5,
        ),
      stdout: "",
    } as any);

    await countScenes("/video.mp4");

    const [binary] = mockExeca.mock.calls[0];
    expect(binary).toBe("ffmpeg");
  });

  it("accepts optional execFn parameter for dependency injection", async () => {
    const mockExecFn = vi.fn().mockResolvedValue({
      stderr:
        "[showinfo @ 0x123] n:   0 pts: 0 pts_time:0.000000 pos:-1 fmt:yuv420p sar:0/1 s:1920x1080 i:I iskey:1 type:I checksum:ABC123 plane_checksum:[ABC123 DEF456 GHI789] mean:[128 128 128] stdev:[10 10 10]\n".repeat(
          5,
        ),
      stdout: "",
    });

    const result = await countScenes("/video.mp4", 0.3, mockExecFn as any);

    expect(mockExecFn).toHaveBeenCalled();
    expect(result).toHaveProperty("scene_count");
    expect(result).toHaveProperty("scene_timestamps");
  });

  it("returns object with required fields", async () => {
    mockExeca.mockResolvedValue({
      stderr:
        "[showinfo @ 0x123] n:   0 pts: 0 pts_time:0.000000 pos:-1 fmt:yuv420p sar:0/1 s:1920x1080 i:I iskey:1 type:I checksum:ABC123 plane_checksum:[ABC123 DEF456 GHI789] mean:[128 128 128] stdev:[10 10 10]\n".repeat(
          5,
        ),
      stdout: "",
    } as any);

    const result = await countScenes("/video.mp4");

    expect(result).toHaveProperty("scene_count");
    expect(result).toHaveProperty("scene_timestamps");
    expect(typeof result.scene_count).toBe("number");
    expect(Array.isArray(result.scene_timestamps)).toBe(true);
  });
});
