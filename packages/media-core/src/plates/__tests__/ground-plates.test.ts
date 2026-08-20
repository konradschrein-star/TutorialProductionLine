import { describe, expect, it } from "vitest";

import { computeCacheKey } from "../../cache/segment-cache.js";
import { buildGroundPlateHtml, groundPlateSpec } from "../ground-plates.js";
import {
  DARK_PLATE_THEME,
  LIGHT_PLATE_THEME,
  PLATE_GRID_1080,
  PLATE_SPEC_VERSION,
  PlateError,
} from "../types.js";

const CANVAS = { aspect: "16:9", width: 1920, height: 1080 } as const;

describe("groundPlateSpec", () => {
  it("carries everything that changes the pixels, and the renderer version", () => {
    expect(groundPlateSpec({ theme: "ground-default", ...CANVAS })).toEqual({
      kind: "business-hub-ground-plate",
      version: PLATE_SPEC_VERSION,
      theme: "ground-default",
      aspect: "16:9",
      width: 1920,
      height: 1080,
    });
  });

  it("is a stable cache key — the same mat at the same size is one file", () => {
    const a = computeCacheKey(
      groundPlateSpec({ theme: "ground-default", ...CANVAS }),
    );
    const b = computeCacheKey(
      groundPlateSpec({ theme: "ground-default", ...CANVAS }),
    );
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("separates the two mats, the two aspects and the two sizes", () => {
    const dark = computeCacheKey(
      groundPlateSpec({ theme: "ground-default", ...CANVAS }),
    );
    const light = computeCacheKey(
      groundPlateSpec({ theme: "ground-inverse", ...CANVAS }),
    );
    const vertical = computeCacheKey(
      groundPlateSpec({
        theme: "ground-default",
        aspect: "9:16",
        width: 1080,
        height: 1920,
      }),
    );
    const small = computeCacheKey(
      groundPlateSpec({
        theme: "ground-default",
        aspect: "16:9",
        width: 1280,
        height: 720,
      }),
    );
    expect(new Set([dark, light, vertical, small]).size).toBe(4);
  });

  it("refuses an aspect token that disagrees with the canvas", () => {
    expect(() =>
      groundPlateSpec({
        theme: "ground-default",
        aspect: "9:16",
        width: 1920,
        height: 1080,
      }),
    ).toThrow(PlateError);
  });

  it("refuses an unknown mat and an unusable canvas", () => {
    expect(() =>
      groundPlateSpec({
        // deliberately wrong, as a plan produced outside planBusinessHub would be
        theme: "ground-midnight" as never,
        ...CANVAS,
      }),
    ).toThrow(PlateError);
    expect(() =>
      groundPlateSpec({
        theme: "ground-default",
        aspect: "16:9",
        width: 1921,
        height: 1080,
      }),
    ).toThrow(PlateError);
  });
});

describe("buildGroundPlateHtml", () => {
  it("paints the dark mat and its ocean grid", () => {
    const html = buildGroundPlateHtml({
      theme: "ground-default",
      width: 1920,
      height: 1080,
    });
    expect(html).toContain(
      `background-color: ${DARK_PLATE_THEME.colors.ground}`,
    );
    expect(html).toContain(DARK_PLATE_THEME.colors.gridMinor);
    expect(html).toContain(DARK_PLATE_THEME.colors.gridMajor);
    expect(html).toContain(`opacity: ${DARK_PLATE_THEME.gridOpacity}`);
  });

  it("paints the inverse mat for a chapter break", () => {
    const html = buildGroundPlateHtml({
      theme: "ground-inverse",
      width: 1920,
      height: 1080,
    });
    expect(html).toContain(
      `background-color: ${LIGHT_PLATE_THEME.colors.ground}`,
    );
  });

  it("uses the 360p-survivable grid weights at 1080p", () => {
    const html = buildGroundPlateHtml({
      theme: "ground-default",
      width: 1920,
      height: 1080,
    });
    // 80px minor cell, 2px minor line, 400px major cell, 3px major line.
    expect(html).toContain(
      "2.000px, transparent 2.000px, transparent 80.000px",
    );
    expect(html).toContain(
      "3.000px, transparent 3.000px, transparent 400.000px",
    );
    expect(PLATE_GRID_1080.cellPx * PLATE_GRID_1080.majorEvery).toBe(400);
  });

  it("scales the grid with frame height for the 9:16 repurpose", () => {
    const html = buildGroundPlateHtml({
      theme: "ground-default",
      width: 1080,
      height: 1920,
    });
    expect(html).toContain("transparent 142.222px");
  });

  it("keeps the Remotion Ground's -8%/116% overhang so the grid phase matches", () => {
    const html = buildGroundPlateHtml({
      theme: "ground-default",
      width: 1920,
      height: 1080,
    });
    expect(html).toContain("left: -8%");
    expect(html).toContain("width: 116%");
  });

  it("throws on an unusable canvas rather than emitting a broken plate", () => {
    expect(() =>
      buildGroundPlateHtml({ theme: "ground-default", width: 0, height: 1080 }),
    ).toThrow(PlateError);
  });
});
