import { describe, it, expect } from "vitest";
import {
  generateCompositionPlan,
  computeHookDurationSeconds,
} from "../scene-composition.js";
import type { SceneInput } from "../scene-composition.js";

/** Helper to create N scenes evenly distributed across a duration */
function makeScenes(
  count: number,
  totalDurationSeconds: number,
  fps: number,
): SceneInput[] {
  const totalFrames = Math.round(totalDurationSeconds * fps);
  const framesPerScene = Math.floor(totalFrames / count);
  return Array.from({ length: count }, (_, i) => ({
    scene_index: i,
    paragraph: `Scene ${i} paragraph text.`,
    start_frame: i * framesPerScene,
    end_frame: Math.min((i + 1) * framesPerScene, totalFrames),
    duration_frames:
      i === count - 1 ? totalFrames - i * framesPerScene : framesPerScene,
  }));
}

/** Helper with a quote in one scene */
function makeScenesWithQuote(count: number, quoteIndex: number): SceneInput[] {
  const scenes = makeScenes(count, 120, 30);
  scenes[quoteIndex]!.paragraph =
    `He said "This is a very important quote that should be displayed" loudly.`;
  return scenes;
}

describe("computeHookDurationSeconds", () => {
  it("returns 20-40s for videos under 3 minutes", () => {
    // Under 180s: scales linearly from 20s to 40s
    expect(computeHookDurationSeconds(60)).toBeGreaterThanOrEqual(20);
    expect(computeHookDurationSeconds(60)).toBeLessThanOrEqual(40);
    expect(computeHookDurationSeconds(179)).toBeLessThanOrEqual(40);
  });

  it("returns 40-75s for videos 3-10 minutes", () => {
    // At exactly 3 min boundary: 40s
    expect(computeHookDurationSeconds(180)).toBe(40);
    // At just under 10 min (599s): 75s — note the range is < 600, so 600 itself returns 90
    expect(computeHookDurationSeconds(599)).toBe(75);
    // Scales between 40-75 for mid-range
    expect(computeHookDurationSeconds(390)).toBeGreaterThanOrEqual(40);
    expect(computeHookDurationSeconds(390)).toBeLessThanOrEqual(75);
  });

  it("returns 90s for videos over 10 minutes", () => {
    expect(computeHookDurationSeconds(601)).toBe(90);
    expect(computeHookDurationSeconds(3600)).toBe(90);
  });
});

describe("generateCompositionPlan", () => {
  it("throws a deprecation error (migrated to generateSentenceCompositionPlan)", () => {
    expect(() => generateCompositionPlan({} as any)).toThrow(/deprecated/i);
  });
});
