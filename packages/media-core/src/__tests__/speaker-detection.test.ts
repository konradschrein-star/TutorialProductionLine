/**
 * Tests for speaker detection service
 *
 * Covers:
 * - Success cases (single party, multiple transitions)
 * - Edge cases (empty video, no text, low confidence)
 * - Error cases (missing file, FFmpeg/OCR failures)
 * - Validation (invalid parameters)
 * - Timeline logic (gap filling, merging)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectSpeakers } from "../speaker-detection";

// Mock dependencies
vi.mock("tesseract.js", () => ({
  default: {
    recognize: vi.fn(),
  },
}));

vi.mock("fluent-ffmpeg", () => {
  const mockFfmpeg = vi.fn();
  mockFfmpeg.prototype.videoFilters = vi.fn().mockReturnThis();
  mockFfmpeg.prototype.outputOptions = vi.fn().mockReturnThis();
  mockFfmpeg.prototype.output = vi.fn().mockReturnThis();
  mockFfmpeg.prototype.on = vi.fn().mockReturnThis();
  mockFfmpeg.prototype.run = vi.fn();

  const ffmpegConstructor = vi.fn((input: string) => {
    const instance = Object.create(mockFfmpeg.prototype);
    instance.input = input;
    return instance;
  });

  ffmpegConstructor.setFfmpegPath = vi.fn();

  return { default: ffmpegConstructor };
});

vi.mock("@ffmpeg-installer/ffmpeg", () => ({
  default: { path: "/usr/bin/ffmpeg" },
}));

vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn().mockResolvedValue("/tmp/speaker-detection-12345"),
  readdir: vi.fn().mockResolvedValue([]),
  rm: vi.fn().mockResolvedValue(undefined),
}));

import Tesseract from "tesseract.js";
import ffmpeg from "fluent-ffmpeg";
import { mkdtemp, readdir, rm } from "node:fs/promises";

describe("detectSpeakers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Success Cases", () => {
    it("should detect single party throughout video", async () => {
      // Mock FFmpeg extraction
      const ffmpegInstance = ffmpeg("/test/video.mp4") as any;
      vi.mocked(ffmpegInstance.run).mockImplementation(() => {
        const onEnd = vi
          .mocked(ffmpegInstance.on)
          .mock.calls.find((call) => call[0] === "end")?.[1];
        if (onEnd) setTimeout(() => onEnd(), 0);
      });

      // Mock extracted frames
      vi.mocked(readdir).mockResolvedValue([
        "frame_0001.jpg",
        "frame_0002.jpg",
        "frame_0003.jpg",
      ] as any);

      // Mock OCR results (all SPD)
      vi.mocked(Tesseract.recognize).mockResolvedValue({
        data: {
          text: "SPD Fraktion im Bundestag",
          confidence: 85,
        },
      } as any);

      const result = await detectSpeakers({
        videoFilePath: "/test/video.mp4",
        frameIntervalSeconds: 5,
      });

      expect(result.speaker_timeline).toHaveLength(1);
      expect(result.speaker_timeline[0]).toMatchObject({
        start_time: 0,
        end_time: 15,
        party: "SPD",
        speaker: "Unknown",
      });
      expect(result.speaker_timeline[0].confidence).toBeGreaterThan(0.5);

      // Verify cleanup
      expect(rm).toHaveBeenCalledWith("/tmp/speaker-detection-12345", {
        recursive: true,
        force: true,
      });
    });

    it("should detect multiple party transitions", async () => {
      // Mock FFmpeg extraction
      const ffmpegInstance = ffmpeg("/test/video.mp4") as any;
      vi.mocked(ffmpegInstance.run).mockImplementation(() => {
        const onEnd = vi
          .mocked(ffmpegInstance.on)
          .mock.calls.find((call) => call[0] === "end")?.[1];
        if (onEnd) setTimeout(() => onEnd(), 0);
      });

      // Mock extracted frames
      vi.mocked(readdir).mockResolvedValue([
        "frame_0001.jpg",
        "frame_0002.jpg",
        "frame_0003.jpg",
        "frame_0004.jpg",
        "frame_0005.jpg",
        "frame_0006.jpg",
      ] as any);

      // Mock OCR results (SPD → CDU → GRUENE)
      let callCount = 0;
      vi.mocked(Tesseract.recognize).mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.resolve({
            data: { text: "SPD", confidence: 90 },
          } as any);
        } else if (callCount <= 4) {
          return Promise.resolve({
            data: { text: "CDU", confidence: 85 },
          } as any);
        } else {
          return Promise.resolve({
            data: { text: "Bündnis 90 Die Grünen", confidence: 80 },
          } as any);
        }
      });

      const result = await detectSpeakers({
        videoFilePath: "/test/video.mp4",
        frameIntervalSeconds: 5,
      });

      expect(result.speaker_timeline).toHaveLength(3);
      expect(result.speaker_timeline[0].party).toBe("SPD");
      expect(result.speaker_timeline[1].party).toBe("CDU");
      expect(result.speaker_timeline[2].party).toBe("GRUENE");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty video with no frames", async () => {
      // Mock FFmpeg extraction with no frames
      const ffmpegInstance = ffmpeg("/test/empty.mp4") as any;
      vi.mocked(ffmpegInstance.run).mockImplementation(() => {
        const onEnd = vi
          .mocked(ffmpegInstance.on)
          .mock.calls.find((call) => call[0] === "end")?.[1];
        if (onEnd) setTimeout(() => onEnd(), 0);
      });

      vi.mocked(readdir).mockResolvedValue([]);

      const result = await detectSpeakers({
        videoFilePath: "/test/empty.mp4",
      });

      expect(result.speaker_timeline).toEqual([]);
    });

    it("should handle frames with no text detected", async () => {
      // Mock FFmpeg extraction
      const ffmpegInstance = ffmpeg("/test/video.mp4") as any;
      vi.mocked(ffmpegInstance.run).mockImplementation(() => {
        const onEnd = vi
          .mocked(ffmpegInstance.on)
          .mock.calls.find((call) => call[0] === "end")?.[1];
        if (onEnd) setTimeout(() => onEnd(), 0);
      });

      vi.mocked(readdir).mockResolvedValue([
        "frame_0001.jpg",
        "frame_0002.jpg",
      ] as any);

      // Mock OCR with no text
      vi.mocked(Tesseract.recognize).mockResolvedValue({
        data: { text: "", confidence: 0 },
      } as any);

      const result = await detectSpeakers({
        videoFilePath: "/test/video.mp4",
      });

      expect(result.speaker_timeline).toHaveLength(1);
      expect(result.speaker_timeline[0].party).toBe("UNKNOWN");
    });

    it("should handle low confidence detections", async () => {
      // Mock FFmpeg extraction
      const ffmpegInstance = ffmpeg("/test/video.mp4") as any;
      vi.mocked(ffmpegInstance.run).mockImplementation(() => {
        const onEnd = vi
          .mocked(ffmpegInstance.on)
          .mock.calls.find((call) => call[0] === "end")?.[1];
        if (onEnd) setTimeout(() => onEnd(), 0);
      });

      vi.mocked(readdir).mockResolvedValue([
        "frame_0001.jpg",
        "frame_0002.jpg",
      ] as any);

      // Production confidence formula: combinedConfidence = (patternConfidence + ocrConfidence) / 2
      // patternConfidence for SPD match (len ≥ 3) = 0.9
      // To get combinedConfidence < 0.5 we need ocrConfidence < 0.1
      // confidence=5 → 5/100=0.05, combined=(0.9+0.05)/2=0.475 < 0.5 → UNKNOWN
      vi.mocked(Tesseract.recognize).mockResolvedValue({
        data: { text: "SPD", confidence: 5 },
      } as any);

      const result = await detectSpeakers({
        videoFilePath: "/test/video.mp4",
      });

      // Low combined confidence should result in UNKNOWN
      expect(result.speaker_timeline[0].party).toBe("UNKNOWN");
    });

    it("should merge adjacent same-party segments", async () => {
      // Mock FFmpeg extraction
      const ffmpegInstance = ffmpeg("/test/video.mp4") as any;
      vi.mocked(ffmpegInstance.run).mockImplementation(() => {
        const onEnd = vi
          .mocked(ffmpegInstance.on)
          .mock.calls.find((call) => call[0] === "end")?.[1];
        if (onEnd) setTimeout(() => onEnd(), 0);
      });

      vi.mocked(readdir).mockResolvedValue([
        "frame_0001.jpg",
        "frame_0002.jpg",
        "frame_0003.jpg",
        "frame_0004.jpg",
      ] as any);

      // Mock OCR: all SPD — should produce one merged segment
      vi.mocked(Tesseract.recognize).mockResolvedValue({
        data: { text: "SPD", confidence: 90 },
      } as any);

      const result = await detectSpeakers({
        videoFilePath: "/test/video.mp4",
        frameIntervalSeconds: 5,
      });

      // All SPD frames should be merged into a single segment
      expect(result.speaker_timeline).toHaveLength(1);
      expect(result.speaker_timeline[0].party).toBe("SPD");
      expect(result.speaker_timeline[0].start_time).toBe(0);
      expect(result.speaker_timeline[0].end_time).toBe(20);
    });
  });

  describe("Error Cases", () => {
    it("should throw error for missing video file", async () => {
      // Mock FFmpeg extraction failure
      const ffmpegInstance = ffmpeg("/test/missing.mp4") as any;
      vi.mocked(ffmpegInstance.run).mockImplementation(() => {
        const onError = vi
          .mocked(ffmpegInstance.on)
          .mock.calls.find((call) => call[0] === "error")?.[1];
        if (onError)
          setTimeout(() => onError(new Error("ENOENT: no such file")), 0);
      });

      await expect(
        detectSpeakers({ videoFilePath: "/test/missing.mp4" }),
      ).rejects.toThrow("Frame extraction failed");
    });

    it("should throw error for FFmpeg extraction failure", async () => {
      // Mock FFmpeg failure
      const ffmpegInstance = ffmpeg("/test/corrupt.mp4") as any;
      vi.mocked(ffmpegInstance.run).mockImplementation(() => {
        const onError = vi
          .mocked(ffmpegInstance.on)
          .mock.calls.find((call) => call[0] === "error")?.[1];
        if (onError) setTimeout(() => onError(new Error("Invalid codec")), 0);
      });

      await expect(
        detectSpeakers({ videoFilePath: "/test/corrupt.mp4" }),
      ).rejects.toThrow("Frame extraction failed");
    });

    it("should handle OCR processing failure gracefully", async () => {
      // Mock FFmpeg extraction
      const ffmpegInstance = ffmpeg("/test/video.mp4") as any;
      vi.mocked(ffmpegInstance.run).mockImplementation(() => {
        const onEnd = vi
          .mocked(ffmpegInstance.on)
          .mock.calls.find((call) => call[0] === "end")?.[1];
        if (onEnd) setTimeout(() => onEnd(), 0);
      });

      vi.mocked(readdir).mockResolvedValue([
        "frame_0001.jpg",
        "frame_0002.jpg",
      ] as any);

      // Mock OCR failure
      vi.mocked(Tesseract.recognize).mockRejectedValue(
        new Error("Tesseract initialization failed"),
      );

      const result = await detectSpeakers({
        videoFilePath: "/test/video.mp4",
      });

      // Should return UNKNOWN for failed OCR frames
      expect(result.speaker_timeline[0].party).toBe("UNKNOWN");
    });
  });

  describe("Validation", () => {
    it("should throw error for empty video file path", async () => {
      await expect(detectSpeakers({ videoFilePath: "" })).rejects.toThrow(
        "Video file path is required",
      );
    });

    it("should throw error for invalid frame interval (zero)", async () => {
      await expect(
        detectSpeakers({
          videoFilePath: "/test/video.mp4",
          frameIntervalSeconds: 0,
        }),
      ).rejects.toThrow("Frame interval must be positive");
    });

    it("should throw error for invalid frame interval (negative)", async () => {
      await expect(
        detectSpeakers({
          videoFilePath: "/test/video.mp4",
          frameIntervalSeconds: -5,
        }),
      ).rejects.toThrow("Frame interval must be positive");
    });
  });

  describe("Integration Tests", () => {
    it.skip("should process real Bundestag video (integration test placeholder)", async () => {
      // TODO: Add integration test with real video file
      // This test requires:
      // 1. Test fixture video with known party text
      // 2. FFmpeg and Tesseract installed
      // 3. Expected timeline for validation

      const result = await detectSpeakers({
        videoFilePath: "/path/to/test/bundestag-clip.mp4",
        frameIntervalSeconds: 5,
      });

      expect(result.speaker_timeline.length).toBeGreaterThan(0);
      // Verify party detections match expected timeline
    });
  });
});
