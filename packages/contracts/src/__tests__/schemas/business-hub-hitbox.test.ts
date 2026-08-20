import { describe, it, expect } from "vitest";
import {
  CalibratedPoseSchema,
  NormRectSchema,
  NormVectorSchema,
  PoseHitboxesSchema,
  PoseManifestSchema,
  PoseSchema,
} from "../../schemas/business-hub-hitbox.js";

/**
 * Copied verbatim from `media/style-assets/presenter/poses/poses.json`
 * (read 2026-08-15). `media/` is gitignored, so the fixture lives here rather
 * than being read off disk — that also keeps @repo/contracts free of node
 * builtins, which matters because these schemas are bundled into the Remotion
 * browser build.
 *
 * The three entries are the extremes of the real file: the smallest crop
 * (424x1088), the largest (2752x1442) — the ~6x apparent-scale swing the
 * collar hitbox exists to normalise — and a crop that starts at y=0.
 */
const realPoseEntry = {
  source: "Businessman_standing_and_pointing_2K_202608151422.jpeg",
  source_size: [2752, 1536],
  crop: [96, 36, 1120, 1500],
  coverage: 0.2642,
  soft_edge_px: 12056,
  head_anchor: null,
  slug: "pointing-down-left",
  file: "pointing-down-left.png",
  size: [1120, 1500],
  anchor_status: "needs-calibration",
};

const realPoseManifestSample = [
  realPoseEntry,
  {
    source: "Headless_male_figure_standing_st…_202608151422.jpeg",
    source_size: [2752, 1536],
    crop: [1150, 263, 424, 1088],
    coverage: 0.0692,
    soft_edge_px: 1301,
    head_anchor: null,
    slug: "full-body-standing",
    file: "full-body-standing.png",
    size: [424, 1088],
    anchor_status: "needs-calibration",
  },
  {
    source: "Headless_man_standing_in_suit_202608151422.jpeg",
    source_size: [2752, 1536],
    crop: [0, 94, 2752, 1442],
    coverage: 0.2202,
    soft_edge_px: 21597,
    head_anchor: null,
    slug: "hands-in-pockets",
    file: "hands-in-pockets.png",
    size: [2752, 1442],
    anchor_status: "needs-calibration",
  },
  {
    source: "Man_holding_tablet_computer_2K_202608151422.jpeg",
    source_size: [2752, 1536],
    crop: [794, 0, 1164, 1536],
    coverage: 0.2976,
    soft_edge_px: 14059,
    head_anchor: null,
    slug: "holding-tablet",
    file: "holding-tablet.png",
    size: [1164, 1536],
    anchor_status: "needs-calibration",
  },
];

const validHitboxes = {
  head: { center: { x: 0.42, y: 0.08 }, radius: 0.09 },
  collar: { width: 0.18 },
  pointOrigin: { x: 0.31, y: 0.62 },
  pointDirection: { x: -0.8, y: 0.6 },
  safeRegion: { x: 0.5, y: 0.1, w: 0.45, h: 0.7 },
  crop: { x: 0.0, y: 0.0, w: 1.0, h: 1.0 },
};

describe("PoseSchema", () => {
  it("parses an uncalibrated entry exactly as it exists on disk", () => {
    const result = PoseSchema.safeParse(realPoseEntry);
    if (!result.success) throw new Error(JSON.stringify(result.error.issues, null, 2));
    expect(result.data.slug).toBe("pointing-down-left");
    expect(result.data.head_anchor).toBeNull();
    expect(result.data.hitboxes).toBeUndefined();
  });

  it("parses a manifest of real, wildly differently-framed entries", () => {
    const result = PoseManifestSchema.safeParse(realPoseManifestSample);
    if (!result.success) throw new Error(JSON.stringify(result.error.issues, null, 2));
    expect(result.data).toHaveLength(4);
    expect(result.data.every((p) => p.anchor_status === "needs-calibration")).toBe(true);
  });

  it("rejects duplicate slugs in a manifest", () => {
    const result = PoseManifestSchema.safeParse([realPoseEntry, { ...realPoseEntry, file: "x.png" }]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("duplicate pose slug"))).toBe(true);
    }
  });
});

describe("CalibratedPoseSchema", () => {
  it("accepts a fully calibrated pose", () => {
    const result = CalibratedPoseSchema.safeParse({
      ...realPoseEntry,
      anchor_status: "calibrated",
      hitboxes: validHitboxes,
    });
    if (!result.success) throw new Error(JSON.stringify(result.error.issues, null, 2));
    expect(result.data.hitboxes.collar.width).toBeCloseTo(0.18);
  });

  it("REJECTS the uncalibrated poses that are on disk today", () => {
    expect(CalibratedPoseSchema.safeParse(realPoseEntry).success).toBe(false);
  });

  it("REJECTS a pose missing any single hitbox", () => {
    for (const key of Object.keys(validHitboxes)) {
      const partial: Record<string, unknown> = { ...validHitboxes };
      delete partial[key];
      const result = CalibratedPoseSchema.safeParse({
        ...realPoseEntry,
        anchor_status: "calibrated",
        hitboxes: partial,
      });
      expect(result.success, `missing hitbox ${key} must fail`).toBe(false);
    }
  });
});

describe("normalised geometry", () => {
  it("rejects out-of-range and out-of-bounds values", () => {
    expect(PoseHitboxesSchema.safeParse({
      ...validHitboxes,
      head: { center: { x: 1.4, y: 0.1 }, radius: 0.1 },
    }).success).toBe(false);
    expect(NormRectSchema.safeParse({ x: 0.8, y: 0.1, w: 0.5, h: 0.2 }).success).toBe(false);
    expect(NormRectSchema.safeParse({ x: 0.1, y: 0.9, w: 0.2, h: 0.5 }).success).toBe(false);
    expect(NormRectSchema.safeParse({ x: 0.1, y: 0.1, w: 0, h: 0.2 }).success).toBe(false);
  });

  it("rejects the zero pointing vector", () => {
    const result = NormVectorSchema.safeParse({ x: 0, y: 0 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("zero vector");
    }
    expect(NormVectorSchema.safeParse({ x: -1, y: 0 }).success).toBe(true);
  });
});
