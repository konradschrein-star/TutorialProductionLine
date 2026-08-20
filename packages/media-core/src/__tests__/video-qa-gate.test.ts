import { describe, it, expect } from "vitest";
import {
  parseFreezeIntervals,
  parseBlackIntervals,
  parseVolumeDetect,
  parseIntegratedLufs,
  evaluateVideoQa,
  DEFAULT_VIDEO_QA_THRESHOLDS,
  SCREEN_RECORDING_QA_THRESHOLDS,
  type VideoQaMeasurements,
} from "../video-qa-gate.js";
import type { MediaProbeResult } from "../ffmpeg/full-probe.js";

/**
 * The gate's judgement is pure, so every threshold is pinned here against exact
 * numbers — including the real 2026-07-09 render (frozen 48s→298s, 84% of
 * runtime, -21.5 LUFS). CI needs no ffmpeg to run these.
 *
 * The shell-out half was demonstrated separately against real mp4s built with
 * ffmpeg: a 3s-motion + 12s-cloned-frame file failed the `frozen` check at 80%
 * of runtime, a pure-black file failed `black`, and an anullsrc file failed
 * `audio_silence`.
 */

const probe = (over: Partial<MediaProbeResult> = {}): MediaProbeResult =>
  ({
    durationSeconds: 300,
    sizeBytes: 10_000_000,
    formatName: "mov,mp4,m4a",
    video: {
      codec: "h264",
      width: 1920,
      height: 1080,
      fps: 30,
      aspectRatio: "16:9",
      pixelFormat: "yuv420p",
    },
    audio: { codec: "aac", sampleRate: 44100, channels: 2 },
    ...over,
  }) as MediaProbeResult;

const measurements = (
  over: Partial<VideoQaMeasurements> = {},
): VideoQaMeasurements => ({
  probe: probe(),
  frozen: [],
  black: [],
  meanVolumeDb: -20,
  maxVolumeDb: -3,
  integratedLufs: -14,
  ...over,
});

const check = (r: ReturnType<typeof evaluateVideoQa>, id: string) =>
  r.checks.find((c) => c.id === id)!;

describe("freezedetect parsing", () => {
  it("pairs a start with its end", () => {
    const out = `
[freezedetect @ 0x1] lavfi.freezedetect.freeze_start: 48.0
[freezedetect @ 0x1] lavfi.freezedetect.freeze_duration: 250.04
[freezedetect @ 0x1] lavfi.freezedetect.freeze_end: 298.04
`;
    const [iv] = parseFreezeIntervals(out, 298.04);
    expect(iv!.startSeconds).toBe(48);
    expect(iv!.endSeconds).toBe(298.04);
    expect(iv!.durationSeconds).toBeCloseTo(250.04, 6);
  });

  it("closes a freeze still running at EOF — the 2026-07-09 shape", () => {
    // The render ended while frozen, so ffmpeg never logs a freeze_end.
    // Discarding it would report a frozen video as clean.
    const out = `[freezedetect @ 0x1] lavfi.freezedetect.freeze_start: 48.0`;
    const [iv] = parseFreezeIntervals(out, 298.04);
    expect(iv!.startSeconds).toBe(48);
    expect(iv!.endSeconds).toBe(298.04);
    expect(iv!.durationSeconds).toBeCloseTo(250.04, 6);
  });

  it("returns nothing for a clean render", () => {
    expect(parseFreezeIntervals("frame= 100 fps=30", 60)).toEqual([]);
  });

  it("handles several freezes", () => {
    const out = `
freeze_start: 10
freeze_end: 13
freeze_start: 40
freeze_end: 46
`;
    expect(parseFreezeIntervals(out, 60)).toHaveLength(2);
  });
});

describe("blackdetect / volumedetect / ebur128 parsing", () => {
  it("parses black intervals", () => {
    const out = `[blackdetect @ 0x1] black_start:0 black_end:3.2 black_duration:3.2`;
    expect(parseBlackIntervals(out)).toEqual([
      { startSeconds: 0, endSeconds: 3.2, durationSeconds: 3.2 },
    ]);
  });

  it("parses volume, including negative peaks", () => {
    const out = `
[Parsed_volumedetect_0 @ 0x1] mean_volume: -23.5 dB
[Parsed_volumedetect_0 @ 0x1] max_volume: -0.5 dB
`;
    expect(parseVolumeDetect(out)).toEqual({
      meanVolumeDb: -23.5,
      maxVolumeDb: -0.5,
    });
  });

  it("reports null when volume was never measured", () => {
    expect(parseVolumeDetect("nothing here")).toEqual({
      meanVolumeDb: null,
      maxVolumeDb: null,
    });
  });

  it("parses the ebur128 summary block", () => {
    const out = `
[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:         -21.5 LUFS
    Threshold: -31.8 LUFS
`;
    expect(parseIntegratedLufs(out)).toBe(-21.5);
  });
});

describe("frozen check", () => {
  it("regression: fails the real 2026-07-09 render", () => {
    // 250s frozen out of 298s = 84% of runtime.
    const r = evaluateVideoQa(
      measurements({
        probe: probe({ durationSeconds: 298 }),
        frozen: [{ startSeconds: 48, endSeconds: 298, durationSeconds: 250 }],
      }),
    );
    expect(r.passed).toBe(false);
    expect(check(r, "frozen").status).toBe("fail");
    expect(check(r, "frozen").measured?.["frozen_fraction"]).toBeCloseTo(
      0.839,
      2,
    );
    expect(r.summary).toContain("frozen");
  });

  it("fails one long run even when the total fraction is small", () => {
    const r = evaluateVideoQa(
      measurements({
        frozen: [{ startSeconds: 10, endSeconds: 22, durationSeconds: 12 }],
      }),
    );
    expect(check(r, "frozen").status).toBe("fail");
  });

  it("fails many short freezes that add up past the fraction", () => {
    // 30 × 3s = 90s of 300s = 30%, no single run hits the 5s run limit.
    const frozen = Array.from({ length: 30 }, (_, i) => ({
      startSeconds: i * 10,
      endSeconds: i * 10 + 3,
      durationSeconds: 3,
    }));
    const r = evaluateVideoQa(measurements({ frozen }));
    expect(check(r, "frozen").status).toBe("fail");
  });

  it("passes a brief held frame", () => {
    const r = evaluateVideoQa(
      measurements({
        frozen: [{ startSeconds: 0, endSeconds: 2, durationSeconds: 2 }],
      }),
    );
    expect(check(r, "frozen").status).toBe("pass");
    expect(r.passed).toBe(true);
  });
});

describe("black check", () => {
  it("fails a sustained black run", () => {
    const r = evaluateVideoQa(
      measurements({
        black: [{ startSeconds: 100, endSeconds: 104, durationSeconds: 4 }],
      }),
    );
    expect(check(r, "black").status).toBe("fail");
  });

  it("fails a black opening even when it is short", () => {
    const r = evaluateVideoQa(
      measurements({
        black: [{ startSeconds: 0, endSeconds: 0.5, durationSeconds: 0.5 }],
      }),
    );
    expect(check(r, "black").status).toBe("fail");
    expect(check(r, "black").detail).toContain("first");
  });

  it("fails a black ending", () => {
    const r = evaluateVideoQa(
      measurements({
        black: [{ startSeconds: 299.5, endSeconds: 300, durationSeconds: 0.5 }],
      }),
    );
    expect(check(r, "black").status).toBe("fail");
    expect(check(r, "black").detail).toContain("last");
  });
});

describe("audio checks", () => {
  it("fails silent audio", () => {
    const r = evaluateVideoQa(measurements({ maxVolumeDb: -91 }));
    expect(check(r, "audio_silence").status).toBe("fail");
    expect(r.passed).toBe(false);
  });

  it("fails when audio exists but was never measured", () => {
    // Never claim an unmeasured track is fine — that is the silent fallback
    // this whole gate exists to prevent.
    const r = evaluateVideoQa(
      measurements({ maxVolumeDb: null, meanVolumeDb: null }),
    );
    expect(check(r, "audio_silence").status).toBe("fail");
  });

  it("fails a missing audio stream when narration is expected", () => {
    const r = evaluateVideoQa(
      measurements({ probe: probe({ audio: undefined }) }),
    );
    expect(check(r, "streams").status).toBe("fail");
  });

  it("allows a silent format to opt out", () => {
    const r = evaluateVideoQa(
      measurements({ probe: probe({ audio: undefined }) }),
      { requireAudio: false },
    );
    expect(check(r, "streams").status).toBe("pass");
    expect(check(r, "audio_silence").status).toBe("skipped");
    expect(r.passed).toBe(true);
  });

  it("WARNS but does not block on off-target loudness", () => {
    // The one real ranking render measured -21.5 LUFS, 7.5 LU under target.
    const r = evaluateVideoQa(measurements({ integratedLufs: -21.5 }));
    expect(check(r, "loudness").status).toBe("warn");
    expect(r.passed).toBe(true);
    expect(r.warnings).toHaveLength(1);
  });

  it("passes loudness within tolerance", () => {
    const r = evaluateVideoQa(measurements({ integratedLufs: -16 }));
    expect(check(r, "loudness").status).toBe("pass");
  });
});

describe("duration and geometry", () => {
  it("fails a large duration mismatch — how a freeze shows up in metadata", () => {
    const r = evaluateVideoQa(
      measurements({ probe: probe({ durationSeconds: 298 }) }),
      {
        durationSeconds: 48,
      },
    );
    expect(check(r, "duration").status).toBe("fail");
  });

  it("tolerates small drift", () => {
    const r = evaluateVideoQa(measurements(), { durationSeconds: 295 });
    expect(check(r, "duration").status).toBe("pass");
  });

  it("skips duration when no expectation is given", () => {
    expect(check(evaluateVideoQa(measurements()), "duration").status).toBe(
      "skipped",
    );
  });

  it("fails a resolution that does not match the render config", () => {
    const r = evaluateVideoQa(measurements(), { width: 1280, height: 720 });
    expect(check(r, "dimensions").status).toBe("fail");
  });

  it("accepts 29.97 against an expected 30 fps", () => {
    const r = evaluateVideoQa(
      measurements({
        probe: probe({
          video: { ...probe().video!, fps: 29.97 },
        }),
      }),
      { fps: 30 },
    );
    expect(check(r, "dimensions").status).toBe("pass");
  });
});

describe("overall verdict", () => {
  it("passes a healthy render", () => {
    const r = evaluateVideoQa(measurements(), {
      durationSeconds: 300,
      width: 1920,
      height: 1080,
      fps: 30,
    });
    expect(r.passed).toBe(true);
    expect(r.failures).toHaveLength(0);
    expect(r.summary).toBe("QA passed.");
  });

  it("warnings alone never block delivery", () => {
    const r = evaluateVideoQa(measurements({ integratedLufs: -25 }));
    expect(r.passed).toBe(true);
    expect(r.summary).toContain("warning");
  });

  it("collects every failure, not just the first", () => {
    const r = evaluateVideoQa(
      measurements({
        probe: probe({ durationSeconds: 100 }),
        frozen: [{ startSeconds: 0, endSeconds: 100, durationSeconds: 100 }],
        black: [{ startSeconds: 0, endSeconds: 100, durationSeconds: 100 }],
        maxVolumeDb: -95,
      }),
    );
    expect(r.passed).toBe(false);
    expect(r.failures.map((f) => f.id).sort()).toEqual([
      "audio_silence",
      "black",
      "frozen",
    ]);
  });

  it("thresholds are overridable per caller", () => {
    const lenient = { ...DEFAULT_VIDEO_QA_THRESHOLDS, maxFrozenRunSeconds: 60 };
    const frozen = [{ startSeconds: 0, endSeconds: 12, durationSeconds: 12 }];
    expect(evaluateVideoQa(measurements({ frozen }), {}, lenient).passed).toBe(
      true,
    );
    expect(evaluateVideoQa(measurements({ frozen })).passed).toBe(false);
  });
});

/**
 * Screen recordings (TUTORIAL) are legitimately mostly static — the narrator
 * explains a settings page while that page sits on screen. Measured on real
 * production tutorials: 87–98% of runtime reads as frozen on videos that are
 * perfectly fine. The motion-graphics defaults would have blocked essentially
 * every tutorial from Drive: the gate causing the outage it exists to prevent.
 */
describe("screen-recording thresholds", () => {
  it("does not fail a legitimately static screen recording", () => {
    const r = evaluateVideoQa(
      measurements({
        probe: probe({ durationSeconds: 190 }),
        // 98% frozen — a real, publishable tutorial.
        frozen: [{ startSeconds: 2, endSeconds: 188, durationSeconds: 186 }],
      }),
      { durationSeconds: 190 },
      SCREEN_RECORDING_QA_THRESHOLDS,
    );
    expect(check(r, "frozen").status).toBe("pass");
    expect(r.passed).toBe(true);
  });

  it("STILL catches the real tutorial defect: duration ~2x the recording", () => {
    // The three production tutorials the gate caught: 375s of video from a
    // 190s recording.
    const r = evaluateVideoQa(
      measurements({ probe: probe({ durationSeconds: 375.4 }) }),
      { durationSeconds: 190.3 },
      SCREEN_RECORDING_QA_THRESHOLDS,
    );
    expect(check(r, "duration").status).toBe("fail");
    expect(r.passed).toBe(false);
  });

  it("still fails a black screen and silent audio", () => {
    const r = evaluateVideoQa(
      measurements({
        probe: probe({ durationSeconds: 100 }),
        black: [{ startSeconds: 0, endSeconds: 100, durationSeconds: 100 }],
        maxVolumeDb: -95,
      }),
      {},
      SCREEN_RECORDING_QA_THRESHOLDS,
    );
    expect(check(r, "black").status).toBe("fail");
    expect(check(r, "audio_silence").status).toBe("fail");
  });

  it("motion-graphics defaults are unchanged by the preset", () => {
    expect(DEFAULT_VIDEO_QA_THRESHOLDS.maxFrozenRunSeconds).toBe(5);
    expect(DEFAULT_VIDEO_QA_THRESHOLDS.maxFrozenFraction).toBe(0.2);
  });
});
