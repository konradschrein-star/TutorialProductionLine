/**
 * FFmpeg Upscale Tests
 *
 * Tests for upscaleTo1440p - upscales video to 2560x1440 to force YouTube
 * to use VP9 codec for better quality and detection resistance.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// Mock child_process
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { upscaleTo1440p } from "../ffmpeg/upscale.js";
import { spawn } from "node:child_process";

const mockSpawn = vi.mocked(spawn);

describe("upscaleTo1440p", () => {
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
    it("upscales video to 1440p", async () => {
      const promise = upscaleTo1440p("/tmp/input.mp4", "/tmp/output.mp4");

      mockProcess.emit("close", 0);

      await promise;

      expect(mockSpawn).toHaveBeenCalledWith("ffmpeg", expect.any(Array));
    });

    it("passes correct ffmpeg arguments", async () => {
      const promise = upscaleTo1440p("/input.mp4", "/output.mp4");

      mockProcess.emit("close", 0);

      await promise;

      expect(mockSpawn).toHaveBeenCalledWith("ffmpeg", [
        "-i",
        "/input.mp4",
        "-vf",
        "scale=2560:1440",
        "-c:v",
        "libx264",
        "-b:v",
        "15M",
        "-maxrate",
        "20M",
        "-bufsize",
        "40M",
        "-preset",
        "faster",
        "-c:a",
        "copy",
        "-y",
        "/output.mp4",
      ]);
    });

    it("scales to 2560x1440 resolution", async () => {
      const promise = upscaleTo1440p("/in.mp4", "/out.mp4");

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      const vfIndex = args.indexOf("-vf");
      expect(vfIndex).toBeGreaterThan(-1);
      expect(args[vfIndex + 1]).toBe("scale=2560:1440");
    });

    it("uses libx264 codec", async () => {
      const promise = upscaleTo1440p("/in.mp4", "/out.mp4");

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain("-c:v");
      expect(args).toContain("libx264");
    });

    it("sets target bitrate to 15M", async () => {
      const promise = upscaleTo1440p("/in.mp4", "/out.mp4");

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain("-b:v");
      expect(args).toContain("15M");
    });

    it("sets max bitrate to 20M", async () => {
      const promise = upscaleTo1440p("/in.mp4", "/out.mp4");

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain("-maxrate");
      expect(args).toContain("20M");
    });

    it("sets buffer size to 40M", async () => {
      const promise = upscaleTo1440p("/in.mp4", "/out.mp4");

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain("-bufsize");
      expect(args).toContain("40M");
    });

    it("uses faster preset for speed", async () => {
      const promise = upscaleTo1440p("/in.mp4", "/out.mp4");

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain("-preset");
      expect(args).toContain("faster");
    });

    it("copies audio stream without re-encoding", async () => {
      const promise = upscaleTo1440p("/in.mp4", "/out.mp4");

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain("-c:a");
      expect(args).toContain("copy");
    });

    it("overwrites output file with -y flag", async () => {
      const promise = upscaleTo1440p("/in.mp4", "/out.mp4");

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain("-y");
    });

    it("resolves when ffmpeg exits with code 0", async () => {
      const promise = upscaleTo1440p("/in.mp4", "/out.mp4");

      mockProcess.emit("close", 0);

      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("rejects when ffmpeg exits with non-zero code", async () => {
      const promise = upscaleTo1440p("/in.mp4", "/out.mp4");

      mockProcess.stderr.emit("data", Buffer.from("Error: codec not found"));
      mockProcess.emit("close", 1);

      await expect(promise).rejects.toThrow(
        "1440p upscale failed with code 1: Error: codec not found",
      );
    });

    it("includes stderr in error message", async () => {
      const promise = upscaleTo1440p("/in.mp4", "/out.mp4");

      mockProcess.stderr.emit("data", Buffer.from("FFmpeg error:\n"));
      mockProcess.stderr.emit("data", Buffer.from("Invalid input file\n"));
      mockProcess.emit("close", 2);

      await expect(promise).rejects.toThrow(
        "FFmpeg error:\nInvalid input file\n",
      );
    });

    it("handles various exit codes", async () => {
      const testCases = [1, 2, 127, 255];

      for (const code of testCases) {
        vi.clearAllMocks();
        const mockProc = Object.assign(new EventEmitter(), {
          stderr: new EventEmitter(),
        });
        mockSpawn.mockReturnValue(mockProc);

        const promise = upscaleTo1440p("/in.mp4", "/out.mp4");

        mockProc.stderr.emit("data", Buffer.from("error"));
        mockProc.emit("close", code);

        await expect(promise).rejects.toThrow(
          `1440p upscale failed with code ${code}`,
        );
      }
    });

    it("accumulates stderr from multiple data events", async () => {
      const promise = upscaleTo1440p("/in.mp4", "/out.mp4");

      mockProcess.stderr.emit("data", Buffer.from("Line 1\n"));
      mockProcess.stderr.emit("data", Buffer.from("Line 2\n"));
      mockProcess.stderr.emit("data", Buffer.from("Line 3\n"));
      mockProcess.emit("close", 1);

      await expect(promise).rejects.toThrow("Line 1\nLine 2\nLine 3\n");
    });

    it("handles empty stderr on failure", async () => {
      const promise = upscaleTo1440p("/in.mp4", "/out.mp4");

      mockProcess.emit("close", 1);

      await expect(promise).rejects.toThrow(
        "1440p upscale failed with code 1: ",
      );
    });
  });

  describe("various file paths", () => {
    it("handles different input/output path formats", async () => {
      const testCases = [
        {
          input: "/tmp/render-123/720p.mp4",
          output: "/tmp/render-123/1440p.mp4",
        },
        { input: "/var/tmp/low-res.mp4", output: "/var/tmp/high-res.mp4" },
        {
          input: "/home/user/videos/original.mp4",
          output: "/home/user/videos/upscaled.mp4",
        },
      ];

      for (const { input, output } of testCases) {
        vi.clearAllMocks();
        const mockProc = Object.assign(new EventEmitter(), {
          stderr: new EventEmitter(),
        });
        mockSpawn.mockReturnValue(mockProc);

        const promise = upscaleTo1440p(input, output);

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

    it("handles absolute paths", async () => {
      const promise = upscaleTo1440p(
        "/absolute/path/input.mp4",
        "/absolute/path/output.mp4",
      );

      mockProcess.emit("close", 0);

      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "ffmpeg",
        expect.arrayContaining(["-i", "/absolute/path/input.mp4"]),
      );
      expect(mockSpawn).toHaveBeenCalledWith(
        "ffmpeg",
        expect.arrayContaining(["/absolute/path/output.mp4"]),
      );
    });
  });

  describe("stderr progress logging", () => {
    it("handles FFmpeg progress output on stderr", async () => {
      const promise = upscaleTo1440p("/in.mp4", "/out.mp4");

      // FFmpeg logs progress to stderr during normal operation
      mockProcess.stderr.emit(
        "data",
        Buffer.from("frame=  100 fps=30 time=00:00:03.33\n"),
      );
      mockProcess.stderr.emit(
        "data",
        Buffer.from("frame=  200 fps=30 time=00:00:06.66\n"),
      );
      mockProcess.emit("close", 0);

      await expect(promise).resolves.toBeUndefined();
    });

    it("collects verbose FFmpeg output", async () => {
      const promise = upscaleTo1440p("/in.mp4", "/out.mp4");

      const stderrLines = [
        "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'input.mp4':\n",
        "  Duration: 00:01:30.00, start: 0.000000, bitrate: 5000 kb/s\n",
        "  Stream #0:0: Video: h264, yuv420p, 1920x1080, 30 fps\n",
        "Output #0, mp4, to 'output.mp4':\n",
        "  Stream #0:0: Video: h264, yuv420p, 2560x1440, 15000 kb/s, 30 fps\n",
      ];

      for (const line of stderrLines) {
        mockProcess.stderr.emit("data", Buffer.from(line));
      }

      mockProcess.emit("close", 1);

      await expect(promise).rejects.toThrow("Input #0");
    });
  });
});
