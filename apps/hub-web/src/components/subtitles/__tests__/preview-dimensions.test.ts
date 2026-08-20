import { describe, it, expect } from "vitest";
import {
  aspectToDimensions,
  planDurationInFrames,
  loopDurationInFrames,
  shiftPlanToStart,
} from "../preview-dimensions";
import type { CaptionPlan } from "@repo/media-core/subtitles/remotion";

describe("aspectToDimensions", () => {
  it("maps 9:16 to portrait", () => {
    expect(aspectToDimensions("9:16")).toEqual({ width: 1080, height: 1920 });
  });
  it("maps 16:9 to landscape", () => {
    expect(aspectToDimensions("16:9")).toEqual({ width: 1920, height: 1080 });
  });
  it("maps 1:1 to square", () => {
    expect(aspectToDimensions("1:1")).toEqual({ width: 1080, height: 1080 });
  });
});

describe("planDurationInFrames", () => {
  it("returns >= 1 for an empty plan", () => {
    expect(planDurationInFrames([], 30)).toBeGreaterThanOrEqual(1);
  });

  it("derives frames from the last chunk end + a tail", () => {
    const plan = [
      { words: [], lines: [], start: 0, end: 2 },
    ] as unknown as CaptionPlan;
    // (2 + 0.5) * 30 = 75
    expect(planDurationInFrames(plan, 30)).toBe(75);
  });

  it("rounds up partial frames", () => {
    const plan = [
      { words: [], lines: [], start: 0, end: 1.01 },
    ] as unknown as CaptionPlan;
    // ceil((1.01 + 0.5) * 30) = ceil(45.3) = 46
    expect(planDurationInFrames(plan, 30)).toBe(46);
  });
});

describe("loopDurationInFrames", () => {
  it("has NO tail — loop length is exactly the caption span", () => {
    const plan = [
      { words: [], lines: [], start: 0, end: 2 },
    ] as unknown as CaptionPlan;
    // 2 * 30 = 60 (planDurationInFrames would be 75 with the tail)
    expect(loopDurationInFrames(plan, 30)).toBe(60);
    expect(loopDurationInFrames(plan, 30)).toBeLessThan(
      planDurationInFrames(plan, 30),
    );
  });

  it("throws on an empty plan (a blank card is a defect, not a 1-frame loop)", () => {
    expect(() => loopDurationInFrames([], 30)).toThrow(/empty caption plan/);
  });
});

describe("shiftPlanToStart", () => {
  it("moves the first chunk to t=0 and shifts everything by the same delta", () => {
    const plan = [
      {
        start: 0.2,
        end: 1.2,
        words: [{ word: "a", raw: "a", start: 0.2, end: 1.2, role: "normal" }],
        lines: [
          [{ word: "a", raw: "a", start: 0.2, end: 1.2, role: "normal" }],
        ],
      },
      {
        start: 1.3,
        end: 2.3,
        words: [{ word: "b", raw: "b", start: 1.3, end: 2.3, role: "normal" }],
        lines: [
          [{ word: "b", raw: "b", start: 1.3, end: 2.3, role: "normal" }],
        ],
      },
    ] as unknown as CaptionPlan;
    const shifted = shiftPlanToStart(plan);
    expect(shifted[0].start).toBeCloseTo(0);
    expect(shifted[0].end).toBeCloseTo(1);
    expect(shifted[1].start).toBeCloseTo(1.1);
    expect(shifted[0].words[0].start).toBeCloseTo(0);
    expect(shifted[0].lines[0][0].start).toBeCloseTo(0);
    // Original is untouched.
    expect(plan[0].start).toBe(0.2);
  });

  it("is a no-op when the first chunk already starts at 0", () => {
    const plan = [
      { words: [], lines: [], start: 0, end: 1 },
    ] as unknown as CaptionPlan;
    expect(shiftPlanToStart(plan)).toBe(plan);
  });
});
