/**
 * BUSINESS_PLAN_HUB — the corner watermark plate.
 *
 * `media/style-assets/presenter/mark/watermark.svg` — the disc-less lockup
 * (three ascending bars plus a question mark) — rasterised to a small
 * transparent PNG. The render workflow composites it bottom-right on EVERY frame
 * of EVERY scene, positioned with `x: "W-w-40", y: "H-h-40"`
 * (`business-hub.ts:1684-1689`). Because the offset is `W-w`, the plate must be
 * the mark's own size: a full-frame plate would push the mark off screen.
 *
 * ## Why the SVG is read at runtime
 *
 * `media/` is gitignored. A `import watermark from ".../watermark.svg"` resolves
 * on the box that authored the asset and fails in CI and on any fresh checkout,
 * so the file is READ from a resolved path at runtime and a missing file throws
 * a diagnostic that says what is missing and why. Nothing is substituted: a
 * video published without the mark is a branding defect that is invisible in the
 * logs.
 *
 * Its geometry, verified 2026-08-15 by reading the file:
 * `viewBox="0 0 152 114"`, one `<g transform="translate(-30,-34)">` holding three
 * `<rect>` bars, a `<circle>` dot and a stroked `<path>` hook, all painted in
 * `currentColor`. That last fact is what lets the plate be themed here: the
 * wrapper sets a `color` and an opacity and the whole lockup follows.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { JsonValue } from "../cache/canonical-json.js";
import { computeCacheKey, type SegmentCache } from "../cache/segment-cache.js";
import { themeHeadMarkSvg } from "../presenter/head-mark-theme.js";
import type { BakedPlate } from "./ground-plates.js";
import { rasteriseSvg, readSvgFile } from "./rasterize.js";
import {
  PLATE_LOG_PREFIX,
  PLATE_SPEC_VERSION,
  PLATE_WATERMARK_1080,
  PlateError,
  getPlateTheme,
  scaleFor1080,
  themeForGround,
  type GroundThemeSlug,
} from "./types.js";

/** Path of the style-asset tree, relative to a repo root. */
export const PRESENTER_ASSETS_RELATIVE = join(
  "media",
  "style-assets",
  "presenter",
);

/** The watermark lockup, relative to the presenter asset root. */
export const WATERMARK_RELATIVE = join("mark", "watermark.svg");

/** The head mark, relative to the presenter asset root. */
export const HEAD_MARK_RELATIVE = join("mark", "head-mark.svg");

/**
 * Candidate locations of the presenter style-asset root, in priority order.
 *
 * PURE. `$BUSINESS_HUB_PRESENTER_ASSETS` wins so an operator can move the tree;
 * otherwise every directory from `startDir` up to the filesystem root is offered,
 * which finds `media/style-assets/presenter` whether the worker runs from the
 * repo root, from `apps/worker-render`, or from a deploy tree that mirrors the
 * same layout.
 */
export function presenterAssetCandidates(ctx: {
  env: NodeJS.ProcessEnv;
  startDir: string;
}): string[] {
  const out: string[] = [];
  const override = ctx.env["BUSINESS_HUB_PRESENTER_ASSETS"];
  if (typeof override === "string" && override.trim().length > 0) {
    out.push(override.trim());
  }
  let dir = resolve(ctx.startDir);
  for (;;) {
    out.push(join(dir, PRESENTER_ASSETS_RELATIVE));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return out;
}

/**
 * Resolve the presenter style-asset root.
 *
 * @throws {PlateError} If no candidate directory exists, listing all of them.
 */
export function resolvePresenterAssetRoot(
  options: {
    env?: NodeJS.ProcessEnv;
    startDir?: string;
  } = {},
): string {
  const candidates = presenterAssetCandidates({
    env: options.env ?? process.env,
    startDir: options.startDir ?? process.cwd(),
  });
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new PlateError(
    `${PLATE_LOG_PREFIX} the presenter style assets could not be found. media/ is ` +
      `gitignored, so the tree must be synced onto this box (or ` +
      `$BUSINESS_HUB_PRESENTER_ASSETS pointed at it) before a BUSINESS_PLAN_HUB job can ` +
      `render. Tried:\n` +
      candidates.map((c) => `  - ${c}`).join("\n"),
  );
}

/**
 * Absolute path of the watermark SVG.
 *
 * @throws {PlateError} If the asset root or the file itself is absent.
 */
export function resolveWatermarkSvgPath(
  options: {
    assetRoot?: string;
    env?: NodeJS.ProcessEnv;
    startDir?: string;
  } = {},
): string {
  const root =
    options.assetRoot ??
    resolvePresenterAssetRoot({
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.startDir === undefined ? {} : { startDir: options.startDir }),
    });
  const path = join(root, WATERMARK_RELATIVE);
  if (!existsSync(path)) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} the watermark lockup is missing at ${path}. Every scene of ` +
        `this format carries the mark bottom-right (build brief §6); it is not omitted and ` +
        `no stand-in is drawn.`,
    );
  }
  return path;
}

/** Intrinsic size of an SVG document, in user units. */
export interface SvgIntrinsicSize {
  width: number;
  height: number;
}

/**
 * Read an SVG's intrinsic size, preferring its `viewBox`.
 *
 * PURE. The aspect matters: the plate's height is derived from the requested
 * width through it, so a lockup that is re-drawn at a different aspect scales
 * correctly instead of being squashed into the old one.
 *
 * @throws {PlateError} If neither a usable `viewBox` nor numeric `width`/`height`
 *   attributes are present.
 */
export function parseSvgIntrinsicSize(svgText: string): SvgIntrinsicSize {
  const viewBox =
    /viewBox\s*=\s*["']\s*([-\d.]+)[,\s]+([-\d.]+)[,\s]+([-\d.]+)[,\s]+([-\d.]+)\s*["']/i.exec(
      svgText,
    );
  if (viewBox !== null) {
    const width = Number(viewBox[3]);
    const height = Number(viewBox[4]);
    if (
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      return { width, height };
    }
  }

  const widthAttr = /<svg[^>]*\swidth\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(
    svgText,
  );
  const heightAttr = /<svg[^>]*\sheight\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(
    svgText,
  );
  const width = widthAttr === null ? NaN : Number(widthAttr[1]);
  const height = heightAttr === null ? NaN : Number(heightAttr[1]);
  if (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  ) {
    return { width, height };
  }

  throw new PlateError(
    `${PLATE_LOG_PREFIX} the SVG carries neither a usable viewBox nor numeric width/height ` +
      `attributes, so the plate's aspect cannot be derived from it. Nothing is assumed about ` +
      `a brand asset's proportions.`,
  );
}

/** Plate size for a mark of a given intrinsic aspect on a given canvas. */
export interface MarkPlateSize {
  width: number;
  height: number;
}

/**
 * Size of the watermark plate on a canvas of `frameHeight` pixels.
 *
 * PURE. The mark is 84px wide at 1080p (`WATERMARK_1080`, mirroring the Remotion
 * `Watermark` component) and scales with frame height, so the 9:16 repurpose gets
 * the same apparent mark.
 *
 * @throws {PlateError} If the frame height or the intrinsic size is unusable.
 */
export function watermarkPlateSize(
  frameHeight: number,
  intrinsic: SvgIntrinsicSize,
  widthAt1080: number = PLATE_WATERMARK_1080.widthPx,
): MarkPlateSize {
  if (intrinsic.width <= 0 || intrinsic.height <= 0) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} watermark: intrinsic size ${intrinsic.width}x${intrinsic.height} ` +
        `is not usable.`,
    );
  }
  const width = Math.max(1, Math.round(scaleFor1080(widthAt1080, frameHeight)));
  const height = Math.max(
    1,
    Math.round((width * intrinsic.height) / intrinsic.width),
  );
  return { width, height };
}

/** Identity of one watermark plate. */
export interface WatermarkPlateSpec extends Record<string, JsonValue> {
  kind: "business-hub-watermark-plate";
  version: number;
  theme: string;
  width: number;
  height: number;
  color: string;
  opacity: number;
  /** sha256 of the SVG source, so a re-drawn lockup re-bakes instead of being served stale. */
  svgSha256: string;
}

/** Inputs to {@link bakeWatermarkPlate}. */
export interface BakeWatermarkPlateParams {
  /**
   * The video's ground theme. There is ONE watermark plate for the whole video
   * (the envelope has a single `watermarkPngPath`), so its colour is chosen from
   * the job's dominant mat rather than per scene.
   */
  theme: GroundThemeSlug;
  /** Output frame height, which the mark's size scales with. */
  frameHeight: number;
  cache: SegmentCache;
  workDir: string;
  /** Absolute path of `watermark.svg`. Resolve it once per job and pass it in. */
  svgPath: string;
  executablePath?: string;
}

/**
 * Bake (or reuse) the corner watermark plate.
 *
 * @returns The plate path, cache key, hit flag and the plate's pixel size.
 * @throws {PlateError} If the SVG is missing, malformed, or the rasterisation
 *   produces something that is not a transparent PNG of the requested size.
 */
export async function bakeWatermarkPlate(
  params: BakeWatermarkPlateParams,
): Promise<BakedPlate & { size: MarkPlateSize }> {
  const themeName = themeForGround(params.theme, "watermark plate");
  const theme = getPlateTheme(themeName);
  const svgText = await readSvgFile(params.svgPath, "watermark plate");
  const intrinsic = parseSvgIntrinsicSize(svgText);
  const size = watermarkPlateSize(params.frameHeight, intrinsic);

  const spec: WatermarkPlateSpec = {
    kind: "business-hub-watermark-plate",
    version: PLATE_SPEC_VERSION,
    theme: params.theme,
    width: size.width,
    height: size.height,
    color: theme.colors.watermark,
    opacity: theme.watermarkOpacity,
    svgSha256: createHash("sha256").update(svgText, "utf8").digest("hex"),
  };
  const key = computeCacheKey(spec);

  const result = await params.cache.withCache(key, spec, async (ctx) => {
    await rasteriseSvg({
      svgText,
      width: size.width,
      height: size.height,
      outputPath: ctx.suggestedOutputPath,
      workDir: params.workDir,
      context: `watermark plate (${themeName}, ${size.width}x${size.height})`,
      color: theme.colors.watermark,
      opacity: theme.watermarkOpacity,
      ...(params.executablePath === undefined
        ? {}
        : { executablePath: params.executablePath }),
    });
    return { filePath: ctx.suggestedOutputPath, sourceDurationFrames: 1 };
  });

  return { path: result.entry.filePath, key, hit: result.hit, size };
}

/** Inputs to {@link bakeHeadMarkPlate}. */
export interface BakeHeadMarkPlateParams {
  /** Ground theme, which decides `--mark-bg` / `--mark-fg`. */
  theme: GroundThemeSlug;
  /** Rendered width in output pixels. The head is square, so height follows. */
  widthPx: number;
  cache: SegmentCache;
  workDir: string;
  /** Absolute path of `head-mark.svg`. */
  svgPath: string;
  executablePath?: string;
}

/**
 * Bake (or reuse) the presenter's head mark as an RGBA PNG.
 *
 * The presenter compositor takes a PNG rather than an SVG because ffmpeg in this
 * repo has no SVG decoder (verified 2026-08-15), and it scales the mark with
 * narration loudness — so the plate is baked at the LARGEST size any scene draws
 * and scaled down from there, never up.
 *
 * The SVG's `--mark-bg` / `--mark-fg` custom properties are resolved to literals
 * with `themeHeadMarkSvg` before rasterisation, which is also what the browserless
 * path does.
 *
 * @throws {PlateError} If the SVG is missing or the rasterisation fails.
 */
export async function bakeHeadMarkPlate(
  params: BakeHeadMarkPlateParams,
): Promise<BakedPlate & { size: MarkPlateSize }> {
  const themeName = themeForGround(params.theme, "head mark plate");
  const theme = getPlateTheme(themeName);

  if (!Number.isInteger(params.widthPx) || params.widthPx <= 0) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} head mark plate: widthPx must be a positive integer, got ` +
        `${String(params.widthPx)}. It is the largest head diameter the video draws; there ` +
        `is no defensible default.`,
    );
  }

  const rawSvg = await readSvgFile(params.svgPath, "head mark plate");
  const themedSvg = themeHeadMarkSvg(rawSvg, {
    markBg: theme.colors.markBg,
    markFg: theme.colors.markFg,
  });
  const intrinsic = parseSvgIntrinsicSize(themedSvg);
  const height = Math.max(
    1,
    Math.round((params.widthPx * intrinsic.height) / intrinsic.width),
  );
  const size: MarkPlateSize = { width: params.widthPx, height };

  const spec: Record<string, JsonValue> = {
    kind: "business-hub-head-mark-plate",
    version: PLATE_SPEC_VERSION,
    theme: params.theme,
    width: size.width,
    height: size.height,
    markBg: theme.colors.markBg,
    markFg: theme.colors.markFg,
    svgSha256: createHash("sha256").update(rawSvg, "utf8").digest("hex"),
  };
  const key = computeCacheKey(spec);

  const result = await params.cache.withCache(key, spec, async (ctx) => {
    await rasteriseSvg({
      svgText: themedSvg,
      width: size.width,
      height: size.height,
      outputPath: ctx.suggestedOutputPath,
      workDir: params.workDir,
      context: `head mark plate (${themeName}, ${size.width}x${size.height})`,
      ...(params.executablePath === undefined
        ? {}
        : { executablePath: params.executablePath }),
    });
    return { filePath: ctx.suggestedOutputPath, sourceDurationFrames: 1 };
  });

  return { path: result.entry.filePath, key, hit: result.hit, size };
}
