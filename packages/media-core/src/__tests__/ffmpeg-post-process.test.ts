/**
 * FFmpeg Post-Process Tests
 *
 * Tests for applyGistWashAndUpscale - combines GIST wash (Gaussian noise +
 * crop jitter) with conditional upscaling to WQHD (2560x1440).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// Mock probe module
const mockProbeMediaDimensions = vi.fn();

vi.mock("../ffmpeg/probe.js", () => ({
  probeMediaDimensions: (...args: any[]) => mockProbeMediaDimensions(...args),
}));

// Mock child_process
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { applyGistWashAndUpscale } from "../ffmpeg/post-process.js";
import { spawn } from "node:child_process";

const mockSpawn = vi.mocked(spawn);

/**
 * Create a fresh mock process and configure mockSpawn to auto-emit close(exitCode)
 * asynchronously after the next tick (so the probe awaits first).
 */
function makeAutoProcess(exitCode = 0) {
  const proc = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
  });
  mockSpawn.mockImplementation(() => {
    setImmediate(() => proc.emit("close", exitCode));
    return proc as any;
  });
  return proc;
}

describe("applyGistWashAndUpscale", () => {
  let mockProcess: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcess = makeAutoProcess(0);
  });

  describe("conditional upscaling logic", () => {
    it("skips upscale when input is already WQHD or higher", async () => {
      mockProbeMediaDimensions.mockResolvedValue({ width: 2560, height: 1440 });

      await applyGistWashAndUpscale("/input.mp4", "/output.mp4");

      // Should only apply GIST wash, not upscale
      const args = mockSpawn.mock.calls[0][1];
      const vfIndex = args.indexOf("-vf");
      expect(args[vfIndex + 1]).toBe("noise=alls=5:allf=t+u,crop=iw-2:ih-2:1:1");
      expect(args[vfIndex + 1]).not.toContain("scale");
    });

    it("applies upscale when input is below WQHD", async () => {
      mockProbeMediaDimensions.mockResolvedValue({ width: 1920, height: 1080 });

      await applyGistWashAndUpscale("/input.mp4", "/output.mp4");

      // Should apply scale + GIST wash
      const args = mockSpawn.mock.calls[0][1];
      const vfIndex = args.indexOf("-vf");
      expect(args[vfIndex + 1]).toContain("scale=2560:1440");
      expect(args[vfIndex + 1]).toContain("noise=alls=5:allf=t+u");
      expect(args[vfIndex + 1]).toContain("crop=2558:1438:1:1");
    });

    it("treats exactly WQHD as already high-res", async () => {
      mockProbeMediaDimensions.mockResolvedValue({ width: 2560, height: 1440 });

      await applyGistWashAndUpscale("/input.mp4", "/output.mp4");

      const args = mockSpawn.mock.calls[0][1];
      const vfIndex = args.indexOf("-vf");
      expect(args[vfIndex + 1]).not.toContain("scale");
    });

    it("upscales when width or height is below WQHD", async () => {
      // Width OK, height too low
      mockProbeMediaDimensions.mockResolvedValue({ width: 2560, height: 1080 });

      await applyGistWashAndUpscale("/input.mp4", "/output.mp4");

      const args = mockSpawn.mock.calls[0][1];
      expect(args[args.indexOf("-vf") + 1]).toContain("scale=2560:1440");
    });

    it("handles 4K input without upscaling", async () => {
      mockProbeMediaDimensions.mockResolvedValue({ width: 3840, height: 2160 });

      await applyGistWashAndUpscale("/input.mp4", "/output.mp4");

      const args = mockSpawn.mock.calls[0][1];
      expect(args[args.indexOf("-vf") + 1]).not.toContain("scale");
    });
  });

  describe("GIST-only path (already WQHD)", () => {
    beforeEach(() => {
      mockProbeMediaDimensions.mockResolvedValue({ width: 2560, height: 1440 });
    });

    it("applies Gaussian noise filter", async () => {
      await applyGistWashAndUpscale("/in.mp4", "/out.mp4");

      const args = mockSpawn.mock.calls[0][1];
      expect(args[args.indexOf("-vf") + 1]).toContain("noise=alls=5:allf=t+u");
    });

    it("applies crop jitter", async () => {
      await applyGistWashAndUpscale("/in.mp4", "/out.mp4");

      const args = mockSpawn.mock.calls[0][1];
      expect(args[args.indexOf("-vf") + 1]).toContain("crop=iw-2:ih-2:1:1");
    });

    it("uses quality-controlled encode settings", async () => {
      await applyGistWashAndUpscale("/in.mp4", "/out.mp4");

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain("-c:v");
      expect(args).toContain("libx264");
      expect(args).toContain("-pix_fmt");
      expect(args).toContain("yuv420p");
      expect(args).toContain("-crf");
      expect(args).toContain("18");
      expect(args).toContain("-maxrate");
      expect(args).toContain("25M");
      expect(args).toContain("-bufsize");
      expect(args).toContain("50M");
    });
  });

  describe("GIST + upscale path (below WQHD)", () => {
    beforeEach(() => {
      mockProbeMediaDimensions.mockResolvedValue({ width: 1920, height: 1080 });
    });

    it("applies scale before noise and crop", async () => {
      await applyGistWashAndUpscale("/in.mp4", "/out.mp4");

      const args = mockSpawn.mock.calls[0][1];
      const filterStr = args[args.indexOf("-vf") + 1];
      // Scale should come first in the filter chain
      expect(filterStr).toMatch(/^scale=2560:1440,/);
    });

    it("crops to 2558x1438 after scaling for jitter", async () => {
      await applyGistWashAndUpscale("/in.mp4", "/out.mp4");

      const args = mockSpawn.mock.calls[0][1];
      const filterStr = args[args.indexOf("-vf") + 1];
      expect(filterStr).toContain("crop=2558:1438:1:1");
    });

    // Capped-CRF, NOT CBR: post-process.ts:70-81 uses -crf 18 with a maxrate
    // ceiling rather than a fixed -b:v, to avoid bitrate starvation on complex
    // scenes while still bounding file size.
    it("uses capped-CRF encoding for upscaled content", async () => {
      await applyGistWashAndUpscale("/in.mp4", "/out.mp4");

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain("-c:v");
      expect(args).toContain("libx264");
      expect(args).not.toContain("-b:v");
      expect(args).toContain("-crf");
      expect(args).toContain("18");
      expect(args).toContain("-maxrate");
      expect(args).toContain("30M");
      expect(args).toContain("-bufsize");
      expect(args).toContain("60M");
    });
  });

  describe("common FFmpeg settings", () => {
    beforeEach(() => {
      mockProbeMediaDimensions.mockResolvedValue({ width: 1920, height: 1080 });
    });

    it("uses the medium preset (quality/speed balance)", async () => {
      await applyGistWashAndUpscale("/in.mp4", "/out.mp4");

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain("-preset");
      expect(args).toContain("medium");
    });

    it("copies audio without re-encoding", async () => {
      await applyGistWashAndUpscale("/in.mp4", "/out.mp4");

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain("-c:a");
      expect(args).toContain("copy");
    });

    it("overwrites output with -y flag", async () => {
      await applyGistWashAndUpscale("/in.mp4", "/out.mp4");

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain("-y");
    });

    it("respects FFMPEG_PATH environment variable", async () => {
      process.env.FFMPEG_PATH = "/custom/bin/ffmpeg";

      await applyGistWashAndUpscale("/in.mp4", "/out.mp4");

      expect(mockSpawn).toHaveBeenCalledWith(
        "/custom/bin/ffmpeg",
        expect.any(Array),
      );

      delete process.env.FFMPEG_PATH;
    });

    it("defaults to 'ffmpeg' when FFMPEG_PATH not set", async () => {
      delete process.env.FFMPEG_PATH;

      await applyGistWashAndUpscale("/in.mp4", "/out.mp4");

      expect(mockSpawn).toHaveBeenCalledWith("ffmpeg", expect.any(Array));
    });
  });

  describe("error handling", () => {
    beforeEach(() => {
      mockProbeMediaDimensions.mockResolvedValue({ width: 1920, height: 1080 });
    });

    it("rejects when ffmpeg exits with non-zero code", async () => {
      // Override default auto-emit to emit error code
      const errProc = Object.assign(new EventEmitter(), {
        stderr: new EventEmitter(),
      });
      mockSpawn.mockImplementation(() => {
        setImmediate(() => {
          errProc.stderr.emit("data", Buffer.from("Error: invalid codec"));
          errProc.emit("close", 1);
        });
        return errProc as any;
      });

      await expect(
        applyGistWashAndUpscale("/in.mp4", "/out.mp4"),
      ).rejects.toThrow("[post-process] FFmpeg exited 1:");
    });

    it("includes last 800 chars of stderr in error", async () => {
      const errProc = Object.assign(new EventEmitter(), {
        stderr: new EventEmitter(),
      });
      mockSpawn.mockImplementation(() => {
        setImmediate(() => {
          errProc.stderr.emit(
            "data",
            Buffer.from("x".repeat(1000) + "ACTUAL ERROR"),
          );
          errProc.emit("close", 1);
        });
        return errProc as any;
      });

      await expect(
        applyGistWashAndUpscale("/in.mp4", "/out.mp4"),
      ).rejects.toThrow("ACTUAL ERROR");
    });

    it("handles probe failures", async () => {
      mockProbeMediaDimensions.mockRejectedValue(
        new Error("ffprobe failed: file not found"),
      );

      await expect(
        applyGistWashAndUpscale("/missing.mp4", "/out.mp4"),
      ).rejects.toThrow("ffprobe failed: file not found");

      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it("handles various exit codes", async () => {
      const testCases = [1, 2, 127, 255];

      for (const code of testCases) {
        vi.clearAllMocks();
        mockProbeMediaDimensions.mockResolvedValue({
          width: 1920,
          height: 1080,
        });

        const mockProc = Object.assign(new EventEmitter(), {
          stderr: new EventEmitter(),
        });
        mockSpawn.mockImplementation(() => {
          setImmediate(() => {
            mockProc.stderr.emit("data", Buffer.from("error"));
            mockProc.emit("close", code);
          });
          return mockProc as any;
        });

        await expect(
          applyGistWashAndUpscale("/in.mp4", "/out.mp4"),
        ).rejects.toThrow(`FFmpeg exited ${code}`);
      }
    });
  });

  describe("various resolutions", () => {
    it("handles HD (1280x720) → upscale", async () => {
      mockProbeMediaDimensions.mockResolvedValue({ width: 1280, height: 720 });

      await applyGistWashAndUpscale("/in.mp4", "/out.mp4");

      const args = mockSpawn.mock.calls[0][1];
      expect(args[args.indexOf("-vf") + 1]).toContain("scale=2560:1440");
    });

    it("handles Full HD (1920x1080) → upscale", async () => {
      mockProbeMediaDimensions.mockResolvedValue({ width: 1920, height: 1080 });

      await applyGistWashAndUpscale("/in.mp4", "/out.mp4");

      const args = mockSpawn.mock.calls[0][1];
      expect(args[args.indexOf("-vf") + 1]).toContain("scale=2560:1440");
    });

    it("handles WQHD (2560x1440) → GIST only", async () => {
      mockProbeMediaDimensions.mockResolvedValue({ width: 2560, height: 1440 });

      await applyGistWashAndUpscale("/in.mp4", "/out.mp4");

      const args = mockSpawn.mock.calls[0][1];
      expect(args[args.indexOf("-vf") + 1]).not.toContain("scale");
    });

    it("handles 4K (3840x2160) → GIST only", async () => {
      mockProbeMediaDimensions.mockResolvedValue({ width: 3840, height: 2160 });

      await applyGistWashAndUpscale("/in.mp4", "/out.mp4");

      const args = mockSpawn.mock.calls[0][1];
      expect(args[args.indexOf("-vf") + 1]).not.toContain("scale");
    });

    it("handles vertical video (1080x1920) → upscale", async () => {
      mockProbeMediaDimensions.mockResolvedValue({ width: 1080, height: 1920 });

      await applyGistWashAndUpscale("/in.mp4", "/out.mp4");

      const args = mockSpawn.mock.calls[0][1];
      expect(args[args.indexOf("-vf") + 1]).toContain("scale=2560:1440");
    });
  });

  describe("various file paths", () => {
    beforeEach(() => {
      mockProbeMediaDimensions.mockResolvedValue({ width: 1920, height: 1080 });
    });

    it("handles different input/output paths", async () => {
      const testCases = [
        {
          input: "/tmp/render-123/inter.mp4",
          output: "/tmp/render-123/final.mp4",
        },
        { input: "/var/tmp/raw.mp4", output: "/var/tmp/processed.mp4" },
        { input: "/home/user/video.mp4", output: "/home/user/output.mp4" },
      ];

      for (const { input, output } of testCases) {
        vi.clearAllMocks();
        mockProbeMediaDimensions.mockResolvedValue({
          width: 1920,
          height: 1080,
        });
        makeAutoProcess(0);

        await applyGistWashAndUpscale(input, output);

        expect(mockProbeMediaDimensions).toHaveBeenCalledWith(input);
        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          expect.arrayContaining(["-i", input]),
        );
      }
    });
  });
});
