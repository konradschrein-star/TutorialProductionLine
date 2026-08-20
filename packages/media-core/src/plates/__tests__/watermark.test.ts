import { join, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { PlateError } from "../types.js";
import {
  PRESENTER_ASSETS_RELATIVE,
  parseSvgIntrinsicSize,
  presenterAssetCandidates,
  watermarkPlateSize,
} from "../watermark.js";

/** The real lockup's header, as read from media/style-assets/presenter/mark/watermark.svg. */
const WATERMARK_HEADER =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 152 114" width="152" height="114" role="img">';

describe("parseSvgIntrinsicSize", () => {
  it("reads the real watermark lockup's viewBox", () => {
    expect(parseSvgIntrinsicSize(`${WATERMARK_HEADER}</svg>`)).toEqual({
      width: 152,
      height: 114,
    });
  });

  it("prefers the viewBox over the width/height attributes", () => {
    const svg = '<svg viewBox="0 0 200 100" width="50" height="50"></svg>';
    expect(parseSvgIntrinsicSize(svg)).toEqual({ width: 200, height: 100 });
  });

  it("falls back to numeric width/height when there is no viewBox", () => {
    const svg = '<svg width="64px" height="32px"></svg>';
    expect(parseSvgIntrinsicSize(svg)).toEqual({ width: 64, height: 32 });
  });

  it("throws rather than assuming a brand asset's proportions", () => {
    expect(() => parseSvgIntrinsicSize("<svg></svg>")).toThrow(PlateError);
    expect(() => parseSvgIntrinsicSize('<svg width="10em"></svg>')).toThrow(
      PlateError,
    );
  });
});

describe("watermarkPlateSize", () => {
  const lockup = { width: 152, height: 114 };

  it("is 84px wide at 1080p, keeping the lockup's aspect", () => {
    expect(watermarkPlateSize(1080, lockup)).toEqual({ width: 84, height: 63 });
  });

  it("scales with frame height so the 9:16 repurpose matches", () => {
    expect(watermarkPlateSize(1920, lockup)).toEqual({
      width: 149,
      height: 112,
    });
  });

  it("never rounds down to nothing on a tiny canvas", () => {
    const size = watermarkPlateSize(10, lockup);
    expect(size.width).toBeGreaterThanOrEqual(1);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });

  it("throws on an unusable intrinsic size", () => {
    expect(() => watermarkPlateSize(1080, { width: 0, height: 10 })).toThrow(
      PlateError,
    );
  });
});

describe("presenterAssetCandidates", () => {
  it("lets an operator override the gitignored media tree", () => {
    const candidates = presenterAssetCandidates({
      env: { BUSINESS_HUB_PRESENTER_ASSETS: "/srv/assets/presenter" },
      startDir: "/repo/apps/worker-render",
    });
    expect(candidates[0]).toBe("/srv/assets/presenter");
  });

  it("walks up from the working directory towards the repo root", () => {
    const repo = resolve(sep, "repo");
    const startDir = join(repo, "apps", "worker-render");
    const candidates = presenterAssetCandidates({ env: {}, startDir });
    expect(candidates[0]).toBe(join(startDir, PRESENTER_ASSETS_RELATIVE));
    expect(candidates).toContain(join(repo, PRESENTER_ASSETS_RELATIVE));
    // Every candidate points at the same relative sub-tree.
    expect(candidates.every((c) => c.endsWith(PRESENTER_ASSETS_RELATIVE))).toBe(
      true,
    );
  });
});
