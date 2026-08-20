import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateClip, QUALITY_THRESHOLDS } from "../footage-quality-gate.js";

// Mock ffprobe spawn
const mockSpawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: mockSpawn }));

function mockFfprobeOutput(json: object) {
  mockSpawn.mockImplementationOnce(() => {
    const child = {
      stdout: {
        on: (event: string, cb: (chunk: Buffer) => void) => {
          if (event === "data") cb(Buffer.from(JSON.stringify(json)));
        },
      },
      stderr: { on: vi.fn() },
      on: (event: string, cb: (code: number) => void) => {
        if (event === "close") setTimeout(() => cb(0), 0);
      },
    };
    return child;
  });
}

describe("evaluateClip", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("accepts a 1080p, 10s, dynamic clip", async () => {
    mockFfprobeOutput({
      streams: [
        {
          codec_type: "video",
          width: 1920,
          height: 1080,
          duration: "10.0",
          nb_frames: "300",
          avg_frame_rate: "30/1",
        },
      ],
      format: { duration: "10.0" },
    });
    const result = await evaluateClip("/tmp/fake.mp4");
    expect(result.accepted).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("rejects a 480p clip", async () => {
    mockFfprobeOutput({
      streams: [
        {
          codec_type: "video",
          width: 854,
          height: 480,
          duration: "10.0",
          nb_frames: "300",
          avg_frame_rate: "30/1",
        },
      ],
      format: { duration: "10.0" },
    });
    const result = await evaluateClip("/tmp/fake.mp4");
    expect(result.accepted).toBe(false);
    expect(result.reasons.some((r) => r.includes("resolution"))).toBe(true);
  });

  it("rejects a 1s clip", async () => {
    mockFfprobeOutput({
      streams: [
        {
          codec_type: "video",
          width: 1920,
          height: 1080,
          duration: "1.0",
          nb_frames: "30",
          avg_frame_rate: "30/1",
        },
      ],
      format: { duration: "1.0" },
    });
    const result = await evaluateClip("/tmp/fake.mp4");
    expect(result.accepted).toBe(false);
    expect(result.reasons.some((r) => r.includes("duration"))).toBe(true);
  });

  it("exposes QUALITY_THRESHOLDS for callers that want to render a UI", () => {
    expect(QUALITY_THRESHOLDS.minWidth).toBe(1280);
    expect(QUALITY_THRESHOLDS.minDurationSeconds).toBe(5);
  });
});
