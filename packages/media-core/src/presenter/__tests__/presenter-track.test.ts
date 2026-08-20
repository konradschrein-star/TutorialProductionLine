import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CalibratedPose } from "@repo/contracts";
import {
  buildConcatListText,
  buildHeadScaleSteps,
  buildHeadStepArgs,
  buildPresenterTrack,
  buildPresenterTrackArgs,
  headStepFileName,
  quantiseEnvelopeToSteps,
  DEFAULT_HEAD_SCALE_RANGE,
  DEFAULT_HEAD_SCALE_STEPS,
} from "../presenter-track.js";
import { resolvePresenterLayout } from "../pose-normalise.js";
import type { PresenterPlacement } from "../pose-normalise.js";

function calibratedPose(): CalibratedPose {
  return {
    source: "Test_source.jpeg",
    source_size: [2752, 1536],
    crop: [0, 0, 1000, 1500],
    coverage: 0.25,
    soft_edge_px: 1000,
    head_anchor: null,
    slug: "test-pose",
    file: "test-pose.png",
    size: [1000, 1500],
    anchor_status: "calibrated",
    hitboxes: {
      head: { center: { x: 0.5, y: 0.1 }, radius: 0.08 },
      collar: { width: 0.2 },
      pointOrigin: { x: 0.8, y: 0.5 },
      pointDirection: { x: 1, y: 0 },
      safeRegion: { x: 0, y: 0, w: 0.4, h: 1 },
      crop: { x: 0, y: 0, w: 1, h: 1 },
    },
  };
}

const PLACEMENT: PresenterPlacement = {
  side: "left",
  targetCollarPx: 200,
  bottomAnchor: 1,
  sideInset: 0.05,
};

function layoutFixture() {
  return resolvePresenterLayout({
    pose: calibratedPose(),
    placement: PLACEMENT,
    frameWidth: 1920,
    frameHeight: 1080,
  });
}

describe("buildHeadScaleSteps", () => {
  it("defaults match the design's 1.00-1.08 pump", () => {
    expect(DEFAULT_HEAD_SCALE_RANGE).toEqual({ min: 1.0, max: 1.08 });
    expect(DEFAULT_HEAD_SCALE_STEPS).toBe(33);
  });

  it("spans min..max inclusive with even spacing", () => {
    const steps = buildHeadScaleSteps({ min: 1, max: 1.08 }, 5);
    expect(steps).toHaveLength(5);
    expect(steps[0]).toBeCloseTo(1, 10);
    expect(steps[4]).toBeCloseTo(1.08, 10);
    expect(steps[2]).toBeCloseTo(1.04, 10);
  });

  it("keeps each default step under half a percent — sub-pixel on a 170px head", () => {
    const steps = buildHeadScaleSteps(
      DEFAULT_HEAD_SCALE_RANGE,
      DEFAULT_HEAD_SCALE_STEPS,
    );
    const delta = steps[1]! - steps[0]!;
    expect(delta).toBeLessThan(0.005);
    expect(delta * 170).toBeLessThan(1);
  });

  it("throws on fewer than 2 steps", () => {
    expect(() => buildHeadScaleSteps({ min: 1, max: 1.08 }, 1)).toThrow(
      /integer >= 2/,
    );
  });

  it("throws when max < min", () => {
    expect(() => buildHeadScaleSteps({ min: 1.2, max: 1 }, 5)).toThrow(
      />= min/,
    );
  });

  it("throws on a non-positive min", () => {
    expect(() => buildHeadScaleSteps({ min: 0, max: 1 }, 5)).toThrow(
      /min must be finite/,
    );
  });
});

describe("quantiseEnvelopeToSteps", () => {
  it("maps 0 to the first step and 1 to the last", () => {
    expect(quantiseEnvelopeToSteps([0, 0.5, 1], 5)).toEqual([0, 2, 4]);
  });

  it("preserves length", () => {
    const env = new Array<number>(120).fill(0.3);
    expect(quantiseEnvelopeToSteps(env, 33)).toHaveLength(120);
  });

  it("is monotonic in the envelope", () => {
    const steps = quantiseEnvelopeToSteps([0, 0.1, 0.2, 0.9, 1], 33);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!).toBeGreaterThanOrEqual(steps[i - 1]!);
    }
  });

  it("throws on an empty envelope", () => {
    expect(() => quantiseEnvelopeToSteps([], 33)).toThrow(/envelope is empty/);
  });

  it("throws on an un-normalised value instead of clamping it", () => {
    expect(() => quantiseEnvelopeToSteps([0.2, 1.4], 33)).toThrow(
      /expected a finite number in 0\.\.1/,
    );
    expect(() => quantiseEnvelopeToSteps([-0.1], 33)).toThrow(
      /expected a finite number in 0\.\.1/,
    );
    expect(() => quantiseEnvelopeToSteps([Number.NaN], 33)).toThrow(
      /expected a finite number in 0\.\.1/,
    );
  });
});

describe("headStepFileName", () => {
  it("zero-pads to three digits", () => {
    expect(headStepFileName(0)).toBe("head-step-000.png");
    expect(headStepFileName(32)).toBe("head-step-032.png");
  });

  it("throws on a negative index", () => {
    expect(() => headStepFileName(-1)).toThrow(/non-negative integer/);
  });
});

describe("buildHeadStepArgs", () => {
  it("scales then pads onto the constant canvas, centred and lifted", () => {
    const args = buildHeadStepArgs({
      headMasterPngPath: "/w/head-master.png",
      canvasPx: 200,
      diameterPx: 160,
      liftPx: 4,
      outputPath: "/w/head-step-003.png",
    });
    const vf = args[args.indexOf("-vf") + 1];
    // (200-160)/2 = 20 across, 20 - 4 = 16 down.
    expect(vf).toBe(
      "format=rgba,scale=160:160:flags=lanczos,pad=200:200:20:16:color=black@0",
    );
    expect(args).toContain("/w/head-master.png");
    expect(args[args.length - 1]).toBe("/w/head-step-003.png");
    expect(args).toContain("-frames:v");
  });

  it("throws rather than clipping the mark when it does not fit the canvas", () => {
    expect(() =>
      buildHeadStepArgs({
        headMasterPngPath: "/w/m.png",
        canvasPx: 100,
        diameterPx: 120,
        liftPx: 0,
        outputPath: "/w/o.png",
      }),
    ).toThrow(/does not fit/);
  });

  it("throws when the lift pushes the mark off the top of the canvas", () => {
    expect(() =>
      buildHeadStepArgs({
        headMasterPngPath: "/w/m.png",
        canvasPx: 200,
        diameterPx: 160,
        liftPx: 40,
        outputPath: "/w/o.png",
      }),
    ).toThrow(/does not fit/);
  });

  it("throws on a negative lift", () => {
    expect(() =>
      buildHeadStepArgs({
        headMasterPngPath: "/w/m.png",
        canvasPx: 200,
        diameterPx: 100,
        liftPx: -1,
        outputPath: "/w/o.png",
      }),
    ).toThrow(/liftPx must be finite and >= 0/);
  });
});

describe("buildConcatListText", () => {
  const stepFileNames = [
    "head-step-000.png",
    "head-step-001.png",
    "head-step-002.png",
  ];

  it("emits one entry per frame plus the trailing repeat the demuxer needs", () => {
    const text = buildConcatListText({
      stepFileNames,
      stepIndexPerFrame: [0, 2, 1],
      fps: 30,
    });
    expect(text.split("\n").filter((l) => l.startsWith("file "))).toEqual([
      "file 'head-step-000.png'",
      "file 'head-step-002.png'",
      "file 'head-step-001.png'",
      "file 'head-step-001.png'",
    ]);
  });

  it("starts with the ffconcat header and uses 1/fps durations", () => {
    const text = buildConcatListText({
      stepFileNames,
      stepIndexPerFrame: [0],
      fps: 30,
    });
    expect(text.startsWith("ffconcat version 1.0\n")).toBe(true);
    expect(text).toContain("duration 0.033333333");
  });

  it("writes durations for a fractional frame rate", () => {
    const text = buildConcatListText({
      stepFileNames,
      stepIndexPerFrame: [0],
      fps: 30000 / 1001,
    });
    expect(text).toContain("duration 0.033366667");
  });

  it("emits basenames only, so the list is drive-letter and space safe", () => {
    const text = buildConcatListText({
      stepFileNames,
      stepIndexPerFrame: [0],
      fps: 30,
    });
    expect(text).not.toContain(":");
    expect(text).not.toContain("\\");
  });

  it("throws when a frame references a step that was never generated", () => {
    expect(() =>
      buildConcatListText({
        stepFileNames,
        stepIndexPerFrame: [0, 9],
        fps: 30,
      }),
    ).toThrow(/references head step 9/);
  });

  it("throws on an empty frame list", () => {
    expect(() =>
      buildConcatListText({ stepFileNames, stepIndexPerFrame: [], fps: 30 }),
    ).toThrow(/nothing to render/);
  });

  it("throws on a non-positive fps", () => {
    expect(() =>
      buildConcatListText({ stepFileNames, stepIndexPerFrame: [0], fps: 0 }),
    ).toThrow(/fps must be finite/);
  });
});

describe("buildPresenterTrackArgs", () => {
  const base = {
    suitPngPath: "/w/pose.png",
    concatListPath: "/w/head-frames.ffconcat",
    outputPath: "/w/presenter.webm",
    fps: 30,
    width: 1920,
    height: 1080,
    frameCount: 300,
    headCanvasPx: 200,
    crf: 32,
    cpuUsed: 5,
  };

  it("emits VP9 alpha with alt-ref disabled (alt-ref silently drops the alpha plane)", () => {
    const args = buildPresenterTrackArgs({ ...base, layout: layoutFixture() });
    expect(args).toContain("libvpx-vp9");
    expect(args).toContain("yuva420p");
    const altRefIndex = args.indexOf("-auto-alt-ref");
    expect(altRefIndex).toBeGreaterThan(-1);
    expect(args[altRefIndex + 1]).toBe("0");
  });

  it("caps the output at exactly one frame per envelope value", () => {
    const args = buildPresenterTrackArgs({ ...base, layout: layoutFixture() });
    expect(args[args.indexOf("-frames:v") + 1]).toBe("300");
  });

  it("forces the base layer fully transparent rather than trusting color=black@0", () => {
    const fc = buildPresenterTrackArgs({ ...base, layout: layoutFixture() })[
      buildPresenterTrackArgs({ ...base, layout: layoutFixture() }).indexOf(
        "-filter_complex",
      ) + 1
    ];
    expect(fc).toContain("[0:v]format=rgba,colorchannelmixer=aa=0[bg]");
  });

  it("centres the head canvas on the head hitbox", () => {
    const layout = layoutFixture();
    const args = buildPresenterTrackArgs({ ...base, layout });
    const fc = args[args.indexOf("-filter_complex") + 1]!;
    const expectedX = Math.round(layout.head.centreXPx - base.headCanvasPx / 2);
    const expectedY = Math.round(layout.head.centreYPx - base.headCanvasPx / 2);
    expect(fc).toContain(
      `[body][head]overlay=${expectedX}:${expectedY}:format=auto[v]`,
    );
  });

  it("adds hflip only when the layout is mirrored", () => {
    const plain = buildPresenterTrackArgs({ ...base, layout: layoutFixture() });
    const plainFc = plain[plain.indexOf("-filter_complex") + 1]!;
    expect(plainFc).not.toContain("hflip");

    const mirroredLayout = resolvePresenterLayout({
      pose: calibratedPose(),
      placement: { ...PLACEMENT, mirror: true },
      frameWidth: 1920,
      frameHeight: 1080,
    });
    const mirrored = buildPresenterTrackArgs({
      ...base,
      layout: mirroredLayout,
    });
    const mirroredFc = mirrored[mirrored.indexOf("-filter_complex") + 1]!;
    expect(mirroredFc).toContain("scale=1000:1500:flags=lanczos,hflip[suit]");
  });

  it("resamples the concat head stream to the output fps", () => {
    const args = buildPresenterTrackArgs({ ...base, layout: layoutFixture() });
    const fc = args[args.indexOf("-filter_complex") + 1]!;
    expect(fc).toContain("[2:v]fps=30,format=rgba[head]");
  });

  it("throws on odd output dimensions (yuva420p chroma)", () => {
    expect(() =>
      buildPresenterTrackArgs({
        ...base,
        width: 1921,
        layout: layoutFixture(),
      }),
    ).toThrow(/width must be an even integer/);
    expect(() =>
      buildPresenterTrackArgs({
        ...base,
        height: 1081,
        layout: layoutFixture(),
      }),
    ).toThrow(/height must be an even integer/);
  });

  it("throws on a zero frame count", () => {
    expect(() =>
      buildPresenterTrackArgs({
        ...base,
        frameCount: 0,
        layout: layoutFixture(),
      }),
    ).toThrow(/frameCount must be an integer >= 1/);
  });
});

describe("buildPresenterTrack (fail-closed entry point)", () => {
  const commonParams = {
    posePngPath: join(tmpdir(), "no-such-pose.png"),
    headMark: {
      kind: "png" as const,
      path: join(tmpdir(), "no-such-head.png"),
    },
    envelope: [0, 0.5, 1],
    fps: 30,
    width: 1920,
    height: 1080,
    placement: PLACEMENT,
    workDir: join(tmpdir(), "presenter-track-test-unused"),
    outputPath: join(tmpdir(), "presenter-track-test-unused", "out.webm"),
  };

  it("throws for an uncalibrated pose before touching ffmpeg or the disk", async () => {
    await expect(
      buildPresenterTrack({
        ...commonParams,
        pose: {
          source: "x.jpeg",
          source_size: [2752, 1536],
          crop: [0, 0, 1000, 1500],
          coverage: 0.25,
          soft_edge_px: 10,
          head_anchor: null,
          slug: "pointing-down-left",
          file: "pointing-down-left.png",
          size: [1000, 1500],
          anchor_status: "needs-calibration",
        },
      }),
    ).rejects.toThrow(/pose "pointing-down-left" is not calibrated/);
  });

  it("throws when the pose PNG is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "presenter-track-"));
    try {
      await expect(
        buildPresenterTrack({
          ...commonParams,
          pose: calibratedPose(),
          workDir: dir,
          outputPath: join(dir, "out.webm"),
        }),
      ).rejects.toThrow(/pose PNG for "test-pose" not found/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws on an un-normalised envelope", async () => {
    await expect(
      buildPresenterTrack({
        ...commonParams,
        pose: calibratedPose(),
        envelope: [0, 3],
      }),
    ).rejects.toThrow(/expected a finite number in 0\.\.1/);
  });

  it("throws on a negative head lift", async () => {
    await expect(
      buildPresenterTrack({
        ...commonParams,
        pose: calibratedPose(),
        headLiftPx: -5,
      }),
    ).rejects.toThrow(/headLiftPx must be finite and >= 0/);
  });
});
