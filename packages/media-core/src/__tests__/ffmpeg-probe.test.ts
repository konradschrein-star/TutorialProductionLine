/**
 * FFmpeg Probe Tests
 *
 * Tests for probeMediaDuration and probeMediaDimensions - functions that
 * use ffprobe to extract media file metadata.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

// Mock child_process
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

// Mock util.promisify to return the mock directly
vi.mock("node:util", () => ({
  promisify: (fn: any) => fn,
}));

import { probeMediaDuration, probeMediaDimensions } from "../ffmpeg/probe.js";
import { execFile, spawn } from "node:child_process";

const mockExecFile = vi.mocked(execFile);
const mockSpawn = vi.mocked(spawn);

describe("probeMediaDuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FFPROBE_PATH;
  });

  describe("video files with duration field", () => {
    it("returns duration from video stream", async () => {
      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          streams: [{ duration: "125.5" }],
        }),
      });

      const duration = await probeMediaDuration("/path/to/video.mp4");

      expect(duration).toBe(125.5);
      expect(mockExecFile).toHaveBeenCalledWith(
        "ffprobe",
        expect.arrayContaining([
          "-v", "quiet",
          "-print_format", "json",
          "-show_streams",
          "-select_streams", "v:0",
          "/path/to/video.mp4",
        ])
      );
    });

    it("handles integer durations", async () => {
      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          streams: [{ duration: "60" }],
        }),
      });

      const duration = await probeMediaDuration("/video.mp4");

      expect(duration).toBe(60);
    });

    it("handles fractional durations", async () => {
      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          streams: [{ duration: "123.456789" }],
        }),
      });

      const duration = await probeMediaDuration("/video.mp4");

      expect(duration).toBe(123.456789);
    });
  });

  describe("video files without duration field", () => {
    it("calculates duration from nb_frames and r_frame_rate", async () => {
      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          streams: [{
            nb_frames: "900",
            r_frame_rate: "30/1",
          }],
        }),
      });

      const duration = await probeMediaDuration("/video.mp4");

      expect(duration).toBe(30); // 900 frames / 30 fps = 30 seconds
    });

    it("handles fractional frame rates", async () => {
      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          streams: [{
            nb_frames: "1500",
            r_frame_rate: "29.97/1",
          }],
        }),
      });

      const duration = await probeMediaDuration("/video.mp4");

      expect(duration).toBeCloseTo(50.05, 1); // 1500 / 29.97
    });

    it("handles complex frame rate ratios", async () => {
      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          streams: [{
            nb_frames: "1000",
            r_frame_rate: "30000/1001", // 29.97 fps (NTSC)
          }],
        }),
      });

      const duration = await probeMediaDuration("/video.mp4");

      expect(duration).toBeCloseTo(33.37, 1); // 1000 / (30000/1001)
    });
  });

  describe("audio-only files", () => {
    it("probes audio stream when no video stream exists", async () => {
      mockExecFile
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ streams: [] }), // No video stream
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            streams: [{ duration: "180.5" }], // Audio stream
          }),
        });

      const duration = await probeMediaDuration("/audio.mp3");

      expect(duration).toBe(180.5);
      expect(mockExecFile).toHaveBeenCalledTimes(2);
      expect(mockExecFile).toHaveBeenNthCalledWith(
        2,
        "ffprobe",
        expect.arrayContaining(["-select_streams", "a:0"])
      );
    });
  });

  describe("error handling", () => {
    it("throws error when JSON parsing fails", async () => {
      mockExecFile.mockResolvedValue({
        stdout: "invalid json {{{",
      });

      await expect(
        probeMediaDuration("/corrupted.mp4")
      ).rejects.toThrow("ffprobe JSON parse failed");
    });

    it("throws error when no streams found", async () => {
      mockExecFile
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ streams: [] }),
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ streams: [] }),
        });

      await expect(
        probeMediaDuration("/empty.mp4")
      ).rejects.toThrow("No streams found");
    });

    it("throws error when duration cannot be determined", async () => {
      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          streams: [{}], // No duration, nb_frames, or r_frame_rate
        }),
      });

      await expect(
        probeMediaDuration("/file.mp4")
      ).rejects.toThrow("Cannot determine duration");
    });

    it("throws error when ffprobe execution fails", async () => {
      mockExecFile.mockRejectedValue(new Error("ffprobe not found"));

      await expect(
        probeMediaDuration("/video.mp4")
      ).rejects.toThrow("ffprobe not found");
    });
  });

  describe("custom ffprobe path", () => {
    it("uses FFPROBE_PATH environment variable", async () => {
      process.env.FFPROBE_PATH = "/custom/path/ffprobe";

      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          streams: [{ duration: "100" }],
        }),
      });

      await probeMediaDuration("/video.mp4");

      expect(mockExecFile).toHaveBeenCalledWith(
        "/custom/path/ffprobe",
        expect.any(Array)
      );
    });

    it("defaults to 'ffprobe' when FFPROBE_PATH not set", async () => {
      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          streams: [{ duration: "100" }],
        }),
      });

      await probeMediaDuration("/video.mp4");

      expect(mockExecFile).toHaveBeenCalledWith(
        "ffprobe",
        expect.any(Array)
      );
    });
  });
});

describe("probeMediaDimensions", () => {
  let mockProcess: any;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FFPROBE_PATH;

    // Create mock process with EventEmitter behavior
    mockProcess = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });

    mockSpawn.mockReturnValue(mockProcess);
  });

  describe("successful dimension extraction", () => {
    it("returns width and height from video stream", async () => {
      const promise = probeMediaDimensions("/video.mp4");

      // Simulate ffprobe output
      mockProcess.stdout.emit("data", JSON.stringify({
        streams: [{ width: 1920, height: 1080 }],
      }));
      mockProcess.emit("close", 0);

      const dimensions = await promise;

      expect(dimensions).toEqual({ width: 1920, height: 1080 });
    });

    it("handles various resolutions", async () => {
      const testCases = [
        { width: 3840, height: 2160 }, // 4K
        { width: 1280, height: 720 },  // HD
        { width: 640, height: 480 },   // SD
        { width: 1080, height: 1920 }, // Vertical video
      ];

      for (const { width, height } of testCases) {
        vi.clearAllMocks();
        const mockProc = Object.assign(new EventEmitter(), {
          stdout: new EventEmitter(),
        });
        mockSpawn.mockReturnValue(mockProc);

        const promise = probeMediaDimensions("/video.mp4");

        mockProc.stdout.emit("data", JSON.stringify({
          streams: [{ width, height }],
        }));
        mockProc.emit("close", 0);

        const dimensions = await promise;
        expect(dimensions).toEqual({ width, height });
      }
    });

    it("handles chunked stdout data", async () => {
      const promise = probeMediaDimensions("/video.mp4");

      // Simulate data arriving in chunks
      mockProcess.stdout.emit("data", '{"streams":[{"w');
      mockProcess.stdout.emit("data", 'idth":1920,"he');
      mockProcess.stdout.emit("data", 'ight":1080}]}');
      mockProcess.emit("close", 0);

      const dimensions = await promise;

      expect(dimensions).toEqual({ width: 1920, height: 1080 });
    });
  });

  describe("error handling", () => {
    it("rejects when ffprobe exits with non-zero code", async () => {
      const promise = probeMediaDimensions("/missing.mp4");

      mockProcess.emit("close", 1);

      await expect(promise).rejects.toThrow(
        "ffprobe dimensions failed with code 1"
      );
    });

    it("rejects when JSON parsing fails", async () => {
      const promise = probeMediaDimensions("/corrupted.mp4");

      mockProcess.stdout.emit("data", "invalid json {{{");
      mockProcess.emit("close", 0);

      await expect(promise).rejects.toThrow(
        "Failed to parse ffprobe output"
      );
    });

    it("rejects when no video stream found", async () => {
      const promise = probeMediaDimensions("/audio.mp3");

      mockProcess.stdout.emit("data", JSON.stringify({ streams: [] }));
      mockProcess.emit("close", 0);

      await expect(promise).rejects.toThrow(
        "No video stream dimensions found"
      );
    });

    it("rejects when stream has no width", async () => {
      const promise = probeMediaDimensions("/file.mp4");

      mockProcess.stdout.emit("data", JSON.stringify({
        streams: [{ height: 1080 }], // Missing width
      }));
      mockProcess.emit("close", 0);

      await expect(promise).rejects.toThrow(
        "No video stream dimensions found"
      );
    });

    it("rejects when stream has no height", async () => {
      const promise = probeMediaDimensions("/file.mp4");

      mockProcess.stdout.emit("data", JSON.stringify({
        streams: [{ width: 1920 }], // Missing height
      }));
      mockProcess.emit("close", 0);

      await expect(promise).rejects.toThrow(
        "No video stream dimensions found"
      );
    });
  });

  describe("custom ffprobe path", () => {
    it("uses FFPROBE_PATH environment variable", async () => {
      process.env.FFPROBE_PATH = "/usr/local/bin/ffprobe";

      const promise = probeMediaDimensions("/video.mp4");

      expect(mockSpawn).toHaveBeenCalledWith(
        "/usr/local/bin/ffprobe",
        expect.any(Array)
      );

      mockProcess.stdout.emit("data", JSON.stringify({
        streams: [{ width: 1920, height: 1080 }],
      }));
      mockProcess.emit("close", 0);

      await promise;
    });

    it("defaults to 'ffprobe' when FFPROBE_PATH not set", async () => {
      const promise = probeMediaDimensions("/video.mp4");

      expect(mockSpawn).toHaveBeenCalledWith(
        "ffprobe",
        expect.any(Array)
      );

      mockProcess.stdout.emit("data", JSON.stringify({
        streams: [{ width: 1920, height: 1080 }],
      }));
      mockProcess.emit("close", 0);

      await promise;
    });
  });

  describe("ffprobe command arguments", () => {
    it("passes correct arguments to ffprobe", async () => {
      const promise = probeMediaDimensions("/path/to/video.mp4");

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        [
          "-v", "quiet",
          "-print_format", "json",
          "-show_streams",
          "-select_streams", "v:0",
          "/path/to/video.mp4",
        ]
      );

      mockProcess.stdout.emit("data", JSON.stringify({
        streams: [{ width: 1920, height: 1080 }],
      }));
      mockProcess.emit("close", 0);

      await promise;
    });
  });
});
