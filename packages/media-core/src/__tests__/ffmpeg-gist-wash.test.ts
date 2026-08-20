/**
 * GIST Wash Tests
 *
 * Tests for applyGistWash - applies Gaussian noise + crop jitter to create
 * unique video fingerprints per render for anti-detection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// Mock child_process
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { applyGistWash } from "../ffmpeg/gist-wash.js";
import { spawn } from "node:child_process";

const mockSpawn = vi.mocked(spawn);

describe("applyGistWash", () => {
  let mockProcess: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock process with EventEmitter behavior
    mockProcess = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
    });

    mockSpawn.mockReturnValue(mockProcess);
  });

  describe("successful execution", () => {
    it("applies GIST wash to video", async () => {
      const promise = applyGistWash("/tmp/input.mp4", "/tmp/output.mp4");

      mockProcess.emit("close", 0);

      await promise;

      expect(mockSpawn).toHaveBeenCalledWith("ffmpeg", expect.any(Array));
    });

    it("passes correct ffmpeg arguments", async () => {
      const promise = applyGistWash("/input.mp4", "/output.mp4");

      mockProcess.emit("close", 0);

      await promise;

      expect(mockSpawn).toHaveBeenCalledWith("ffmpeg", [
        "-i",
        "/input.mp4",
        "-vf",
        "noise=alls=10:allf=t+u,crop=iw-2:ih-2:1:1",
        "-c:v",
        "libx264",
        "-crf",
        "20",
        "-maxrate",
        "15M",
        "-bufsize",
        "30M",
        "-preset",
        "faster",
        "-c:a",
        "copy",
        "-y",
        "/output.mp4",
      ]);
    });

    it("applies Gaussian noise filter", async () => {
      const promise = applyGistWash("/in.mp4", "/out.mp4");

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      const vfIndex = args.indexOf("-vf");
      expect(vfIndex).toBeGreaterThan(-1);
      expect(args[vfIndex + 1]).toContain("noise=alls=10:allf=t+u");
    });

    it("applies crop jitter filter", async () => {
      const promise = applyGistWash("/in.mp4", "/out.mp4");

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      const vfIndex = args.indexOf("-vf");
      expect(args[vfIndex + 1]).toContain("crop=iw-2:ih-2:1:1");
    });

    it("uses libx264 codec with quality settings", async () => {
      const promise = applyGistWash("/in.mp4", "/out.mp4");

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain("-c:v");
      expect(args).toContain("libx264");
      expect(args).toContain("-crf");
      expect(args).toContain("20");
    });

    it("sets max bitrate and buffer size", async () => {
      const promise = applyGistWash("/in.mp4", "/out.mp4");

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain("-maxrate");
      expect(args).toContain("15M");
      expect(args).toContain("-bufsize");
      expect(args).toContain("30M");
    });

    it("copies audio stream without re-encoding", async () => {
      const promise = applyGistWash("/in.mp4", "/out.mp4");

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain("-c:a");
      expect(args).toContain("copy");
    });

    it("overwrites output file with -y flag", async () => {
      const promise = applyGistWash("/in.mp4", "/out.mp4");

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain("-y");
    });

    it("resolves when ffmpeg exits with code 0", async () => {
      const promise = applyGistWash("/in.mp4", "/out.mp4");

      mockProcess.emit("close", 0);

      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("rejects when ffmpeg exits with non-zero code", async () => {
      const promise = applyGistWash("/in.mp4", "/out.mp4");

      mockProcess.stderr.emit("data", Buffer.from("Error: file not found"));
      mockProcess.emit("close", 1);

      await expect(promise).rejects.toThrow(
        "GIST wash failed with code 1: Error: file not found",
      );
    });

    it("includes stderr in error message", async () => {
      const promise = applyGistWash("/in.mp4", "/out.mp4");

      mockProcess.stderr.emit("data", Buffer.from("First error\n"));
      mockProcess.stderr.emit("data", Buffer.from("Second error\n"));
      mockProcess.emit("close", 1);

      await expect(promise).rejects.toThrow("First error\nSecond error\n");
    });

    it("handles ffmpeg spawn with various exit codes", async () => {
      const testCases = [1, 2, 127, 255];

      for (const code of testCases) {
        vi.clearAllMocks();
        const mockProc = Object.assign(new EventEmitter(), {
          stderr: new EventEmitter(),
        });
        mockSpawn.mockReturnValue(mockProc);

        const promise = applyGistWash("/in.mp4", "/out.mp4");

        mockProc.stderr.emit("data", Buffer.from("error"));
        mockProc.emit("close", code);

        await expect(promise).rejects.toThrow(
          `GIST wash failed with code ${code}`,
        );
      }
    });

    it("accumulates stderr output from multiple chunks", async () => {
      const promise = applyGistWash("/in.mp4", "/out.mp4");

      mockProcess.stderr.emit("data", Buffer.from("Error: "));
      mockProcess.stderr.emit("data", Buffer.from("permission "));
      mockProcess.stderr.emit("data", Buffer.from("denied"));
      mockProcess.emit("close", 1);

      await expect(promise).rejects.toThrow("Error: permission denied");
    });
  });

  describe("various file paths", () => {
    it("handles different input/output path formats", async () => {
      const testCases = [
        {
          input: "/tmp/render-123/input.mp4",
          output: "/tmp/render-123/gist.mp4",
        },
        { input: "/var/tmp/video.mp4", output: "/var/tmp/washed.mp4" },
        {
          input: "/home/user/videos/raw.mp4",
          output: "/home/user/videos/processed.mp4",
        },
      ];

      for (const { input, output } of testCases) {
        vi.clearAllMocks();
        const mockProc = Object.assign(new EventEmitter(), {
          stderr: new EventEmitter(),
        });
        mockSpawn.mockReturnValue(mockProc);

        const promise = applyGistWash(input, output);

        expect(mockSpawn).toHaveBeenCalledWith(
          "ffmpeg",
          expect.arrayContaining(["-i", input]),
        );
        expect(mockSpawn).toHaveBeenCalledWith(
          "ffmpeg",
          expect.arrayContaining([output]),
        );

        mockProc.emit("close", 0);
        await promise;
      }
    });

    it("handles paths with spaces (though not recommended)", async () => {
      const promise = applyGistWash("/tmp/my video.mp4", "/tmp/my output.mp4");

      mockProcess.emit("close", 0);

      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "ffmpeg",
        expect.arrayContaining(["-i", "/tmp/my video.mp4"]),
      );
    });
  });

  describe("stderr logging", () => {
    it("handles stderr data events without errors", async () => {
      const promise = applyGistWash("/in.mp4", "/out.mp4");

      // FFmpeg logs progress to stderr even on success
      mockProcess.stderr.emit("data", Buffer.from("frame=100 fps=30\n"));
      mockProcess.stderr.emit("data", Buffer.from("frame=200 fps=30\n"));
      mockProcess.emit("close", 0);

      await expect(promise).resolves.toBeUndefined();
    });

    it("collects all stderr output", async () => {
      const promise = applyGistWash("/in.mp4", "/out.mp4");

      const stderrChunks = [
        "Input #0, mov,mp4,m4a\n",
        "Duration: 00:01:30.00\n",
        "Stream #0:0: Video: h264\n",
        "Output #0, mp4\n",
      ];

      for (const chunk of stderrChunks) {
        mockProcess.stderr.emit("data", Buffer.from(chunk));
      }

      mockProcess.emit("close", 1);

      await expect(promise).rejects.toThrow("Input #0");
    });
  });
});
