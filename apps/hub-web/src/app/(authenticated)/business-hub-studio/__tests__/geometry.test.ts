import { describe, it, expect } from "vitest";

import {
  HITBOX_NAMES,
  applyHitboxPatch,
  clamp01,
  clampRect,
  directionAngleDeg,
  displayToNorm,
  draftFromHitboxes,
  draftToHitboxes,
  emptyDraft,
  envelopeIndexAt,
  fitContain,
  headScaleForEnvelopeValue,
  missingHitboxes,
  normToDisplay,
  poseScaleForCollar,
  rectFromCorners,
  unitDirectionFromPixelDelta,
  HEAD_SCALE_RANGE,
  HEAD_SCALE_STEPS,
} from "../_lib/geometry";
import { seedHitbox, clearHitbox } from "../_lib/seeds";

/**
 * Real pose sizes from `media/style-assets/presenter/poses/poses.json`
 * (read 2026-08-15) — the two extremes of the ~6x framing swing this whole
 * mechanism exists to cancel.
 */
const FULL_BODY_STANDING = { w: 424, h: 1088 };
const HANDS_IN_POCKETS = { w: 2752, h: 1442 };

describe("clamp01", () => {
  it("clamps outside 0..1 and passes through inside", () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(1.4)).toBe(1);
    expect(clamp01(0.42)).toBe(0.42);
  });

  it("throws on a non-finite value rather than producing NaN coordinates", () => {
    expect(() => clamp01(Number.NaN)).toThrow(/finite/);
  });
});

describe("fitContain", () => {
  it("letterboxes a tall image inside a wide box", () => {
    const box = fitContain({ w: 424, h: 1088 }, { w: 800, h: 544 });
    expect(box.h).toBeCloseTo(544, 6);
    expect(box.w).toBeCloseTo(424 * (544 / 1088), 6);
    expect(box.y).toBeCloseTo(0, 6);
    expect(box.x).toBeCloseTo((800 - box.w) / 2, 6);
  });

  it("pillarboxes a wide image inside a tall box", () => {
    const box = fitContain({ w: 2752, h: 1442 }, { w: 688, h: 800 });
    expect(box.w).toBeCloseTo(688, 6);
    expect(box.h).toBeCloseTo(1442 * (688 / 2752), 6);
  });

  it("throws on a zero-sized container", () => {
    expect(() => fitContain({ w: 10, h: 10 }, { w: 0, h: 100 })).toThrow(
      /container.w/,
    );
  });
});

describe("normToDisplay / displayToNorm", () => {
  it("round-trips a point through a letterboxed box", () => {
    const box = fitContain(FULL_BODY_STANDING, { w: 900, h: 500 });
    const point = { x: 0.37, y: 0.82 };
    const back = displayToNorm(normToDisplay(point, box), box);
    expect(back.x).toBeCloseTo(point.x, 10);
    expect(back.y).toBeCloseTo(point.y, 10);
  });

  it("clamps a drag that leaves the image", () => {
    const box = { x: 100, y: 50, w: 200, h: 400 };
    expect(displayToNorm({ x: -500, y: -500 }, box)).toEqual({ x: 0, y: 0 });
    expect(displayToNorm({ x: 5000, y: 5000 }, box)).toEqual({ x: 1, y: 1 });
  });
});

describe("clampRect", () => {
  it("pulls a rect back inside the image without changing its size", () => {
    const clamped = clampRect({ x: 0.8, y: 0.9, w: 0.5, h: 0.3 });
    expect(clamped.w).toBeCloseTo(0.5, 10);
    expect(clamped.x + clamped.w).toBeLessThanOrEqual(1 + 1e-12);
    expect(clamped.y + clamped.h).toBeLessThanOrEqual(1 + 1e-12);
  });

  it("enforces a minimum size, since NormRectSchema requires w > 0", () => {
    const clamped = clampRect({ x: 0.5, y: 0.5, w: 0, h: 0 });
    expect(clamped.w).toBeGreaterThan(0);
    expect(clamped.h).toBeGreaterThan(0);
  });
});

describe("rectFromCorners", () => {
  it("normalises corner order", () => {
    const a = rectFromCorners({ x: 0.7, y: 0.8 }, { x: 0.2, y: 0.1 });
    expect(a.x).toBeCloseTo(0.2, 10);
    expect(a.y).toBeCloseTo(0.1, 10);
    expect(a.w).toBeCloseTo(0.5, 10);
    expect(a.h).toBeCloseTo(0.7, 10);
  });
});

describe("unitDirectionFromPixelDelta", () => {
  it("returns a unit vector", () => {
    const v = unitDirectionFromPixelDelta(30, 40);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 12);
    expect(v.x).toBeCloseTo(0.6, 12);
    expect(v.y).toBeCloseTo(0.8, 12);
  });

  it("stays inside the -1..1 the contract allows, for any delta", () => {
    for (const [dx, dy] of [
      [1, 0],
      [-9999, 4],
      [0.0001, -0.0002],
      [-3, -3],
    ] as const) {
      const v = unitDirectionFromPixelDelta(dx, dy);
      expect(v.x).toBeGreaterThanOrEqual(-1);
      expect(v.x).toBeLessThanOrEqual(1);
      expect(v.y).toBeGreaterThanOrEqual(-1);
      expect(v.y).toBeLessThanOrEqual(1);
    }
  });

  it("refuses a zero-length drag instead of defaulting to a heading", () => {
    expect(() => unitDirectionFromPixelDelta(0, 0)).toThrow(/zero length/);
  });
});

describe("directionAngleDeg", () => {
  it("measures clockwise from +x in screen space", () => {
    expect(directionAngleDeg({ x: 1, y: 0 })).toBeCloseTo(0, 10);
    expect(directionAngleDeg({ x: 0, y: 1 })).toBeCloseTo(90, 10);
    expect(directionAngleDeg({ x: 0, y: -1 })).toBeCloseTo(-90, 10);
  });
});

describe("poseScaleForCollar", () => {
  it("makes the collar subtend the target width exactly", () => {
    const collarWidthNorm = 0.22;
    const targetCollarPx = 150;
    const result = poseScaleForCollar({
      poseWidthPx: HANDS_IN_POCKETS.w,
      poseHeightPx: HANDS_IN_POCKETS.h,
      collarWidthNorm,
      targetCollarPx,
    });
    const renderedCollarPx = collarWidthNorm * result.widthPx;
    expect(renderedCollarPx).toBeCloseTo(targetCollarPx, 8);
  });

  it("cancels the 6x framing swing between the two extreme poses", () => {
    // Same physical collar (~150px of the real shoulders) expressed as a
    // fraction of each very differently sized crop.
    const targetCollarPx = 150;
    const small = poseScaleForCollar({
      poseWidthPx: FULL_BODY_STANDING.w,
      poseHeightPx: FULL_BODY_STANDING.h,
      collarWidthNorm: 150 / FULL_BODY_STANDING.w,
      targetCollarPx,
    });
    const large = poseScaleForCollar({
      poseWidthPx: HANDS_IN_POCKETS.w,
      poseHeightPx: HANDS_IN_POCKETS.h,
      collarWidthNorm: 150 / HANDS_IN_POCKETS.w,
      targetCollarPx,
    });
    // Both are scaled to a collar of exactly 150 output px, so their apparent
    // sizes agree even though the source crops differ ~6x in width.
    expect(150 * (small.widthPx / FULL_BODY_STANDING.w)).toBeCloseTo(150, 8);
    expect(150 * (large.widthPx / HANDS_IN_POCKETS.w)).toBeCloseTo(150, 8);
    expect(small.scale).toBeCloseTo(1, 10);
    expect(large.scale).toBeCloseTo(1, 10);
  });

  it("preserves the pose aspect ratio", () => {
    const result = poseScaleForCollar({
      poseWidthPx: FULL_BODY_STANDING.w,
      poseHeightPx: FULL_BODY_STANDING.h,
      collarWidthNorm: 0.3,
      targetCollarPx: 120,
    });
    expect(result.widthPx / result.heightPx).toBeCloseTo(
      FULL_BODY_STANDING.w / FULL_BODY_STANDING.h,
      10,
    );
  });

  it("rejects a collar width given in pixels rather than as a fraction", () => {
    expect(() =>
      poseScaleForCollar({
        poseWidthPx: 2752,
        poseHeightPx: 1442,
        collarWidthNorm: 420,
        targetCollarPx: 150,
      }),
    ).toThrow(/0\.\.1 fraction/);
  });

  it("rejects a degenerate scale rather than returning a 2x2 figure", () => {
    expect(() =>
      poseScaleForCollar({
        poseWidthPx: 2752,
        poseHeightPx: 1442,
        collarWidthNorm: 1,
        targetCollarPx: 1,
      }),
    ).toThrow(/not renderable/);
  });
});

describe("headScaleForEnvelopeValue", () => {
  it("maps silence and peak to the ends of the design's range", () => {
    expect(headScaleForEnvelopeValue(0)).toBeCloseTo(HEAD_SCALE_RANGE.min, 12);
    expect(headScaleForEnvelopeValue(1)).toBeCloseTo(HEAD_SCALE_RANGE.max, 12);
  });

  it("quantises to the same step grid the renderer rasterises", () => {
    const seen = new Set<number>();
    for (let i = 0; i <= 1000; i++)
      seen.add(headScaleForEnvelopeValue(i / 1000));
    expect(seen.size).toBe(HEAD_SCALE_STEPS);
  });

  it("is monotonic in the envelope value", () => {
    let previous = -Infinity;
    for (let i = 0; i <= 200; i++) {
      const scale = headScaleForEnvelopeValue(i / 200);
      expect(scale).toBeGreaterThanOrEqual(previous);
      previous = scale;
    }
  });

  it("throws on a value outside 0..1 instead of clamping", () => {
    expect(() => headScaleForEnvelopeValue(1.2)).toThrow(/0\.\.1/);
    expect(() => headScaleForEnvelopeValue(Number.NaN)).toThrow(/0\.\.1/);
  });
});

describe("envelopeIndexAt", () => {
  it("maps playback time to a frame index", () => {
    expect(envelopeIndexAt(0, 30, 900)).toBe(0);
    expect(envelopeIndexAt(1, 30, 900)).toBe(30);
    expect(envelopeIndexAt(2.5, 30, 900)).toBe(75);
  });

  it("clamps past the end rather than reading out of range", () => {
    expect(envelopeIndexAt(1000, 30, 900)).toBe(899);
  });

  it("returns null for an empty envelope instead of pretending to animate", () => {
    expect(envelopeIndexAt(1, 30, 0)).toBeNull();
  });

  it("throws on a non-positive fps", () => {
    expect(() => envelopeIndexAt(1, 0, 10)).toThrow(/fps/);
  });
});

describe("draft lifecycle", () => {
  it("reports every hitbox as missing on an empty draft", () => {
    expect(missingHitboxes(emptyDraft())).toEqual([...HITBOX_NAMES]);
    expect(draftToHitboxes(emptyDraft())).toBeNull();
  });

  it("refuses to produce a hitbox set while any member is unauthored", () => {
    let draft = emptyDraft();
    for (const name of HITBOX_NAMES.slice(0, 5))
      draft = seedHitbox(draft, name);
    expect(draftToHitboxes(draft)).toBeNull();
    draft = seedHitbox(draft, "crop");
    expect(draftToHitboxes(draft)).not.toBeNull();
  });

  it("round-trips a complete hitbox set", () => {
    let draft = emptyDraft();
    for (const name of HITBOX_NAMES) draft = seedHitbox(draft, name);
    const hitboxes = draftToHitboxes(draft);
    expect(hitboxes).not.toBeNull();
    if (!hitboxes) throw new Error("unreachable");
    expect(draftToHitboxes(draftFromHitboxes(hitboxes))).toEqual(hitboxes);
  });

  it("clearing a hitbox makes the pose incomplete again", () => {
    let draft = emptyDraft();
    for (const name of HITBOX_NAMES) draft = seedHitbox(draft, name);
    draft = clearHitbox(draft, "collar");
    expect(draftToHitboxes(draft)).toBeNull();
    expect(missingHitboxes(draft)).toEqual(["collar"]);
  });

  it("applyHitboxPatch replaces exactly one member and does not mutate", () => {
    const before = seedHitbox(emptyDraft(), "head");
    const after = applyHitboxPatch(before, {
      name: "head",
      value: { center: { x: 0.31, y: 0.07 }, radius: 0.042 },
    });
    expect(after.head).toEqual({ center: { x: 0.31, y: 0.07 }, radius: 0.042 });
    expect(before.head).toEqual({ center: { x: 0.5, y: 0.5 }, radius: 0.1 });
    expect(after.collar).toBeNull();
  });
});
