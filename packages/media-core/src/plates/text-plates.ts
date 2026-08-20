/**
 * BUSINESS_PLAN_HUB — scene copy plates.
 *
 * A full-frame transparent PNG carrying one scene's eyebrow / headline / body,
 * composited by FFmpeg at `x:0, y:0` over the ground
 * (`business-hub.ts:1660-1670`). Only non-`mg` scenes need one: a motion-graphic
 * island draws its own type inside Remotion.
 *
 * ## Why the browser lays it out and we do not
 *
 * Wrapping is the whole problem. FFmpeg's `drawtext` cannot wrap, and estimating
 * line breaks from character counts is exactly the kind of invented pipeline data
 * this format's rules forbid. So the copy is laid out by Chromium at the real
 * size, in the real font stack, and the page MEASURES ITSELF and hands the
 * numbers back. Those measurements are what {@link bakeTextPlate} decides on.
 *
 * ## The fail-closed part
 *
 * If the laid-out copy does not fit the box the layout gives it, this module
 * THROWS, naming the scene, the slot sizes, the box and the overflow. It does
 * not clip (the tail of a sentence would silently disappear from a published
 * video) and it does not shrink the type (below 18px at 1080p the copy is
 * unreadable at 360p, which is where these videos are actually watched). The
 * correct fix is upstream: shorten the copy or change the layout.
 */

import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { JsonValue } from "../cache/canonical-json.js";
import { computeCacheKey, type SegmentCache } from "../cache/segment-cache.js";
import {
  buildPlateHtml,
  escapeHtml,
  rasterisePlate,
  type PlateMetrics,
} from "./rasterize.js";
import type { BakedPlate } from "./ground-plates.js";
import {
  HEADLINE_MAX_CHARS,
  PLATE_FONT_FAMILY,
  PLATE_LETTER_SPACING,
  PLATE_LINE_HEIGHT,
  PLATE_LOG_PREFIX,
  PLATE_SAFE_MARGIN_PX,
  PLATE_SPEC_VERSION,
  PLATE_TYPE_SCALE,
  PlateError,
  assertAspectMatchesCanvas,
  assertCanvasSize,
  assertLegible,
  getPlateTheme,
  scaleFor1080,
  themeForGround,
  type GroundThemeSlug,
  type TextPlateBox,
} from "./types.js";

/** The scene kinds that get a copy plate. `mg` draws its own type in Remotion. */
export type TextPlateSceneKind =
  | "broll"
  | "title"
  | "chapter"
  | "presenter-solo";

/** Which side of the frame the presenter stands on, when there is one. */
export type TextPlatePresenterSide = "left" | "right" | "center";

/** The copy a scene puts on screen. At least one slot must be present. */
export interface TextPlateCopy {
  eyebrow?: string;
  headline?: string;
  body?: string;
}

/** The minimal scene facts a copy plate is a function of. */
export interface TextPlateScene {
  /** Scene id — the key the render looks the plate up by, and the diagnostic's subject. */
  id: string;
  /** Scene beat slug, for diagnostics only. */
  beat: string;
  kind: TextPlateSceneKind;
  copy: TextPlateCopy;
  /** Omit when the scene places no presenter. */
  presenterSide?: TextPlatePresenterSide;
}

/**
 * Type sizes for one scene's three copy slots, in px AT 1080p.
 *
 * A type alias rather than an interface so it carries an implicit index
 * signature and is therefore assignable to `JsonValue` — it goes straight into
 * the cache spec, and a spec that is not JSON is not auditable.
 */
export type TextPlateTypeSizes = {
  eyebrow: number;
  headline: number;
  body: number;
};

/**
 * Type sizes per scene kind.
 *
 * A title card carries the hero size; a chapter break the display size; a
 * `broll` lower third and a presenter-solo caption are smaller because the frame
 * is already carrying footage or a figure. All three slots are above the
 * {@link assertLegible} floor by construction — the assertion still runs, because
 * this table is exactly the kind of thing a later "just make it fit" edit
 * touches.
 *
 * @throws {PlateError} On an unknown scene kind (exhaustive `switch`).
 */
export function typeSizesForKind(kind: TextPlateSceneKind): TextPlateTypeSizes {
  switch (kind) {
    case "title":
      return {
        eyebrow: PLATE_TYPE_SCALE.label,
        headline: PLATE_TYPE_SCALE.hero,
        body: PLATE_TYPE_SCALE.bodyLead,
      };
    case "chapter":
      return {
        eyebrow: PLATE_TYPE_SCALE.label,
        headline: PLATE_TYPE_SCALE.display,
        body: PLATE_TYPE_SCALE.body,
      };
    case "broll":
      return {
        eyebrow: PLATE_TYPE_SCALE.caption,
        headline: PLATE_TYPE_SCALE.subhead,
        body: PLATE_TYPE_SCALE.body,
      };
    case "presenter-solo":
      return {
        eyebrow: PLATE_TYPE_SCALE.label,
        headline: PLATE_TYPE_SCALE.headline,
        body: PLATE_TYPE_SCALE.body,
      };
    default: {
      const exhaustive: never = kind;
      throw new PlateError(
        `${PLATE_LOG_PREFIX} typeSizesForKind: unhandled scene kind ` +
          `${JSON.stringify(exhaustive)}.`,
      );
    }
  }
}

/**
 * The rectangle a scene's copy is allowed to occupy, in output pixels.
 *
 * A type alias for the same reason as {@link TextPlateTypeSizes}: it is part of
 * the cache spec and must be assignable to `JsonValue`.
 */
export type TextPlateLayoutBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Where a scene's copy goes.
 *
 * PURE and unit-tested. Two rules decide it:
 *
 *  - The presenter owns his side of the frame, so the copy takes the other one.
 *    A `left` presenter pushes copy right and vice versa; `center` (and no
 *    presenter at all) gets the full column.
 *  - The vertical band follows the scene kind: title and chapter cards centre,
 *    a `broll` scene sits in the lower third so the footage reads above it, and
 *    a `presenter-solo` caption sits high because the figure occupies the bottom.
 *
 * Everything is expressed against the 1080p safe margin scaled to the real
 * canvas, so 16:9 and the 9:16 repurpose share one implementation.
 *
 * @throws {PlateError} If the canvas is unusable, or the resulting box is empty
 *   (a canvas too small to carry a safe margin at all).
 */
export function resolveTextBox(params: {
  kind: TextPlateSceneKind;
  presenterSide?: TextPlatePresenterSide;
  width: number;
  height: number;
}): TextPlateLayoutBox {
  assertCanvasSize(params.width, params.height, "copy plate");
  const margin = scaleFor1080(PLATE_SAFE_MARGIN_PX, params.height);
  const usableWidth = params.width - margin * 2;
  const usableHeight = params.height - margin * 2;
  if (usableWidth <= 0 || usableHeight <= 0) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} copy plate: a ${params.width}x${params.height} canvas cannot ` +
        `carry the ${PLATE_SAFE_MARGIN_PX}px safe margin (scaled: ${margin.toFixed(1)}px).`,
    );
  }

  // The presenter owns his half of the frame. The copy column is the other half
  // minus a gutter, so type never runs under the figure and never crosses the
  // centre line towards him.
  const columnWidth =
    params.presenterSide === "left" || params.presenterSide === "right"
      ? usableWidth * 0.46
      : usableWidth;
  const x =
    params.presenterSide === "left"
      ? params.width - margin - columnWidth
      : margin;

  const band = verticalBand(params.kind, params.height, margin);

  return {
    x: round2(x),
    y: round2(band.y),
    width: round2(columnWidth),
    height: round2(band.height),
  };
}

function verticalBand(
  kind: TextPlateSceneKind,
  height: number,
  margin: number,
): { y: number; height: number } {
  switch (kind) {
    case "title":
    case "chapter":
      // Centred band: the card IS the copy.
      return { y: height * 0.26, height: height * 0.48 };
    case "broll":
      // Lower third: the footage is the subject, the copy annotates it.
      return { y: height * 0.58, height: height * 0.42 - margin };
    case "presenter-solo":
      // Upper band: the figure occupies the bottom of the frame.
      return { y: margin, height: height * 0.46 };
    default: {
      const exhaustive: never = kind;
      throw new PlateError(
        `${PLATE_LOG_PREFIX} resolveTextBox: unhandled scene kind ` +
          `${JSON.stringify(exhaustive)}.`,
      );
    }
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Assert a scene's copy is within the typographic contract before any browser
 * is started.
 *
 * Checks, all from build brief §6:
 *  - at least one slot carries text (an empty plate is a workflow bug, not a plate);
 *  - the headline is within {@link HEADLINE_MAX_CHARS};
 *  - every slot in use is above the legibility floor.
 *
 * @returns The type sizes for the scene's kind.
 * @throws {PlateError} On any violation, naming the scene and the number.
 */
export function assertCopyTypography(
  scene: TextPlateScene,
): TextPlateTypeSizes {
  const where = `scene "${scene.id}" (${scene.beat})`;
  const { eyebrow, headline, body } = scene.copy;
  const present = [eyebrow, headline, body].filter(
    (slot): slot is string =>
      typeof slot === "string" && slot.trim().length > 0,
  );
  if (present.length === 0) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} ${where}: asked for a copy plate but carries no eyebrow, ` +
        `headline or body. An empty plate would composite an invisible layer and hide ` +
        `the fact that the scene lost its copy.`,
    );
  }

  if (headline !== undefined && headline.length > HEADLINE_MAX_CHARS) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} ${where}: headline is ${headline.length} characters, over the ` +
        `${HEADLINE_MAX_CHARS}-character budget (build brief §6). It will not fit at 1080p. ` +
        `Shorten it upstream — the plate is not typeset smaller to compensate.\n` +
        `  headline: ${JSON.stringify(headline)}`,
    );
  }

  const sizes = typeSizesForKind(scene.kind);
  if (eyebrow !== undefined) assertLegible(sizes.eyebrow, `${where} eyebrow`);
  if (headline !== undefined)
    assertLegible(sizes.headline, `${where} headline`);
  if (body !== undefined) assertLegible(sizes.body, `${where} body`);
  return sizes;
}

/** Identity of one copy plate. Hashed to the cache key; also the audit record. */
export interface TextPlateSpec extends Record<string, JsonValue> {
  kind: "business-hub-text-plate";
  version: number;
  sceneKind: TextPlateSceneKind;
  theme: string;
  aspect: string;
  width: number;
  height: number;
  copy: {
    eyebrow: string | null;
    headline: string | null;
    body: string | null;
  };
  sizes: { eyebrow: number; headline: number; body: number };
  box: { x: number; y: number; width: number; height: number };
}

/**
 * The cache identity of a copy plate.
 *
 * Deliberately NOT keyed on the scene id: two videos in the keyword matrix that
 * open on the same headline in the same layout produce the same pixels, and
 * should share one file. The scene id travels separately, as the key of
 * `assets.textPlates` and as the subject of every diagnostic.
 *
 * @throws {PlateError} From the typography and canvas assertions.
 */
export function textPlateSpec(params: {
  scene: TextPlateScene;
  theme: GroundThemeSlug;
  aspect: string;
  width: number;
  height: number;
}): TextPlateSpec {
  themeForGround(params.theme, `scene "${params.scene.id}" copy plate`);
  assertCanvasSize(
    params.width,
    params.height,
    `scene "${params.scene.id}" copy plate`,
  );
  assertAspectMatchesCanvas(
    params.aspect,
    params.width,
    params.height,
    `scene "${params.scene.id}" copy plate`,
  );
  const sizes = assertCopyTypography(params.scene);
  const box = resolveTextBox({
    kind: params.scene.kind,
    ...(params.scene.presenterSide === undefined
      ? {}
      : { presenterSide: params.scene.presenterSide }),
    width: params.width,
    height: params.height,
  });

  return {
    kind: "business-hub-text-plate",
    version: PLATE_SPEC_VERSION,
    sceneKind: params.scene.kind,
    theme: params.theme,
    aspect: params.aspect,
    width: params.width,
    height: params.height,
    copy: {
      eyebrow: params.scene.copy.eyebrow ?? null,
      headline: params.scene.copy.headline ?? null,
      body: params.scene.copy.body ?? null,
    },
    sizes,
    box,
  };
}

/**
 * The HTML for one copy plate.
 *
 * PURE, and unit-tested. Every user string goes through {@link escapeHtml}: the
 * copy comes from a language model, and an unescaped `<` would silently eat the
 * rest of the headline.
 *
 * The measure script reports the block's real laid-out size, which is what
 * {@link bakeTextPlate} tests against the box.
 */
export function buildTextPlateHtml(params: {
  scene: TextPlateScene;
  theme: GroundThemeSlug;
  width: number;
  height: number;
}): string {
  const theme = getPlateTheme(
    themeForGround(params.theme, `scene "${params.scene.id}" copy plate`),
  );
  const sizes = assertCopyTypography(params.scene);
  const box = resolveTextBox({
    kind: params.scene.kind,
    ...(params.scene.presenterSide === undefined
      ? {}
      : { presenterSide: params.scene.presenterSide }),
    width: params.width,
    height: params.height,
  });

  const px = (at1080: number): string =>
    `${scaleFor1080(at1080, params.height).toFixed(2)}px`;

  const css = `
  #bh-box {
    position: absolute;
    left: ${box.x}px;
    top: ${box.y}px;
    width: ${box.width}px;
    height: ${box.height}px;
    display: flex;
    align-items: ${params.scene.kind === "broll" ? "flex-end" : "center"};
  }
  #bh-copy {
    width: 100%;
    text-shadow: ${theme.colors.copyShadow};
  }
  .bh-eyebrow {
    font-family: ${PLATE_FONT_FAMILY.mono};
    font-size: ${px(sizes.eyebrow)};
    line-height: ${PLATE_LINE_HEIGHT.caption};
    letter-spacing: ${px(PLATE_LETTER_SPACING.eyebrow)};
    text-transform: uppercase;
    font-weight: 500;
    color: ${theme.colors.textMuted};
    margin: 0 0 ${px(14)} 0;
  }
  .bh-headline {
    font-family: ${PLATE_FONT_FAMILY.serif};
    font-size: ${px(sizes.headline)};
    line-height: ${PLATE_LINE_HEIGHT.headline};
    letter-spacing: ${px(PLATE_LETTER_SPACING.headline)};
    font-weight: 600;
    color: ${theme.colors.textPrimary};
    margin: 0;
    /* Wrapping is the point of using a browser; a word that cannot wrap must
       widen the block so the overflow check catches it, not be broken silently. */
    overflow-wrap: normal;
  }
  .bh-body {
    font-family: ${PLATE_FONT_FAMILY.sans};
    font-size: ${px(sizes.body)};
    line-height: ${PLATE_LINE_HEIGHT.body};
    letter-spacing: ${px(PLATE_LETTER_SPACING.body)};
    font-weight: 400;
    color: ${theme.colors.textSecondary};
    margin: ${px(20)} 0 0 0;
  }`;

  const parts: string[] = [];
  if (params.scene.copy.eyebrow !== undefined) {
    parts.push(
      `<p class="bh-eyebrow">${escapeHtml(params.scene.copy.eyebrow)}</p>`,
    );
  }
  if (params.scene.copy.headline !== undefined) {
    parts.push(
      `<h1 class="bh-headline">${escapeHtml(params.scene.copy.headline)}</h1>`,
    );
  }
  if (params.scene.copy.body !== undefined) {
    parts.push(`<p class="bh-body">${escapeHtml(params.scene.copy.body)}</p>`);
  }

  return buildPlateHtml({
    width: params.width,
    height: params.height,
    css,
    body: `<div id="bh-box"><div id="bh-copy">${parts.join("")}</div></div>`,
    measureScript: `
    var box = document.getElementById('bh-box');
    var copy = document.getElementById('bh-copy');
    var r = copy.getBoundingClientRect();
    metrics = {
      boxWidth: ${box.width},
      boxHeight: ${box.height},
      usedWidth: Math.max(r.width, copy.scrollWidth),
      usedHeight: Math.max(r.height, copy.scrollHeight),
      boxScrollHeight: box.scrollHeight
    };`,
  });
}

/** Inputs to {@link bakeTextPlate}. */
export interface BakeTextPlateParams {
  scene: TextPlateScene;
  theme: GroundThemeSlug;
  aspect: string;
  width: number;
  height: number;
  cache: SegmentCache;
  workDir: string;
  executablePath?: string;
}

/** A baked copy plate and the box its copy actually filled. */
export interface BakedTextPlate extends BakedPlate {
  box: TextPlateBox;
}

/**
 * Bake (or reuse) one scene's copy plate.
 *
 * @returns The plate path, its cache key, whether it was a hit, and the box the
 *   copy occupies (measured by the browser, never estimated).
 * @throws {PlateError} If the copy violates the typographic contract, if the
 *   laid-out copy overflows its box, or if the rasterisation fails. On overflow
 *   nothing is committed to the cache — the plate is simply not produced.
 */
export async function bakeTextPlate(
  params: BakeTextPlateParams,
): Promise<BakedTextPlate> {
  const spec = textPlateSpec({
    scene: params.scene,
    theme: params.theme,
    aspect: params.aspect,
    width: params.width,
    height: params.height,
  });
  const key = computeCacheKey(spec);
  const html = buildTextPlateHtml({
    scene: params.scene,
    theme: params.theme,
    width: params.width,
    height: params.height,
  });
  const where = `scene "${params.scene.id}" (${params.scene.beat}) copy plate`;

  const rasterise = async (outputPath: string, context: string) => {
    const raster = await rasterisePlate({
      html,
      outputPath,
      width: params.width,
      height: params.height,
      workDir: params.workDir,
      context,
      ...(params.executablePath === undefined
        ? {}
        : { executablePath: params.executablePath }),
      expectAlpha: true,
    });
    return interpretMetrics(raster.metrics, spec.box, where);
  };

  // The cache is used through `lookup`/`store` rather than `withCache` because
  // this plate produces TWO things: the PNG (content-addressed, shared across
  // videos) and its measured box (needed by the caller on a hit as well as on a
  // miss). Racing writers are still handled — `store` returns the winner's entry
  // rather than overwriting.
  const existing = await params.cache.lookup(key);
  if (existing !== null) {
    const boxPath = `${existing.filePath}.box.json`;
    // The plate itself is already correct: the same spec produced it. Only the
    // measurements have to be recovered, and they are RE-MEASURED rather than
    // guessed when the sidecar is missing.
    const recorded = await readBoxSidecar(boxPath);
    if (recorded !== null) {
      return { path: existing.filePath, key, hit: true, box: recorded };
    }
    const scratch = join(params.workDir, `remeasure-${key.slice(0, 12)}.png`);
    try {
      const box = await rasterise(
        scratch,
        `${where} (re-measure of cached plate ${key})`,
      );
      await writeBoxSidecar(boxPath, box);
      return { path: existing.filePath, key, hit: true, box };
    } finally {
      await rm(scratch, { force: true }).catch(() => {});
    }
  }

  const staged = join(params.workDir, `${key}.png`);
  try {
    const box = await rasterise(staged, where);
    const entry = await params.cache.store(key, staged, {
      spec,
      sourceDurationFrames: 1,
    });
    await writeBoxSidecar(`${entry.filePath}.box.json`, box);
    return { path: entry.filePath, key, hit: false, box };
  } finally {
    await rm(staged, { force: true }).catch(() => {});
  }
}

/**
 * Turn the browser's self-measurement into a box, or refuse the plate.
 *
 * @throws {PlateError} If the page reported nothing (its script never ran, so
 *   nothing about the layout is known), or if the copy is wider or taller than
 *   the box it was given.
 */
export function interpretMetrics(
  metrics: PlateMetrics | null,
  box: { x: number; y: number; width: number; height: number },
  where: string,
): TextPlateBox {
  if (metrics === null) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} ${where}: the page reported no layout measurements, so whether ` +
        `the copy fits is unknown. A plate is never accepted on the assumption that it fits.`,
    );
  }
  const usedWidth = requireNumber(metrics["usedWidth"], "usedWidth", where);
  const usedHeight = requireNumber(metrics["usedHeight"], "usedHeight", where);

  // Half a pixel of slack: sub-pixel layout means an exactly-fitting block can
  // measure 0.0001px over its container.
  const slack = 0.5;
  if (usedHeight > box.height + slack || usedWidth > box.width + slack) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} ${where}: the copy does not fit its box. Laid out it needs ` +
        `${usedWidth.toFixed(1)}x${usedHeight.toFixed(1)}px; the box is ` +
        `${box.width.toFixed(1)}x${box.height.toFixed(1)}px at (${box.x.toFixed(1)}, ` +
        `${box.y.toFixed(1)}). The plate is NOT clipped and the type is NOT shrunk below the ` +
        `legibility floor — shorten the copy or move the beat to a layout with more room.`,
    );
  }

  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    usedWidth: Math.ceil(usedWidth),
    usedHeight: Math.ceil(usedHeight),
  };
}

function requireNumber(value: unknown, field: string, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} ${where}: the page's measurement is missing a finite ` +
        `"${field}" (received ${JSON.stringify(value)}).`,
    );
  }
  return value;
}

/**
 * Read the measured box recorded beside a cached plate.
 *
 * @returns The box, or `null` when the sidecar is absent or unusable. `null`
 *   means "re-measure", never "assume".
 */
async function readBoxSidecar(path: string): Promise<TextPlateBox | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const fields = [
      "x",
      "y",
      "width",
      "height",
      "usedWidth",
      "usedHeight",
    ] as const;
    const out: Record<string, number> = {};
    for (const field of fields) {
      const value = record[field];
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      out[field] = value;
    }
    return out as unknown as TextPlateBox;
  } catch {
    return null;
  }
}

/** Record the measured box beside the plate. A failure here is not fatal. */
async function writeBoxSidecar(path: string, box: TextPlateBox): Promise<void> {
  try {
    await writeFile(path, `${JSON.stringify(box, null, 2)}\n`, "utf8");
  } catch (err) {
    console.warn(
      `${PLATE_LOG_PREFIX} could not record the measured copy box at ${path}: ` +
        `${err instanceof Error ? err.message : String(err)} (the plate itself is committed; ` +
        `the box will be re-measured on the next job that reuses it)`,
    );
  }
}
