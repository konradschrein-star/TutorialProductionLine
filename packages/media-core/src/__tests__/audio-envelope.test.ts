import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildPcmDecodeArgs,
  computeRmsEnvelope,
  computeRmsFrames,
  normaliseEnvelope,
  percentileOf,
  smoothEnvelope,
  DEFAULT_ENVELOPE_PERCENTILE,
  DEFAULT_SMOOTHING_TAPS,
} from "../audio-envelope.js";

/** Build a mono s16le buffer from float samples in -1..1. */
function pcmFrom(samples: number[]): Buffer {
  const buf = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32768))), i * 2);
  });
  return buf;
}

/** A constant-amplitude block of `n` samples. */
function block(amplitude: number, n: number): number[] {
  return new Array<number>(n).fill(amplitude);
}

describe("buildPcmDecodeArgs", () => {
  it("decodes to mono s16le at the requested rate on stdout", () => {
    const args = buildPcmDecodeArgs({ audioPath: "/x/tts.mp3", sampleRate: 16000 });
    expect(args).toEqual([
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "error",
      "-i",
      "/x/tts.mp3",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "s16le",
      "-acodec",
      "pcm_s16le",
      "-",
    ]);
  });

  it("throws on a blank path", () => {
    expect(() => buildPcmDecodeArgs({ audioPath: "  ", sampleRate: 16000 })).toThrow(
      /audioPath is empty/,
    );
  });

  it("throws on a non-integer sample rate", () => {
    expect(() =>
      buildPcmDecodeArgs({ audioPath: "/x.mp3", sampleRate: 16000.5 }),
    ).toThrow(/positive integer/);
  });
});

describe("computeRmsFrames", () => {
  it("computes constant-amplitude RMS exactly", () => {
    // 0.5 full-scale DC for 4 frames at 100Hz / 25fps => 4 samples per frame.
    const pcm = pcmFrom(block(0.5, 16));
    const rms = computeRmsFrames({ pcm, sampleRate: 100, fps: 25 });
    expect(rms).toHaveLength(4);
    for (const v of rms) expect(v).toBeCloseTo(0.5, 4);
  });

  it("tracks amplitude changing between frames", () => {
    const pcm = pcmFrom([...block(0.1, 4), ...block(0.8, 4)]);
    const rms = computeRmsFrames({ pcm, sampleRate: 100, fps: 25 });
    expect(rms).toHaveLength(2);
    expect(rms[0]).toBeCloseTo(0.1, 4);
    expect(rms[1]).toBeCloseTo(0.8, 4);
  });

  it("drops a trailing partial frame rather than reporting it quiet", () => {
    const pcm = pcmFrom(block(0.5, 10)); // 2 whole frames + 2 samples
    expect(computeRmsFrames({ pcm, sampleRate: 100, fps: 25 })).toHaveLength(2);
  });

  it("handles a fractional samples-per-frame ratio without drifting", () => {
    // 16000Hz / 29.97fps = 533.86... samples per frame.
    const sampleRate = 16000;
    const fps = 30000 / 1001;
    const pcm = pcmFrom(block(0.25, sampleRate)); // exactly one second
    const rms = computeRmsFrames({ pcm, sampleRate, fps });
    expect(rms).toHaveLength(29);
    for (const v of rms) expect(v).toBeCloseTo(0.25, 4);
  });

  it("throws on zero samples instead of returning an empty envelope", () => {
    expect(() =>
      computeRmsFrames({ pcm: Buffer.alloc(0), sampleRate: 100, fps: 25 }),
    ).toThrow(/decoded 0 bytes/);
  });

  it("throws on a truncated (odd-length) PCM buffer", () => {
    expect(() =>
      computeRmsFrames({ pcm: Buffer.alloc(9), sampleRate: 100, fps: 25 }),
    ).toThrow(/not a whole number of 16-bit samples/);
  });

  it("throws when the audio is shorter than one frame", () => {
    expect(() =>
      computeRmsFrames({ pcm: pcmFrom(block(0.5, 3)), sampleRate: 100, fps: 25 }),
    ).toThrow(/less than one frame/);
  });

  it("throws on a non-positive fps", () => {
    expect(() =>
      computeRmsFrames({ pcm: pcmFrom(block(0.5, 8)), sampleRate: 100, fps: 0 }),
    ).toThrow(/fps must be finite/);
  });
});

describe("smoothEnvelope", () => {
  it("defaults to 3 taps", () => {
    expect(DEFAULT_SMOOTHING_TAPS).toBe(3);
  });

  it("removes a single-frame dropout (the Reactor flicker case)", () => {
    const raw = [0.5, 0.5, 0, 0.5, 0.5];
    const smoothed = smoothEnvelope(raw, 3);
    // The dropout is lifted; its neighbours are pulled down but not to zero.
    expect(smoothed[2]).toBeCloseTo(1 / 3, 6);
    expect(smoothed[1]).toBeCloseTo(1 / 3, 6);
    expect(smoothed[2]!).toBeGreaterThan(raw[2]!);
  });

  it("shrinks the window at the edges instead of zero-padding", () => {
    // Zero-padding would give (0 + 1 + 1) / 3 = 0.667 at index 0.
    const smoothed = smoothEnvelope([1, 1, 1], 3);
    expect(smoothed[0]).toBeCloseTo(1, 10);
    expect(smoothed[2]).toBeCloseTo(1, 10);
  });

  it("is symmetric: a symmetric input smooths to a symmetric output", () => {
    const smoothed = smoothEnvelope([0, 1, 4, 1, 0], 3);
    expect(smoothed[0]).toBeCloseTo(smoothed[4]!, 10);
    expect(smoothed[1]).toBeCloseTo(smoothed[3]!, 10);
  });

  it("preserves length", () => {
    expect(smoothEnvelope([1, 2, 3, 4, 5, 6, 7], 5)).toHaveLength(7);
  });

  it("is the identity at 1 tap", () => {
    expect(smoothEnvelope([0.1, 0.9, 0.3], 1)).toEqual([0.1, 0.9, 0.3]);
  });

  it("throws on an even tap count", () => {
    expect(() => smoothEnvelope([1, 2, 3], 2)).toThrow(/odd positive integer/);
  });

  it("throws on zero or negative taps", () => {
    expect(() => smoothEnvelope([1, 2, 3], 0)).toThrow(/odd positive integer/);
    expect(() => smoothEnvelope([1, 2, 3], -3)).toThrow(/odd positive integer/);
  });

  it("throws on an empty envelope", () => {
    expect(() => smoothEnvelope([], 3)).toThrow(/empty envelope/);
  });

  it("throws on a non-finite value", () => {
    expect(() => smoothEnvelope([1, Number.NaN, 3], 3)).toThrow(/not a finite number/);
  });
});

describe("percentileOf", () => {
  it("uses nearest rank", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentileOf(values, 1)).toBe(10);
    expect(percentileOf(values, 0.5)).toBe(5);
    expect(percentileOf(values, 0.95)).toBe(10);
    expect(percentileOf(values, 0.1)).toBe(1);
  });

  it("ignores input order", () => {
    expect(percentileOf([9, 1, 5, 3, 7], 0.6)).toBe(5);
  });

  it("throws on an empty series", () => {
    expect(() => percentileOf([], 0.95)).toThrow(/empty series/);
  });

  it("throws on a percentile outside (0, 1]", () => {
    expect(() => percentileOf([1, 2], 0)).toThrow(/must be in \(0, 1\]/);
    expect(() => percentileOf([1, 2], 1.5)).toThrow(/must be in \(0, 1\]/);
    expect(() => percentileOf([1, 2], 95)).toThrow(/must be in \(0, 1\]/);
  });
});

describe("normaliseEnvelope", () => {
  it("defaults to p95", () => {
    expect(DEFAULT_ENVELOPE_PERCENTILE).toBe(0.95);
  });

  it("a single transient does not flatten the curve", () => {
    // 99 frames of ordinary speech plus one clipped frame 20x louder.
    const raw = [...block(0.1, 99), 2.0];
    const byMax = normaliseEnvelope(raw, 1);
    const byP95 = normaliseEnvelope(raw, 0.95);

    // Normalising by the max squashes speech to 5% of range...
    expect(byMax.values[0]).toBeCloseTo(0.05, 6);
    // ...while p95 keeps it at full range.
    expect(byP95.values[0]).toBeCloseTo(1, 6);
    expect(byP95.reference).toBeCloseTo(0.1, 6);
  });

  it("clamps values above the reference to 1", () => {
    const { values } = normaliseEnvelope([...block(0.1, 99), 2.0], 0.95);
    expect(values[99]).toBe(1);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
  });

  it("throws on a silent series rather than dividing by zero", () => {
    expect(() => normaliseEnvelope(block(0, 30), 0.95)).toThrow(/audio is silent/);
  });

  it("throws when the percentile lands on zero in mostly-silent audio", () => {
    // 95% silence, 5% speech: p95 is still 0.
    expect(() => normaliseEnvelope([...block(0, 96), ...block(0.4, 4)], 0.95)).toThrow(
      /audio is silent/,
    );
  });
});

describe("computeRmsEnvelope", () => {
  it("throws with an actionable message when the audio file is missing", async () => {
    await expect(
      computeRmsEnvelope({
        audioPath: join(tmpdir(), "definitely-not-here-1a2b3c.mp3"),
        fps: 30,
      }),
    ).rejects.toThrow(/narration audio not found/);
  });

  it("throws on a non-positive fps before touching the filesystem", async () => {
    await expect(
      computeRmsEnvelope({ audioPath: "/whatever.mp3", fps: 0 }),
    ).rejects.toThrow(/fps must be finite/);
  });

  it("throws when the file exists but is 0 bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "envelope-test-"));
    try {
      const empty = join(dir, "empty.mp3");
      await writeFile(empty, "");
      await expect(computeRmsEnvelope({ audioPath: empty, fps: 30 })).rejects.toThrow(
        /is 0 bytes/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws when the decoder returns no samples", async () => {
    const dir = await mkdtemp(join(tmpdir(), "envelope-test-"));
    try {
      const audio = join(dir, "audio.mp3");
      await writeFile(audio, "not really an mp3, but non-empty");
      await expect(
        computeRmsEnvelope({
          audioPath: audio,
          fps: 30,
          decodePcm: async () => Buffer.alloc(0),
        }),
      ).rejects.toThrow(/decoded 0 bytes/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("produces one normalised value per frame, smoothed then normalised", async () => {
    const dir = await mkdtemp(join(tmpdir(), "envelope-test-"));
    try {
      const audio = join(dir, "audio.wav");
      await writeFile(audio, "placeholder — the decoder is injected");

      // 6 frames at 100Hz / 25fps (4 samples each): quiet, loud, dropout, loud, quiet, quiet
      const pcm = pcmFrom([
        ...block(0.05, 4),
        ...block(0.8, 4),
        ...block(0.0, 4),
        ...block(0.8, 4),
        ...block(0.05, 4),
        ...block(0.05, 4),
      ]);

      const env = await computeRmsEnvelope({
        audioPath: audio,
        fps: 25,
        sampleRate: 100,
        decodePcm: async () => pcm,
      });

      expect(env.frameCount).toBe(6);
      expect(env.values).toHaveLength(6);
      expect(env.fps).toBe(25);
      expect(env.sampleRate).toBe(100);
      expect(env.percentile).toBe(0.95);
      expect(env.smoothingTaps).toBe(3);
      expect(env.smoothedRms).toHaveLength(6);
      for (const v of env.values) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      // The single-frame dropout is smoothed away, so it is not the minimum.
      expect(env.values[2]!).toBeGreaterThan(env.values[5]!);
      // The peak of the smoothed curve normalises to 1.
      expect(Math.max(...env.values)).toBeCloseTo(1, 6);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("honours a custom percentile and tap count", async () => {
    const dir = await mkdtemp(join(tmpdir(), "envelope-test-"));
    try {
      const audio = join(dir, "audio.wav");
      await writeFile(audio, "placeholder");
      const pcm = pcmFrom(block(0.4, 40)); // 10 frames at 100Hz / 25fps
      const env = await computeRmsEnvelope({
        audioPath: audio,
        fps: 25,
        sampleRate: 100,
        percentile: 0.5,
        smoothingTaps: 5,
        decodePcm: async () => pcm,
      });
      expect(env.percentile).toBe(0.5);
      expect(env.smoothingTaps).toBe(5);
      expect(env.reference).toBeCloseTo(0.4, 4);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
