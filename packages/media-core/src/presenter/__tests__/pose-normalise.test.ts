import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CalibratedPose } from "@repo/contracts";
import {
  computePoseScale,
  requireCalibratedPose,
  resolvePresenterLayout,
} from "../pose-normalise.js";
import type { PresenterPlacement } from "../pose-normalise.js";

const REPO_ROOT = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
);
const POSES_JSON = join(
  REPO_ROOT,
  "media",
  "style-assets",
  "presenter",
  "poses",
  "poses.json",
);

/**
 * A hand-built calibrated pose. `poses.json` on disk has NO calibrated entries,
 * so every test that needs one has to construct it — which is exactly the point
 * of the fail-closed gate.
 */
function calibratedPose(
  overrides: Partial<CalibratedPose> = {},
): CalibratedPose {
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
    ...overrides,
  };
}

describe("requireCalibratedPose", () => {
  it("accepts a fully calibrated pose", () => {
    const pose = calibratedPose();
    expect(requireCalibratedPose(pose).slug).toBe("test-pose");
  });

  it("throws for every pose in the shipped poses.json (all need calibration)", async () => {
    const raw: unknown = JSON.parse(await readFile(POSES_JSON, "utf8"));
    expect(Array.isArray(raw)).toBe(true);
    const poses = raw as unknown[];
    expect(poses.length).toBeGreaterThan(0);
    for (const pose of poses) {
      expect(() => requireCalibratedPose(pose)).toThrow(/is not calibrated/);
    }
  });

  it("names the pose slug and points at the Presenter Studio", () => {
    expect(() =>
      requireCalibratedPose({
        slug: "holding-tablet",
        anchor_status: "needs-calibration",
      }),
    ).toThrow(/"holding-tablet"[\s\S]*business-hub-studio/);
  });

  it("throws when hitboxes are present but incomplete — never half-places a figure", () => {
    const pose = calibratedPose();
    const partial = {
      ...pose,
      hitboxes: { head: pose.hitboxes.head, collar: pose.hitboxes.collar },
    };
    expect(() => requireCalibratedPose(partial)).toThrow(/is not calibrated/);
  });

  it("throws when anchor_status is calibrated but hitboxes are missing", () => {
    const pose = calibratedPose();
    const noHitboxes: Record<string, unknown> = { ...pose };
    delete noHitboxes["hitboxes"];
    expect(() => requireCalibratedPose(noHitboxes)).toThrow(
      /is not calibrated/,
    );
  });

  it("reports <unknown slug> for input that is not a pose at all", () => {
    expect(() => requireCalibratedPose(null)).toThrow(/<unknown slug>/);
    expect(() => requireCalibratedPose("nope")).toThrow(/<unknown slug>/);
  });
});

describe("computePoseScale", () => {
  it("scales so the collar subtends the target width", () => {
    const { scale } = computePoseScale({
      poseSizePx: [1000, 1500],
      collarWidthNorm: 0.2, // 200px collar
      targetCollarPx: 100,
    });
    expect(scale).toBeCloseTo(0.5, 10);
  });

  it("normalises the measured 6x framing swing to one apparent size", () => {
    // The two extremes recorded in the design: full-body-standing 424x1088 and
    // hands-in-pockets 2752x1442. Same physical collar, wildly different crops.
    const tight = computePoseScale({
      poseSizePx: [424, 1088],
      collarWidthNorm: 0.34, // ~144px collar in a tight crop
      targetCollarPx: 160,
    });
    const wide = computePoseScale({
      poseSizePx: [2752, 1442],
      collarWidthNorm: 0.052, // ~143px collar in a wide crop
      targetCollarPx: 160,
    });

    const collarAfterTight = 0.34 * 424 * tight.scale;
    const collarAfterWide = 0.052 * 2752 * wide.scale;
    expect(collarAfterTight).toBeCloseTo(160, 6);
    expect(collarAfterWide).toBeCloseTo(160, 6);

    // The naive alternative — scale both PNGs to a common width — leaves the
    // collars, i.e. the apparent figure size, differing by ~6.5x. That is the
    // teleport the design measured.
    const naiveTargetWidth = 400;
    const naiveTightCollar = 0.34 * naiveTargetWidth;
    const naiveWideCollar = 0.052 * naiveTargetWidth;
    expect(naiveTightCollar / naiveWideCollar).toBeGreaterThan(6);

    // Collar normalisation removes it entirely.
    expect(collarAfterWide / collarAfterTight).toBeCloseTo(1, 6);
  });

  it("returns even pixel dimensions", () => {
    const { scaledWidthPx, scaledHeightPx } = computePoseScale({
      poseSizePx: [1001, 1499],
      collarWidthNorm: 0.2,
      targetCollarPx: 137,
    });
    expect(scaledWidthPx % 2).toBe(0);
    expect(scaledHeightPx % 2).toBe(0);
  });

  it("throws on a non-positive collar width", () => {
    expect(() =>
      computePoseScale({
        poseSizePx: [100, 100],
        collarWidthNorm: 0,
        targetCollarPx: 10,
      }),
    ).toThrow(/collarWidthNorm must be finite and > 0/);
  });

  it("throws when a pixel collar width is passed instead of a normalised one", () => {
    expect(() =>
      computePoseScale({
        poseSizePx: [1000, 1500],
        collarWidthNorm: 200,
        targetCollarPx: 100,
      }),
    ).toThrow(/0\.\.1 fraction/);
  });

  it("throws when the target collar scales the pose out of existence", () => {
    expect(() =>
      computePoseScale({
        poseSizePx: [1000, 1500],
        collarWidthNorm: 0.9,
        targetCollarPx: 0.001,
      }),
    ).toThrow(/not renderable/);
  });

  it("throws on a non-positive pose size", () => {
    expect(() =>
      computePoseScale({
        poseSizePx: [0, 100],
        collarWidthNorm: 0.2,
        targetCollarPx: 50,
      }),
    ).toThrow(/poseSizePx\[0\]/);
  });
});

describe("resolvePresenterLayout", () => {
  const basePlacement: PresenterPlacement = {
    side: "left",
    targetCollarPx: 200,
    bottomAnchor: 1,
    sideInset: 0.05,
  };

  it("places a left-side figure at the inset and flush with the bottom", () => {
    const layout = resolvePresenterLayout({
      pose: calibratedPose(),
      placement: basePlacement,
      frameWidth: 1920,
      frameHeight: 1080,
    });
    // collar 0.2 * 1000px = 200px, target 200px => scale 1.0
    expect(layout.scale).toBeCloseTo(1, 10);
    expect(layout.suit.widthPx).toBe(1000);
    expect(layout.suit.heightPx).toBe(1500);
    expect(layout.suit.xPx).toBe(96); // 0.05 * 1920
    expect(layout.suit.yPx).toBe(1080 - 1500);
    expect(layout.suit.mirrored).toBe(false);
  });

  it("mirrors the right-side figure and mirrors the head with it", () => {
    const pose = calibratedPose();
    pose.hitboxes.head.center.x = 0.3;

    const notMirrored = resolvePresenterLayout({
      pose,
      placement: { ...basePlacement, side: "right", targetCollarPx: 100 },
      frameWidth: 1920,
      frameHeight: 1080,
    });
    const mirrored = resolvePresenterLayout({
      pose,
      placement: {
        ...basePlacement,
        side: "right",
        targetCollarPx: 100,
        mirror: true,
      },
      frameWidth: 1920,
      frameHeight: 1080,
    });

    expect(mirrored.suit.mirrored).toBe(true);
    expect(mirrored.suit.xPx).toBe(notMirrored.suit.xPx);
    // 0.3 from the left becomes 0.7 from the left once flipped.
    const w = notMirrored.suit.widthPx;
    expect(notMirrored.head.centreXPx - notMirrored.suit.xPx).toBeCloseTo(
      0.3 * w,
      6,
    );
    expect(mirrored.head.centreXPx - mirrored.suit.xPx).toBeCloseTo(0.7 * w, 6);
    // Vertical position is unaffected by a horizontal flip.
    expect(mirrored.head.centreYPx).toBeCloseTo(notMirrored.head.centreYPx, 10);
  });

  it("centres the figure for side: center", () => {
    const layout = resolvePresenterLayout({
      pose: calibratedPose(),
      placement: { ...basePlacement, side: "center", targetCollarPx: 100 },
      frameWidth: 1920,
      frameHeight: 1080,
    });
    expect(layout.suit.xPx).toBe(Math.round((1920 - layout.suit.widthPx) / 2));
  });

  it("right-anchors from the right edge", () => {
    const layout = resolvePresenterLayout({
      pose: calibratedPose(),
      placement: { ...basePlacement, side: "right", targetCollarPx: 100 },
      frameWidth: 1920,
      frameHeight: 1080,
    });
    expect(layout.suit.xPx + layout.suit.widthPx).toBe(
      Math.round(1920 - 0.05 * 1920),
    );
  });

  it("derives the head diameter from the radius and the SCALED width", () => {
    const layout = resolvePresenterLayout({
      pose: calibratedPose(),
      placement: { ...basePlacement, targetCollarPx: 100 },
      frameWidth: 1920,
      frameHeight: 1080,
    });
    // radius 0.08 of the pose width, doubled, times the scaled width.
    expect(layout.head.diameterPx).toBeCloseTo(
      2 * 0.08 * layout.suit.widthPx,
      6,
    );
  });

  it("allows a figure cropped by the frame edge (presenter-solo)", () => {
    const layout = resolvePresenterLayout({
      pose: calibratedPose(),
      placement: {
        ...basePlacement,
        side: "left",
        sideInset: -0.1,
        bottomAnchor: 1.3,
      },
      frameWidth: 1920,
      frameHeight: 1080,
    });
    expect(layout.suit.xPx).toBeLessThan(0);
  });

  it("throws when the figure lands entirely outside the frame", () => {
    expect(() =>
      resolvePresenterLayout({
        pose: calibratedPose(),
        placement: { ...basePlacement, side: "left", sideInset: 5 },
        frameWidth: 1920,
        frameHeight: 1080,
      }),
    ).toThrow(/entirely outside it/);
  });

  it("throws on a non-positive frame size", () => {
    expect(() =>
      resolvePresenterLayout({
        pose: calibratedPose(),
        placement: basePlacement,
        frameWidth: 0,
        frameHeight: 1080,
      }),
    ).toThrow(/frameWidth/);
  });

  it("throws on a non-finite bottomAnchor", () => {
    expect(() =>
      resolvePresenterLayout({
        pose: calibratedPose(),
        placement: { ...basePlacement, bottomAnchor: Number.NaN },
        frameWidth: 1920,
        frameHeight: 1080,
      }),
    ).toThrow(/bottomAnchor must be finite/);
  });
});
