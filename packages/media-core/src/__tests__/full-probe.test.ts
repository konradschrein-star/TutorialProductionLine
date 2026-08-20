import { describe, it, expect } from "vitest";
import { parseProbeOutput } from "../ffmpeg/full-probe.js";
import type { MediaProbeResult } from "../ffmpeg/full-probe.js";

describe("parseProbeOutput", () => {
  it("extracts video metadata from ffprobe JSON (1920x1080 h264 → 16:9)", () => {
    const raw = {
      format: {
        duration: "125.500000",
        size: "52428800",
        format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      },
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          r_frame_rate: "30/1",
          display_aspect_ratio: "16:9",
        },
        {
          codec_type: "audio",
          codec_name: "aac",
          sample_rate: "44100",
          channels: 2,
        },
      ],
    };

    const result: MediaProbeResult = parseProbeOutput(raw);

    expect(result.durationSeconds).toBe(125.5);
    expect(result.sizeBytes).toBe(52428800);
    expect(result.formatName).toBe("mov,mp4,m4a,3gp,3g2,mj2");
    expect(result.video).toEqual({
      codec: "h264",
      width: 1920,
      height: 1080,
      fps: 30,
      aspectRatio: "16:9",
      pixelFormat: "unknown",
    });
    expect(result.audio).toEqual({
      codec: "aac",
      sampleRate: 44100,
      channels: 2,
    });
  });

  it("handles audio-only files (mp3, no video stream)", () => {
    const raw = {
      format: {
        duration: "243.120000",
        size: "3891200",
        format_name: "mp3",
      },
      streams: [
        {
          codec_type: "audio",
          codec_name: "mp3",
          sample_rate: "48000",
          channels: 1,
        },
      ],
    };

    const result = parseProbeOutput(raw);

    expect(result.durationSeconds).toBe(243.12);
    expect(result.sizeBytes).toBe(3891200);
    expect(result.formatName).toBe("mp3");
    expect(result.video).toBeUndefined();
    expect(result.audio).toEqual({
      codec: "mp3",
      sampleRate: 48000,
      channels: 1,
    });
  });

  it("computes aspect ratio for non-standard resolutions (1080x1920 → 9:16)", () => {
    const raw = {
      format: {
        duration: "60.000000",
        size: "10485760",
        format_name: "mp4",
      },
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1080,
          height: 1920,
          r_frame_rate: "60/1",
        },
      ],
    };

    const result = parseProbeOutput(raw);

    expect(result.video).toBeDefined();
    expect(result.video!.aspectRatio).toBe("9:16");
    expect(result.video!.width).toBe(1080);
    expect(result.video!.height).toBe(1920);
    expect(result.video!.fps).toBe(60);
  });

  it("handles 4:3 aspect ratio", () => {
    const raw = {
      format: { duration: "10", size: "1000", format_name: "avi" },
      streams: [
        {
          codec_type: "video",
          codec_name: "mpeg4",
          width: 640,
          height: 480,
          r_frame_rate: "25/1",
        },
      ],
    };

    const result = parseProbeOutput(raw);
    expect(result.video!.aspectRatio).toBe("4:3");
  });

  it("handles 1:1 aspect ratio", () => {
    const raw = {
      format: { duration: "10", size: "1000", format_name: "mp4" },
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1080,
          height: 1080,
          r_frame_rate: "30/1",
        },
      ],
    };

    const result = parseProbeOutput(raw);
    expect(result.video!.aspectRatio).toBe("1:1");
  });

  it("falls back to GCD simplification for uncommon ratios", () => {
    const raw = {
      format: { duration: "10", size: "1000", format_name: "mp4" },
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 700,
          height: 300,
          r_frame_rate: "24/1",
        },
      ],
    };

    const result = parseProbeOutput(raw);
    expect(result.video!.aspectRatio).toBe("7:3");
  });

  it("defaults fps to 30 when r_frame_rate is missing or invalid", () => {
    const raw = {
      format: { duration: "10", size: "1000", format_name: "mp4" },
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
        },
      ],
    };

    const result = parseProbeOutput(raw);
    expect(result.video!.fps).toBe(30);
  });

  it("parses fractional fps like 30000/1001", () => {
    const raw = {
      format: { duration: "10", size: "1000", format_name: "mp4" },
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          r_frame_rate: "30000/1001",
        },
      ],
    };

    const result = parseProbeOutput(raw);
    expect(result.video!.fps).toBeCloseTo(29.97, 1);
  });

  it("returns undefined video and audio when streams array is empty", () => {
    const raw = {
      format: { duration: "10", size: "1000", format_name: "mp4" },
      streams: [],
    };

    const result = parseProbeOutput(raw);
    expect(result.video).toBeUndefined();
    expect(result.audio).toBeUndefined();
  });

  it("defaults durationSeconds and sizeBytes to 0 when format fields are missing", () => {
    const raw = {
      format: {},
      streams: [],
    };

    const result = parseProbeOutput(raw);
    expect(result.durationSeconds).toBe(0);
    expect(result.sizeBytes).toBe(0);
  });

  it("parses fractional duration string '125.750' to 125.75", () => {
    const raw = {
      format: {
        duration: "125.750",
        size: "4096000",
        format_name: "mp4",
      },
      streams: [],
    };

    const result = parseProbeOutput(raw);
    expect(result.durationSeconds).toBe(125.75);
  });

  it("does not crash on '0/1' fps fraction and returns a sensible fps value", () => {
    const raw = {
      format: { duration: "10", size: "1000", format_name: "mp4" },
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          r_frame_rate: "0/1",
        },
      ],
    };

    // 0/1 = 0 fps; parseFps returns 0 (not NaN, not a crash)
    // The function does not special-case zero, so it returns 0 as a valid number
    expect(() => parseProbeOutput(raw)).not.toThrow();
    const result = parseProbeOutput(raw);
    expect(typeof result.video!.fps).toBe("number");
    expect(Number.isFinite(result.video!.fps)).toBe(true);
  });
});
