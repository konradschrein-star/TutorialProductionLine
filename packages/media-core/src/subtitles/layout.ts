// ===========================================================================
// layout.ts — THE single numeric source of truth for BOTH caption engines.
//
// The Remotion renderer (packages/media-core/src/subtitles/remotion/*) and the
// ASS renderer (packages/media-core/src/subtitles/ass/*) must agree pixel-for-
// pixel on: type scale, safe-area margins, vertical placement, outline weight
// and which word is "active" at a given time. Every one of those decisions
// lives in THIS file, is pure, and is unit-tested. Neither engine is allowed to
// re-derive any of them locally.
//
// Background: before this module existed the two engines had disjoint config
// schemas and independently hardcoded their geometry, which is why the same
// content rendered through the two paths looked like two different products
// (different size, different margins, different line breaks, different — and
// inverted — word highlighting).
// ===========================================================================

import type { CaptionChunk, CaptionWord } from "./types.js";

// ---------------------------------------------------------------------------
// Type scale
// ---------------------------------------------------------------------------

/**
 * Reference canvas HEIGHT every px value in a preset is authored against.
 *
 * Caption legibility tracks frame HEIGHT, not width: a caption that reads well
 * is the same percentage of frame height at 16:9 and at 9:16. Authoring against
 * a fixed 1080-tall reference and scaling by `canvasHeight / 1080` is what lets
 * ONE preset be correct at 1920x1080, 3840x2160 and 1080x1920.
 */
export const DESIGN_HEIGHT = 1080;

/**
 * Recommended caption type size as a fraction of frame height.
 *
 * Broadcast/streaming practice puts caption cap-height at roughly 5-8% of
 * picture height; expressed as an em/font-size (cap height is ~0.7em for the
 * grotesques used here) that lands at ~5-6% of frame height. Below MIN it stops
 * being readable on a phone; above MAX two lines start eating the lower third.
 */
export const TYPE_SCALE_MIN_FRACTION = 0.038;
export const TYPE_SCALE_MAX_FRACTION = 0.085;

/** Design-px font size equivalent to a fraction of frame height. */
export function fractionToDesignPx(fraction: number): number {
  return Math.round(fraction * DESIGN_HEIGHT);
}

/**
 * Multiplier applied to every px value in a config for a given canvas.
 * Always 1 when the preset opts into `sizeMode: "absolute"`.
 */
export function computeCanvasScale(
  sizeMode: "canvasRelative" | "absolute",
  canvasHeight: number,
): number {
  if (sizeMode === "absolute") return 1;
  if (!Number.isFinite(canvasHeight) || canvasHeight <= 0) return 1;
  return canvasHeight / DESIGN_HEIGHT;
}

// ---------------------------------------------------------------------------
// Outline geometry — the mapping that made the two engines disagree
// ---------------------------------------------------------------------------

/**
 * CSS `-webkit-text-stroke` is a CENTRED stroke: a width of W paints W/2 outside
 * the glyph contour and W/2 inside. With `paint-order: stroke fill` the fill
 * repaints the inner half, so the VISIBLE outline is W/2.
 *
 * ASS `Outline` is a border drawn entirely OUTSIDE the glyph contour, so its
 * value already IS the visible thickness.
 *
 * Therefore an ASS outline must be HALF the configured CSS stroke width to look
 * the same. Getting this wrong is why the ASS engine's captions looked thin and
 * washed-out next to Remotion's at identical settings.
 */
export function cssStrokeToAssOutline(cssStrokeWidth: number): number {
  return Math.max(0, cssStrokeWidth) / 2;
}

/**
 * Visible outline thickness in design px, whichever engine renders it. Used by
 * both the parity tests and the ASS builder.
 */
export function visibleOutlineWidth(cssStrokeWidth: number): number {
  return cssStrokeToAssOutline(cssStrokeWidth);
}

// ---------------------------------------------------------------------------
// Safe area
// ---------------------------------------------------------------------------

export type VerticalAnchor = "bottom" | "center" | "top";

export interface VerticalPlacement {
  anchor: VerticalAnchor;
  /**
   * Distance from the anchored frame edge to the matching edge of the caption
   * BLOCK, as a percent of frame height. Ignored when anchor === "center".
   *
   * Both engines anchor on a block EDGE (ASS `\an2` + MarginV measures from the
   * frame bottom to the text bottom). The previous Remotion implementation
   * anchored the block CENTRE via `translateY(-50%)`, so a 1-line and a 2-line
   * caption sat at different heights and neither matched ASS. Edge-anchoring
   * fixes both problems at once.
   */
  marginPercent: number;
}

export interface PlacementConfig {
  positionPreset: "bottom" | "center" | "top" | "lowerThird" | "custom";
  /** Only consulted when positionPreset === "custom". Percent from the TOP. */
  positionY: number;
  /** Distance from the frame edge to the caption block, percent of height. */
  safeMarginPercent: number;
}

/**
 * Vertical placement for a config, shared by both engines.
 *
 * `bottom` is the default and sits `safeMarginPercent` up from the frame
 * bottom. Broadcast title-safe is 5% of height; captions are conventionally set
 * a little further in than that so they clear player chrome, and vertical-video
 * platforms overlay UI across the bottom ~15-20% of the frame — which is why
 * the shorts-oriented presets raise this number rather than the renderer
 * guessing from the aspect ratio.
 */
export function computeVerticalPlacement(
  config: PlacementConfig,
): VerticalPlacement {
  switch (config.positionPreset) {
    case "top":
      return { anchor: "top", marginPercent: config.safeMarginPercent };
    case "center":
      return { anchor: "center", marginPercent: 0 };
    case "lowerThird":
      return { anchor: "bottom", marginPercent: 25 };
    case "bottom":
      return { anchor: "bottom", marginPercent: config.safeMarginPercent };
    case "custom":
    default: {
      // positionY is measured from the TOP; convert to a bottom margin so both
      // engines use one model.
      const fromTop = Math.min(100, Math.max(0, config.positionY));
      return { anchor: "bottom", marginPercent: 100 - fromTop };
    }
  }
}

export interface HorizontalConfig {
  positionX: number;
  alignment: "left" | "center" | "right";
  maxWidthPercent: number;
}

/**
 * The widest the caption block may be, as a % of frame width, given its anchor
 * and alignment. `maxWidthPercent` is the ceiling; this only ever narrows it so
 * the block cannot extend past a frame edge.
 */
export function computeSafeMaxWidthPercent(config: HorizontalConfig): number {
  const requested = config.maxWidthPercent;
  const x = Math.min(100, Math.max(0, config.positionX));
  let available: number;
  switch (config.alignment) {
    case "left":
      available = 100 - x;
      break;
    case "right":
      available = x;
      break;
    case "center":
    default:
      available = 2 * Math.min(x, 100 - x);
      break;
  }
  return Math.max(5, Math.min(requested, available));
}

/**
 * ASS `MarginL` / `MarginR` in canvas px that reproduce `maxWidthPercent` for a
 * centred caption. libass wraps text inside `width - MarginL - MarginR`, so
 * matching the Remotion `max-width` means splitting the leftover evenly.
 */
export function computeAssSideMargins(
  config: HorizontalConfig,
  canvasWidth: number,
): { marginL: number; marginR: number } {
  const usable = computeSafeMaxWidthPercent(config) / 100;
  const slack = Math.max(0, (1 - usable) * canvasWidth);
  const half = Math.round(slack / 2);
  return { marginL: half, marginR: half };
}

// ---------------------------------------------------------------------------
// Active-word (karaoke) selection — shared by both engines
// ---------------------------------------------------------------------------

/**
 * Index of the "currently spoken" word inside a chunk at `timeSeconds`, or -1
 * before the chunk's first word starts.
 *
 * IMPORTANT — this deliberately does NOT use `[word.start, word.end)`.
 *
 * Whisper word timings leave real gaps between words (breaths, plosive onsets,
 * pauses). With a half-open per-word window, NO word is active during those
 * gaps, so a word highlight switches off and on many times per second. That
 * flicker was the single most visible "buggy / not fully dynamic" artefact in
 * the rendered captions.
 *
 * A word therefore stays active from its own start until the NEXT word starts
 * (and the last word stays active for the rest of the chunk). The highlight is
 * then continuous, which is also how every professional karaoke/word-reveal
 * caption behaves.
 */
export function activeWordIndex(
  words: readonly CaptionWord[],
  timeSeconds: number,
): number {
  if (words.length === 0) return -1;
  if (timeSeconds < words[0]!.start) return -1;
  let idx = 0;
  for (let i = 1; i < words.length; i++) {
    if (timeSeconds >= words[i]!.start) idx = i;
    else break;
  }
  return idx;
}

/**
 * The half-open time ranges over which each word is the active one, given the
 * rule above. The last word's range ends at `chunkEnd`. Used by the ASS builder
 * to emit one Dialogue per highlight step, and by the parity tests.
 */
export function activeWordRanges(
  chunk: CaptionChunk,
): Array<{ index: number; start: number; end: number }> {
  const out: Array<{ index: number; start: number; end: number }> = [];
  const { words } = chunk;
  for (let i = 0; i < words.length; i++) {
    const start = words[i]!.start;
    const end = i + 1 < words.length ? words[i + 1]!.start : chunk.end;
    if (end > start) out.push({ index: i, start, end });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading-speed / cue-duration guards
// ---------------------------------------------------------------------------

/**
 * Shortest time a caption may stay on screen. Streaming caption specs put the
 * minimum cue duration at around five-sixths of a second; anything shorter
 * reads as a flash rather than a caption. The chunker enforces this by merging
 * a too-short chunk into its neighbour, never by inventing timing.
 */
export const MIN_CUE_SECONDS = 5 / 6;

/** Longest a single caption should linger before it feels stuck. */
export const MAX_CUE_SECONDS = 7;

/**
 * Maximum characters per line before a caption becomes hard to scan. 42 is the
 * long-standing Latin-script subtitle convention (mixed case, regular weight).
 */
export const MAX_CHARS_PER_LINE = 42;

/** Maximum lines a caption should ever occupy. */
export const MAX_LINES = 2;

// ---------------------------------------------------------------------------
// Text width estimation — so the CHUNKER can wrap, not the renderers
// ---------------------------------------------------------------------------

// Why this exists.
//
// The chunker used to wrap by raw character count. Character count is a poor
// proxy for width: uppercase is ~35% wider than lowercase, and a heavy weight
// is wider again. A preset whose lines fit "42 characters" could still overflow
// its safe area once set in uppercase Montserrat Black — and when a line
// overflows, EACH RENDERER RE-WRAPS IT INDEPENDENTLY (Chrome by CSS, libass by
// WrapStyle). They then break at different words and the two engines visibly
// disagree, which is precisely the defect this subsystem was rebuilt to remove.
//
// So the chunker now wraps against an estimated width budget and emits explicit
// line breaks that BOTH engines follow verbatim. The estimate does not need to
// be exact — it needs to be conservative enough that neither renderer ever has
// to re-wrap.

/** Per-character advance widths in em, for a 400-weight grotesque. */
const NARROW = new Set("iljtfrI.,;:'`|!()[]{}-");
const WIDE = new Set("mwMW@%");

function advanceEm(ch: string): number {
  if (ch === " ") return 0.27;
  if (NARROW.has(ch)) return 0.31;
  if (WIDE.has(ch)) return 0.86;
  if (ch >= "A" && ch <= "Z") return 0.68;
  if (ch >= "0" && ch <= "9") return 0.58;
  return 0.53;
}

/**
 * Extra width a heavier weight adds. Going 400 -> 900 widens a grotesque by
 * roughly 15-18%; this is the linear approximation of that.
 */
function weightFactor(fontWeight: number): number {
  return 1 + ((Math.max(100, Math.min(900, fontWeight)) - 400) / 1000) * 0.35;
}

/** Estimated rendered width of `text`, in em of the caption's font size. */
export function estimateTextWidthEm(text: string, fontWeight = 400): number {
  let sum = 0;
  for (const ch of text) sum += advanceEm(ch);
  return sum * weightFactor(fontWeight);
}

/** The frame a plan is being built for. Both engines derive geometry from it. */
export interface FrameSize {
  width: number;
  height: number;
}

/**
 * How wide one caption line may be, expressed in em of the caption's own font
 * size, for a given frame.
 *
 * Because px in a preset are authored against DESIGN_HEIGHT and scaled by
 * `height / DESIGN_HEIGHT`, this budget depends only on the frame's ASPECT
 * RATIO, not its resolution — a 1080p and a 4K landscape frame get the same
 * budget, which is why one plan can serve both.
 *
 * Returns Infinity when no frame is supplied, which reproduces the old
 * count-only wrapping (used by unit tests and the aspect-agnostic editor).
 */
export function lineWidthBudgetEm(
  config: {
    fontSize: number;
    maxWidthPercent: number;
    sizeMode: "canvasRelative" | "absolute";
  },
  frame?: FrameSize,
): number {
  if (!frame || !(frame.width > 0) || !(frame.height > 0)) return Infinity;
  const scale = computeCanvasScale(config.sizeMode, frame.height);
  const fontPx = config.fontSize * scale;
  if (!(fontPx > 0)) return Infinity;
  const usablePx = (config.maxWidthPercent / 100) * frame.width;
  // 0.94 keeps a margin for estimation error, so a line that this says fits
  // really does fit and no renderer re-wraps it.
  return (usablePx / fontPx) * 0.94;
}
