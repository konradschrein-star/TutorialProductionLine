/**
 * BUSINESS_PLAN_HUB — the ground plate.
 *
 * The mat (near-black `#0b0f14`, or near-white `#f2f1ec` for chapter breaks)
 * carrying a faint ocean grid and a vignette. It is the format's identity and it
 * is in nearly every shot, which is exactly why it is a STILL: nothing on it
 * moves in an FFmpeg-composited scene, so one PNG per
 * `{theme, aspect, width, height}` serves every scene of every video in the
 * catalogue.
 *
 * The geometry is a port of `Ground.tsx` / `GridLayer` in
 * `apps/worker-render/src/remotion/business-hub/ground/`, including the
 * `-8% / 116%` overhang that component uses so a drifting grid never exposes an
 * un-gridded edge. The overhang is reproduced here even though a still cannot
 * drift, because it sets the grid's PHASE: without it the plate's lines would
 * land a few pixels off the lines a Remotion motion-graphic island draws, and
 * the seam would show at every cut between an `mg` scene and a `title` scene.
 *
 * The plate is deliberately OPAQUE — it is the bottom layer of the stack, and
 * the workflow composites it as `layers[0]` at `x:0, y:0`
 * (`business-hub.ts:1644`).
 */

import type { JsonValue } from "../cache/canonical-json.js";
import { computeCacheKey, type SegmentCache } from "../cache/segment-cache.js";
import { buildPlateHtml, rasterisePlate } from "./rasterize.js";
import {
  PLATE_GRID_1080,
  PLATE_LOG_PREFIX,
  PLATE_SPEC_VERSION,
  PlateError,
  assertAspectMatchesCanvas,
  assertCanvasSize,
  getPlateTheme,
  scaleFor1080,
  themeForGround,
  type GroundThemeSlug,
} from "./types.js";

/** Identity of one ground plate. Hashed to the cache key; also the audit record. */
export interface GroundPlateSpec extends Record<string, JsonValue> {
  kind: "business-hub-ground-plate";
  version: number;
  /** `"ground-default"` / `"ground-inverse"` — as written on `scene.grade`. */
  theme: string;
  /** Aspect token; redundant with the canvas but part of the format's key vocabulary. */
  aspect: string;
  width: number;
  height: number;
}

/**
 * The cache identity of a ground plate.
 *
 * PURE. Two videos that want the same mat at the same size share one file, which
 * is the entire point of baking it once.
 *
 * @throws {PlateError} If the theme slug is unknown, the canvas is unusable, or
 *   the aspect disagrees with the canvas.
 */
export function groundPlateSpec(params: {
  theme: GroundThemeSlug;
  aspect: string;
  width: number;
  height: number;
}): GroundPlateSpec {
  themeForGround(params.theme, "ground plate");
  assertCanvasSize(params.width, params.height, "ground plate");
  assertAspectMatchesCanvas(
    params.aspect,
    params.width,
    params.height,
    "ground plate",
  );
  return {
    kind: "business-hub-ground-plate",
    version: PLATE_SPEC_VERSION,
    theme: params.theme,
    aspect: params.aspect,
    width: params.width,
    height: params.height,
  };
}

/**
 * The HTML for one ground plate.
 *
 * PURE, and unit-tested against the palette and grid tokens — the mat colour and
 * the grid weights are the two things a silent regression here would change
 * across the whole catalogue.
 *
 * @throws {PlateError} If the theme slug is unknown or the canvas is unusable.
 */
export function buildGroundPlateHtml(params: {
  theme: GroundThemeSlug;
  width: number;
  height: number;
}): string {
  assertCanvasSize(params.width, params.height, "ground plate");
  const theme = getPlateTheme(themeForGround(params.theme, "ground plate"));

  const cell = scaleFor1080(PLATE_GRID_1080.cellPx, params.height);
  const minorW = Math.max(
    1,
    scaleFor1080(PLATE_GRID_1080.minorWidthPx, params.height),
  );
  const majorCell = cell * PLATE_GRID_1080.majorEvery;
  const majorW = Math.max(
    1,
    scaleFor1080(PLATE_GRID_1080.majorWidthPx, params.height),
  );

  const backgroundImage = [
    gridLine("to right", theme.colors.gridMajor, majorW, majorCell),
    gridLine("to bottom", theme.colors.gridMajor, majorW, majorCell),
    gridLine("to right", theme.colors.gridMinor, minorW, cell),
    gridLine("to bottom", theme.colors.gridMinor, minorW, cell),
  ].join(", ");

  const css = `
  #bh-mat {
    position: absolute;
    inset: 0;
    background-color: ${theme.colors.ground};
  }
  #bh-grid {
    position: absolute;
    left: -8%;
    top: -8%;
    width: 116%;
    height: 116%;
    opacity: ${theme.gridOpacity};
    background-image: ${backgroundImage};
  }
  #bh-vignette {
    position: absolute;
    inset: 0;
    opacity: ${theme.vignette};
    background-image: radial-gradient(ellipse at 50% 46%, transparent 38%, ${theme.colors.groundEdge} 118%);
  }`;

  const vignette = theme.vignette > 0 ? `<div id="bh-vignette"></div>` : "";

  return buildPlateHtml({
    width: params.width,
    height: params.height,
    css,
    body: `<div id="bh-mat"></div><div id="bh-grid"></div>${vignette}`,
  });
}

function gridLine(
  direction: "to right" | "to bottom",
  color: string,
  widthPx: number,
  cellPx: number,
): string {
  const w = widthPx.toFixed(3);
  const c = cellPx.toFixed(3);
  return `repeating-linear-gradient(${direction}, ${color} 0px, ${color} ${w}px, transparent ${w}px, transparent ${c}px)`;
}

/** Inputs to {@link bakeGroundPlate}. */
export interface BakeGroundPlateParams {
  theme: GroundThemeSlug;
  aspect: string;
  width: number;
  height: number;
  /** Content-addressed store the PNG is committed to. */
  cache: SegmentCache;
  /** Scratch directory for the temporary HTML. */
  workDir: string;
  /** Resolved Chromium, so a whole plan's plates share one resolution. */
  executablePath?: string;
}

/** One baked plate and whether the cache already had it. */
export interface BakedPlate {
  /** Absolute path INSIDE the content-addressed store. Stable across jobs. */
  path: string;
  /** The store key, for logs and telemetry. */
  key: string;
  hit: boolean;
}

/**
 * Bake (or reuse) the ground plate for one mat.
 *
 * The PNG lands in the shared content-addressed store, so the returned path is
 * stable across jobs and is safe to write into `metadata.business_hub.assets`:
 * the store is never pruned implicitly (`selectEvictions` is advisory and
 * `remove` must be called explicitly), so a path handed to the renderer does not
 * vanish under it.
 *
 * @returns The plate path, its cache key, and whether it was already there.
 * @throws {PlateError} If the theme, canvas or aspect is invalid, or the
 *   rasterisation fails. Never returns a placeholder.
 */
export async function bakeGroundPlate(
  params: BakeGroundPlateParams,
): Promise<BakedPlate> {
  const spec = groundPlateSpec({
    theme: params.theme,
    aspect: params.aspect,
    width: params.width,
    height: params.height,
  });
  const key = computeCacheKey(spec);
  const html = buildGroundPlateHtml({
    theme: params.theme,
    width: params.width,
    height: params.height,
  });

  const result = await params.cache.withCache(key, spec, async (ctx) => {
    const outputPath = ctx.suggestedOutputPath;
    await rasterisePlate({
      html,
      outputPath,
      width: params.width,
      height: params.height,
      workDir: params.workDir,
      context: `ground plate "${params.theme}" ${params.width}x${params.height}`,
      ...(params.executablePath === undefined
        ? {}
        : { executablePath: params.executablePath }),
      // The mat is the bottom layer and is meant to be opaque; requiring alpha
      // here would reject a correct plate.
      expectAlpha: false,
    });
    // A still. The segment cache records frames, and one is the honest number.
    return { filePath: outputPath, sourceDurationFrames: 1 };
  });

  if (result.entry.bytes === 0) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} ground plate "${params.theme}" resolved to a zero-byte file at ` +
        `${result.entry.filePath}.`,
    );
  }

  return { path: result.entry.filePath, key, hit: result.hit };
}
