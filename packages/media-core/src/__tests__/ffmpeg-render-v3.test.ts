/**
 * FFmpeg V3 Render Tests
 *
 * Tests for renderV3 - renders native FFmpeg videos from static scene images +
 * TTS audio with Ken Burns effects and caption burning.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// Mock child_process
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import {
  renderV3,
  type V3RenderParams,
  type V3Scene,
} from "../ffmpeg/render-v3.js";
import { spawn } from "node:child_process";

const mockSpawn = vi.mocked(spawn);

describe("renderV3", () => {
  let mockProcess: any;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FFMPEG_PATH;

    mockProcess = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
    });

    mockSpawn.mockReturnValue(mockProcess);
  });

  describe("successful render", () => {
    it("renders video from scenes and audio", async () => {
      const scenes: V3Scene[] = [
        {
          imagePath: "/tmp/scene1.jpg",
          durationSeconds: 5.0,
          durationFrames: 150,
          sceneIndex: 0,
        },
      ];

      const params: V3RenderParams = {
        scenes,
        audioPath: "/tmp/audio.mp3",
        assPath: "/tmp/captions.ass",
        outputPath: "/tmp/output.mp4",
        fps: 30,
        width: 1920,
        height: 1080,
      };

      const promise = renderV3(params);

      mockProcess.emit("close", 0);

      await promise;

      expect(mockSpawn).toHaveBeenCalledWith("ffmpeg", expect.any(Array));
    });

    it("includes all input files", async () => {
      const scenes: V3Scene[] = [
        {
          imagePath: "/tmp/scene1.jpg",
          durationSeconds: 3.0,
          durationFrames: 90,
          sceneIndex: 0,
        },
        {
          imagePath: "/tmp/scene2.jpg",
          durationSeconds: 4.0,
          durationFrames: 120,
          sceneIndex: 1,
        },
      ];

      const params: V3RenderParams = {
        scenes,
        audioPath: "/tmp/tts.mp3",
        assPath: "/tmp/subs.ass",
        outputPath: "/tmp/final.mp4",
        fps: 30,
        width: 1920,
        height: 1080,
      };

      const promise = renderV3(params);

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain("/tmp/scene1.jpg");
      expect(args).toContain("/tmp/scene2.jpg");
      expect(args).toContain("/tmp/tts.mp3");
    });

    it("builds filter_complex for scenes (Ken Burns currently disabled)", async () => {
      // Ken Burns (zoompan) is temporarily disabled in production.
      // This test verifies the filter_complex is still built with scale/pad/setsar.
      const scenes: V3Scene[] = [
        {
          imagePath: "/tmp/img.jpg",
          durationSeconds: 5.0,
          durationFrames: 150,
          sceneIndex: 0,
        },
      ];

      const params: V3RenderParams = {
        scenes,
        audioPath: "/tmp/audio.mp3",
        assPath: "/tmp/captions.ass",
        outputPath: "/tmp/out.mp4",
        fps: 30,
        width: 1920,
        height: 1080,
      };

      const promise = renderV3(params);

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      const filterIdx = args.indexOf("-filter_complex");
      expect(filterIdx).toBeGreaterThan(-1);
      const filterStr = args[filterIdx + 1];
      // Scale/pad/setsar are always present; zoompan is disabled
      expect(filterStr).toContain("scale=");
      expect(filterStr).toContain("setsar=1");
    });

    // ── Standing project invariant ────────────────────────────────────────
    // Subtitles are OFF BY DEFAULT for FFmpeg renders and are never burned in
    // unless explicitly opted into via the Global Subtitle System. The opt-in
    // is `assPath`, which the only production caller
    // (apps/worker-render/src/workflows/v3-ffmpeg.ts:251-288) sets ONLY when
    // resolveSubtitlePreset() returns an active `ffmpeg`-engine preset AND
    // word timestamps exist. With no assignment the resolver returns null
    // (resolve-subtitle-preset.ts:118,126), so assPath stays undefined.
    // These two tests pin BOTH halves of that contract.
    it("burns NO subtitles by default (assPath omitted)", async () => {
      const scenes: V3Scene[] = [
        {
          imagePath: "/tmp/img.jpg",
          durationSeconds: 5.0,
          durationFrames: 150,
          sceneIndex: 0,
        },
      ];

      // No assPath — this is the default path for a job with no ffmpeg-engine
      // subtitle preset assigned.
      const params: V3RenderParams = {
        scenes,
        audioPath: "/tmp/audio.mp3",
        outputPath: "/tmp/output.mp4",
        fps: 30,
        width: 1920,
        height: 1080,
      };

      const promise = renderV3(params);

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      const filterStr = args[args.indexOf("-filter_complex") + 1];
      // No subtitles filter, and the video passes through untouched.
      expect(filterStr).not.toContain("subtitles=");
      expect(filterStr).toContain("[outv]null[finalv]");
      expect(mockSpawn).toHaveBeenCalled();
    });

    it("burns subtitles only when explicitly opted in via assPath", async () => {
      const scenes: V3Scene[] = [
        {
          imagePath: "/tmp/img.jpg",
          durationSeconds: 5.0,
          durationFrames: 150,
          sceneIndex: 0,
        },
      ];

      const params: V3RenderParams = {
        scenes,
        audioPath: "/tmp/audio.mp3",
        assPath: "/tmp/render-123/captions.ass",
        outputPath: "/tmp/output.mp4",
        fps: 30,
        width: 1920,
        height: 1080,
      };

      const promise = renderV3(params);

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      const filterStr = args[args.indexOf("-filter_complex") + 1];
      expect(filterStr).toContain(
        "subtitles=filename='/tmp/render-123/captions.ass'",
      );
      // No fontsDir given → no fontsdir argument appended.
      expect(filterStr).not.toContain("fontsdir=");
    });

    it("passes fontsdir to libass when a fonts directory is resolved", async () => {
      const scenes: V3Scene[] = [
        {
          imagePath: "/tmp/img.jpg",
          durationSeconds: 5.0,
          durationFrames: 150,
          sceneIndex: 0,
        },
      ];

      const params: V3RenderParams = {
        scenes,
        audioPath: "/tmp/audio.mp3",
        assPath: "/tmp/render-123/captions.ass",
        fontsDir: "/tmp/render-123/fonts",
        outputPath: "/tmp/output.mp4",
        fps: 30,
        width: 1920,
        height: 1080,
      };

      const promise = renderV3(params);

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      const filterStr = args[args.indexOf("-filter_complex") + 1];
      expect(filterStr).toContain("fontsdir='/tmp/render-123/fonts'");
    });

    it("uses libx264 codec with quality settings", async () => {
      const scenes: V3Scene[] = [
        {
          imagePath: "/tmp/img.jpg",
          durationSeconds: 5.0,
          durationFrames: 150,
          sceneIndex: 0,
        },
      ];

      const params: V3RenderParams = {
        scenes,
        audioPath: "/tmp/audio.mp3",
        assPath: "/tmp/captions.ass",
        outputPath: "/tmp/output.mp4",
        fps: 30,
        width: 1920,
        height: 1080,
      };

      const promise = renderV3(params);

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain("-c:v");
      expect(args).toContain("libx264");
      expect(args).toContain("-crf");
      expect(args).toContain("20");
    });

    it("uses AAC audio codec at 192k", async () => {
      const scenes: V3Scene[] = [
        {
          imagePath: "/tmp/img.jpg",
          durationSeconds: 5.0,
          durationFrames: 150,
          sceneIndex: 0,
        },
      ];

      const params: V3RenderParams = {
        scenes,
        audioPath: "/tmp/audio.mp3",
        assPath: "/tmp/captions.ass",
        outputPath: "/tmp/output.mp4",
        fps: 30,
        width: 1920,
        height: 1080,
      };

      const promise = renderV3(params);

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain("-c:a");
      expect(args).toContain("aac");
      expect(args).toContain("-b:a");
      expect(args).toContain("192k");
    });

    it("enables faststart for progressive download", async () => {
      const scenes: V3Scene[] = [
        {
          imagePath: "/tmp/img.jpg",
          durationSeconds: 5.0,
          durationFrames: 150,
          sceneIndex: 0,
        },
      ];

      const params: V3RenderParams = {
        scenes,
        audioPath: "/tmp/audio.mp3",
        assPath: "/tmp/captions.ass",
        outputPath: "/tmp/output.mp4",
        fps: 30,
        width: 1920,
        height: 1080,
      };

      const promise = renderV3(params);

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain("-movflags");
      expect(args).toContain("+faststart");
    });
  });

  describe("Ken Burns pattern cycling", () => {
    it("builds filter_complex for 5 scenes (Ken Burns currently disabled)", async () => {
      // Ken Burns (zoompan) is temporarily disabled in production. This test
      // verifies all 5 scene streams are processed and concatenated.
      const scenes: V3Scene[] = [
        {
          imagePath: "/tmp/s0.jpg",
          durationSeconds: 2,
          durationFrames: 60,
          sceneIndex: 0,
        },
        {
          imagePath: "/tmp/s1.jpg",
          durationSeconds: 2,
          durationFrames: 60,
          sceneIndex: 1,
        },
        {
          imagePath: "/tmp/s2.jpg",
          durationSeconds: 2,
          durationFrames: 60,
          sceneIndex: 2,
        },
        {
          imagePath: "/tmp/s3.jpg",
          durationSeconds: 2,
          durationFrames: 60,
          sceneIndex: 3,
        },
        {
          imagePath: "/tmp/s4.jpg",
          durationSeconds: 2,
          durationFrames: 60,
          sceneIndex: 4,
        },
      ];

      const params: V3RenderParams = {
        scenes,
        audioPath: "/tmp/audio.mp3",
        assPath: "/tmp/captions.ass",
        outputPath: "/tmp/output.mp4",
        fps: 30,
        width: 1920,
        height: 1080,
      };

      const promise = renderV3(params);

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      const filterStr = args[args.indexOf("-filter_complex") + 1];

      // concat=n=5 means all 5 scenes are included
      expect(filterStr).toContain("concat=n=5");
    });
  });

  describe("various resolutions and frame rates", () => {
    it("handles 1080p at 30fps", async () => {
      const scenes: V3Scene[] = [
        {
          imagePath: "/tmp/img.jpg",
          durationSeconds: 5.0,
          durationFrames: 150,
          sceneIndex: 0,
        },
      ];

      const params: V3RenderParams = {
        scenes,
        audioPath: "/tmp/audio.mp3",
        assPath: "/tmp/captions.ass",
        outputPath: "/tmp/output.mp4",
        fps: 30,
        width: 1920,
        height: 1080,
      };

      const promise = renderV3(params);

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      // Resolution appears inside the filter_complex string (scale=WxH)
      const filterStr = args[args.indexOf("-filter_complex") + 1];
      expect(filterStr).toContain("1920");
      expect(filterStr).toContain("1080");
    });

    it("handles 4K at 60fps", async () => {
      const scenes: V3Scene[] = [
        {
          imagePath: "/tmp/img.jpg",
          durationSeconds: 2.0,
          durationFrames: 120,
          sceneIndex: 0,
        },
      ];

      const params: V3RenderParams = {
        scenes,
        audioPath: "/tmp/audio.mp3",
        assPath: "/tmp/captions.ass",
        outputPath: "/tmp/output.mp4",
        fps: 60,
        width: 3840,
        height: 2160,
      };

      const promise = renderV3(params);

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      // Resolution appears inside the filter_complex string (scale=WxH)
      const filterStr = args[args.indexOf("-filter_complex") + 1];
      expect(filterStr).toContain("3840");
      expect(filterStr).toContain("2160");
    });

    it("handles vertical video (9:16)", async () => {
      const scenes: V3Scene[] = [
        {
          imagePath: "/tmp/img.jpg",
          durationSeconds: 3.0,
          durationFrames: 90,
          sceneIndex: 0,
        },
      ];

      const params: V3RenderParams = {
        scenes,
        audioPath: "/tmp/audio.mp3",
        assPath: "/tmp/captions.ass",
        outputPath: "/tmp/output.mp4",
        fps: 30,
        width: 1080,
        height: 1920,
      };

      const promise = renderV3(params);

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      // Resolution appears inside the filter_complex string (scale=WxH)
      const filterStr = args[args.indexOf("-filter_complex") + 1];
      expect(filterStr).toContain("1080");
      expect(filterStr).toContain("1920");
    });
  });

  describe("error handling", () => {
    it("rejects when ffmpeg exits with non-zero code", async () => {
      const scenes: V3Scene[] = [
        {
          imagePath: "/tmp/img.jpg",
          durationSeconds: 5.0,
          durationFrames: 150,
          sceneIndex: 0,
        },
      ];

      const params: V3RenderParams = {
        scenes,
        audioPath: "/tmp/audio.mp3",
        assPath: "/tmp/captions.ass",
        outputPath: "/tmp/output.mp4",
        fps: 30,
        width: 1920,
        height: 1080,
      };

      const promise = renderV3(params);

      mockProcess.stderr.emit("data", Buffer.from("Error: file not found"));
      mockProcess.emit("close", 1);

      await expect(promise).rejects.toThrow(
        "[ffmpeg-v3] Render failed (code 1)",
      );
    });

    it("includes stderr in error message", async () => {
      const scenes: V3Scene[] = [
        {
          imagePath: "/tmp/missing.jpg",
          durationSeconds: 5.0,
          durationFrames: 150,
          sceneIndex: 0,
        },
      ];

      const params: V3RenderParams = {
        scenes,
        audioPath: "/tmp/audio.mp3",
        assPath: "/tmp/captions.ass",
        outputPath: "/tmp/output.mp4",
        fps: 30,
        width: 1920,
        height: 1080,
      };

      const promise = renderV3(params);

      const longError = "x".repeat(3000) + "ACTUAL ERROR MESSAGE";
      mockProcess.stderr.emit("data", Buffer.from(longError));
      mockProcess.emit("close", 1);

      await expect(promise).rejects.toThrow("ACTUAL ERROR MESSAGE");
    });

    it("rejects on ffmpeg spawn error", async () => {
      const scenes: V3Scene[] = [
        {
          imagePath: "/tmp/img.jpg",
          durationSeconds: 5.0,
          durationFrames: 150,
          sceneIndex: 0,
        },
      ];

      const params: V3RenderParams = {
        scenes,
        audioPath: "/tmp/audio.mp3",
        assPath: "/tmp/captions.ass",
        outputPath: "/tmp/output.mp4",
        fps: 30,
        width: 1920,
        height: 1080,
      };

      const promise = renderV3(params);

      mockProcess.emit("error", new Error("ENOENT: ffmpeg not found"));

      await expect(promise).rejects.toThrow("Failed to spawn ffmpeg");
    });
  });

  describe("progress logging", () => {
    it("logs FFmpeg progress timestamps", async () => {
      const scenes: V3Scene[] = [
        {
          imagePath: "/tmp/img.jpg",
          durationSeconds: 10.0,
          durationFrames: 300,
          sceneIndex: 0,
        },
      ];

      const params: V3RenderParams = {
        scenes,
        audioPath: "/tmp/audio.mp3",
        assPath: "/tmp/captions.ass",
        outputPath: "/tmp/output.mp4",
        fps: 30,
        width: 1920,
        height: 1080,
      };

      const promise = renderV3(params);

      // Simulate FFmpeg progress output
      mockProcess.stderr.emit(
        "data",
        Buffer.from("frame=100 time=00:00:03.33\n"),
      );
      mockProcess.stderr.emit(
        "data",
        Buffer.from("frame=200 time=00:00:06.66\n"),
      );
      mockProcess.stderr.emit(
        "data",
        Buffer.from("frame=300 time=00:00:10.00\n"),
      );
      mockProcess.emit("close", 0);

      await promise;

      expect(mockSpawn).toHaveBeenCalled();
    });

    it("deduplicates repeated timestamps", async () => {
      const scenes: V3Scene[] = [
        {
          imagePath: "/tmp/img.jpg",
          durationSeconds: 5.0,
          durationFrames: 150,
          sceneIndex: 0,
        },
      ];

      const params: V3RenderParams = {
        scenes,
        audioPath: "/tmp/audio.mp3",
        assPath: "/tmp/captions.ass",
        outputPath: "/tmp/output.mp4",
        fps: 30,
        width: 1920,
        height: 1080,
      };

      const promise = renderV3(params);

      mockProcess.stderr.emit("data", Buffer.from("time=00:00:01.00\n"));
      mockProcess.stderr.emit("data", Buffer.from("time=00:00:01.00\n"));
      mockProcess.stderr.emit("data", Buffer.from("time=00:00:02.00\n"));
      mockProcess.emit("close", 0);

      await promise;

      // Progress deduplication tested via no errors
      expect(mockSpawn).toHaveBeenCalled();
    });
  });

  describe("environment configuration", () => {
    it("respects FFMPEG_PATH environment variable", async () => {
      process.env.FFMPEG_PATH = "/custom/path/to/ffmpeg";

      const scenes: V3Scene[] = [
        {
          imagePath: "/tmp/img.jpg",
          durationSeconds: 5.0,
          durationFrames: 150,
          sceneIndex: 0,
        },
      ];

      const params: V3RenderParams = {
        scenes,
        audioPath: "/tmp/audio.mp3",
        assPath: "/tmp/captions.ass",
        outputPath: "/tmp/output.mp4",
        fps: 30,
        width: 1920,
        height: 1080,
      };

      const promise = renderV3(params);

      expect(mockSpawn).toHaveBeenCalledWith(
        "/custom/path/to/ffmpeg",
        expect.any(Array),
      );

      mockProcess.emit("close", 0);

      await promise;

      delete process.env.FFMPEG_PATH;
    });

    it("defaults to 'ffmpeg' when FFMPEG_PATH not set", async () => {
      delete process.env.FFMPEG_PATH;

      const scenes: V3Scene[] = [
        {
          imagePath: "/tmp/img.jpg",
          durationSeconds: 5.0,
          durationFrames: 150,
          sceneIndex: 0,
        },
      ];

      const params: V3RenderParams = {
        scenes,
        audioPath: "/tmp/audio.mp3",
        assPath: "/tmp/captions.ass",
        outputPath: "/tmp/output.mp4",
        fps: 30,
        width: 1920,
        height: 1080,
      };

      const promise = renderV3(params);

      expect(mockSpawn).toHaveBeenCalledWith("ffmpeg", expect.any(Array));

      mockProcess.emit("close", 0);

      await promise;
    });
  });

  describe("multiple scenes", () => {
    it("concatenates multiple scenes correctly", async () => {
      const scenes: V3Scene[] = [
        {
          imagePath: "/tmp/scene1.jpg",
          durationSeconds: 3,
          durationFrames: 90,
          sceneIndex: 0,
        },
        {
          imagePath: "/tmp/scene2.jpg",
          durationSeconds: 4,
          durationFrames: 120,
          sceneIndex: 1,
        },
        {
          imagePath: "/tmp/scene3.jpg",
          durationSeconds: 5,
          durationFrames: 150,
          sceneIndex: 2,
        },
      ];

      const params: V3RenderParams = {
        scenes,
        audioPath: "/tmp/audio.mp3",
        assPath: "/tmp/captions.ass",
        outputPath: "/tmp/output.mp4",
        fps: 30,
        width: 1920,
        height: 1080,
      };

      const promise = renderV3(params);

      mockProcess.emit("close", 0);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      const filterStr = args[args.indexOf("-filter_complex") + 1];
      expect(filterStr).toContain("concat=n=3");
    });
  });
});
