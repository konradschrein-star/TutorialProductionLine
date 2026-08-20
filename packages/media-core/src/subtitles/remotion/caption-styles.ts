// ===========================================================================
// caption-styles.ts — PURE, framework-free visual math for the Remotion
// <Captions> renderer. NO React runtime dependency (the CSSProperties import is
// type-only and erased at build). Every deterministic style decision lives here
// so it can be unit-tested without a Remotion/React context; the .tsx files are
// thin wrappers that call these helpers and layer on Remotion timing.
//
// Spec: docs/superpowers/specs/2026-07-26-global-subtitle-system-design.md §4.1
// ===========================================================================

import type { CSSProperties } from "react";
import type { RemotionSubtitleConfig } from "@repo/db";
import type { CaptionWord, CaptionPlan } from "../types.js";
import {
  DESIGN_HEIGHT,
  computeCanvasScale as computeCanvasScaleShared,
  computeSafeMaxWidthPercent as computeSafeMaxWidthPercentShared,
  computeVerticalPlacement,
} from "../layout.js";

type ShadowConfig = RemotionSubtitleConfig["shadow"];
type BackgroundConfig = RemotionSubtitleConfig["background"];

/** Number of stacked text-shadow layers emitted when the shadow is enabled. */
export const SHADOW_LAYER_COUNT = 5;

export { DESIGN_HEIGHT };

/**
 * Multiplier applied to every px value in the config for a given canvas.
 * Thin wrapper over the shared layout module so BOTH engines scale identically.
 */
export function computeCanvasScale(
  config: Pick<RemotionSubtitleConfig, "sizeMode">,
  canvasHeight: number,
): number {
  return computeCanvasScaleShared(config.sizeMode, canvasHeight);
}

/** Secondary-role words render at this fraction of the base font size. */
const SECONDARY_SIZE_SCALE = 0.85;
/** Secondary-role words render at this opacity (reduced emphasis). */
const SECONDARY_OPACITY = 0.85;

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

/**
 * Convert a #RGB / #RRGGBB hex string to an `rgba(r, g, b, a)` CSS string.
 * Non-hex inputs are returned as-is with no alpha (best-effort; callers pass hex).
 */
function hexToRgba(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) {
    return hex;
  }
  let h = m[1];
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // Trim to 3 decimals to keep output stable/testable.
  const alphaStr = Number(a.toFixed(3)).toString();
  return `rgba(${r}, ${g}, ${b}, ${alphaStr})`;
}

// ---------------------------------------------------------------------------
// computeShadowLayers
// ---------------------------------------------------------------------------

/**
 * Dissipation profile across the stacked shadow layers. `t` runs 0 (closest,
 * fully opaque) → 1 (farthest). Returns a 0..1 multiplier that starts at 1 and
 * decays toward 0, shaped by the chosen curve. Distinct shapes per curve.
 */
function dissipation(t: number, curve: ShadowConfig["curve"]): number {
  const clamped = Math.max(0, Math.min(1, t));
  switch (curve) {
    case "linear":
      return 1 - clamped;
    case "easeOut":
      // Drops fast early then trails off.
      return Math.pow(1 - clamped, 3);
    case "easeIn":
      // Holds high then drops steeply near the end.
      return 1 - Math.pow(clamped, 3);
    case "gaussian":
      // Bell-shaped falloff.
      return Math.exp(-Math.pow(clamped * 2, 2));
    default: {
      const _exhaustive: never = curve;
      return 1 - clamped;
    }
  }
}

/**
 * Turn a shadow config into a CSS `text-shadow` value made of
 * SHADOW_LAYER_COUNT stacked layers whose opacity dissipates along `curve`.
 * `strength` (0..1) scales every layer's opacity. Returns 'none' when the
 * shadow is effectively disabled (strength <= 0).
 */
export function computeShadowLayers(shadow: ShadowConfig, scale = 1): string {
  if (!shadow || shadow.strength <= 0) {
    return "none";
  }
  const layers: string[] = [];
  const denom = SHADOW_LAYER_COUNT - 1 || 1;
  for (let i = 0; i < SHADOW_LAYER_COUNT; i++) {
    const t = i / denom; // 0 (closest) .. 1 (farthest)
    const opacity = shadow.strength * dissipation(t, shadow.curve);
    // Outer layers spread further: blur grows with `size` across the stack.
    const layerBlur = (shadow.blur + shadow.size * t) * scale;
    const ox = shadow.offsetX * scale;
    const oy = shadow.offsetY * scale;
    layers.push(
      `${ox}px ${oy}px ${Number(layerBlur.toFixed(3))}px ${hexToRgba(
        shadow.color,
        opacity,
      )}`,
    );
  }
  return layers.join(", ");
}

// ---------------------------------------------------------------------------
// computeWordVariance
// ---------------------------------------------------------------------------

/** Max extra entrance delay (frames) applied to a word when variants are on. */
const VARIANCE_MAX_DELAY_FRAMES = 3;
/** Max absolute scale jitter applied to a word when variants are on. */
const VARIANCE_MAX_SCALE_JITTER = 0.05;

/**
 * Deterministic per-word timing/scale variance (spec §4.1 "+ variants"). Keyed
 * purely by `wordIndex` so renders are 100% reproducible — NO Math.random. Uses
 * two decorrelated sine hashes to spread values across the word sequence.
 *
 * - disabled → `{ delayFrames: 0, scaleJitter: 0 }` (behavior unchanged).
 * - enabled  → `delayFrames` in [0, VARIANCE_MAX_DELAY_FRAMES],
 *              `scaleJitter` in [-VARIANCE_MAX_SCALE_JITTER, +…].
 */
export function computeWordVariance(
  wordIndex: number,
  enabled: boolean,
): { delayFrames: number; scaleJitter: number } {
  if (!enabled) {
    return { delayFrames: 0, scaleJitter: 0 };
  }
  // Two large irrational multipliers → decorrelated pseudo-random-looking
  // sequences. fract(sin(i * k)) is a classic deterministic hash in [0, 1).
  const hash = (i: number, k: number): number => {
    const s = Math.sin(i * k) * 43758.5453;
    return s - Math.floor(s); // fractional part → [0, 1)
  };

  const d = hash(wordIndex + 1, 12.9898);
  const j = hash(wordIndex + 1, 78.233);

  const delayFrames = Math.round(d * VARIANCE_MAX_DELAY_FRAMES);
  // Map [0,1) → [-1, 1) then scale.
  const scaleJitter = (j * 2 - 1) * VARIANCE_MAX_SCALE_JITTER;

  return { delayFrames, scaleJitter };
}

// ---------------------------------------------------------------------------
// computeWordStyle
// ---------------------------------------------------------------------------

/**
 * Resolve the CSS for a single caption word. `word.word` is already the final
 * display text (textCase/punctuation applied upstream by the brain). `isActive`
 * means the current time falls within [word.start, word.end).
 *
 * Note: the active-word SCALE is a spring animation applied in <CaptionWord>;
 * this helper only owns the deterministic active-word COLOR override.
 */
export function computeWordStyle(
  word: CaptionWord,
  config: RemotionSubtitleConfig,
  isActive: boolean,
  /** Canvas scale from computeCanvasScale(); 1 keeps the authored px. */
  scale = 1,
): CSSProperties {
  const isKeyword = word.role === "keyword";
  const isSecondary = word.role === "secondary" && config.secondaryFont != null;

  // Font family / weight / size.
  let fontFamily = config.fontFamily;
  let fontWeight: number = config.fontWeight;
  let fontSize: number = config.fontSize;

  if (isSecondary && config.secondaryFont) {
    fontFamily = config.secondaryFont.fontFamily;
    fontWeight = config.secondaryFont.fontWeight;
    fontSize = Math.round(config.fontSize * SECONDARY_SIZE_SCALE);
  }

  if (isKeyword && config.keyword.bold) {
    fontWeight = Math.max(fontWeight, 700);
  }

  // Color resolution.
  let color: string;
  if (isKeyword) {
    color = word.keywordColor ?? config.keyword.colors[0] ?? config.fontColor;
  } else {
    color = config.fontColor;
  }
  // Active-word color override (deterministic; scale handled in the component).
  if (isActive && config.animation.activeWordColor) {
    color = config.animation.activeWordColor;
  }

  const style: CSSProperties = {
    display: "inline-block",
    fontFamily,
    fontWeight,
    fontSize: fontSize * scale,
    color,
    lineHeight: 1.2,
    whiteSpace: "pre",
  };

  if (isSecondary) {
    style.opacity = SECONDARY_OPACITY;
  }

  if (isKeyword && config.keyword.italic) {
    style.fontStyle = "italic";
  }

  if (isKeyword && config.keyword.background) {
    style.backgroundColor = config.keyword.background;
  }

  // Stroke via -webkit-text-stroke + paintOrder so the fill sits on top.
  if (config.stroke.width > 0) {
    (style as Record<string, unknown>).WebkitTextStroke =
      `${config.stroke.width * scale}px ${config.stroke.color}`;
    style.paintOrder = "stroke fill";
  }

  const shadow = computeShadowLayers(config.shadow, scale);
  if (shadow !== "none") {
    style.textShadow = shadow;
  }

  return style;
}

// ---------------------------------------------------------------------------
// computeContainerPosition
// ---------------------------------------------------------------------------

/**
 * Absolute-position the caption block.
 *
 * The block is anchored on an EDGE (bottom/top), never on its centre. libass
 * anchors on an edge too (`\an2` + MarginV measures frame-bottom to text-
 * bottom), so edge-anchoring is what lets the two engines land in the same
 * place. It also fixes a defect in its own right: with the previous
 * `top: 85%; translateY(-50%)` centre-anchoring, a one-line and a two-line
 * caption sat at DIFFERENT heights, so the captions visibly jumped up and down
 * as the line count changed.
 */
export function computeContainerPosition(
  config: RemotionSubtitleConfig,
): CSSProperties {
  const placement = computeVerticalPlacement({
    positionPreset: config.positionPreset,
    positionY: config.positionY,
    safeMarginPercent: config.safeMarginPercent,
  });

  const vertical: CSSProperties =
    placement.anchor === "center"
      ? { top: "50%", transform: "translateY(-50%)" }
      : placement.anchor === "top"
        ? { top: `${placement.marginPercent}%` }
        : { bottom: `${placement.marginPercent}%` };

  // Horizontal: translate depends on text alignment so the anchor sits sensibly.
  let translateX: string;
  let alignItems: CSSProperties["alignItems"];
  switch (config.alignment) {
    case "left":
      translateX = "0%";
      alignItems = "flex-start";
      break;
    case "right":
      translateX = "-100%";
      alignItems = "flex-end";
      break;
    case "center":
    default:
      translateX = "-50%";
      alignItems = "center";
      break;
  }

  const transform =
    placement.anchor === "center"
      ? `translate(${translateX}, -50%)`
      : `translateX(${translateX})`;

  return {
    position: "absolute",
    left: `${config.positionX}%`,
    ...vertical,
    transform,
    textAlign: config.alignment,
    display: "flex",
    flexDirection: "column",
    alignItems,
    // Safe area — an EXPLICIT width, not a max-width.
    //
    // This box is absolutely positioned with `left` set and `right` auto. With
    // `width: auto` that makes it shrink-to-fit, and CSS defines the available
    // space for a shrink-to-fit box as (containing block width - left). At the
    // default centred anchor of left: 50% that is HALF the frame — so a caption
    // whose safe area is 82% of the frame was silently being wrapped at 50%,
    // and `max-width: 82%` never came into play because the box could never get
    // that wide in the first place.
    //
    // libass, meanwhile, wraps at the real safe width (frame - MarginL -
    // MarginR), so the two engines broke lines in different places and at
    // different line counts. Setting the width explicitly removes shrink-to-fit
    // and makes the two agree. `computeSafeMaxWidthPercent` already narrows the
    // value for off-centre anchors, so it is safe to apply directly.
    width: `${computeSafeMaxWidthPercent(config)}%`,
    boxSizing: "border-box",
    pointerEvents: "none",
  };
}

/**
 * The widest the caption box may be (as a % of frame width) so that, given its
 * anchor (`positionX`) and `alignment`, it cannot extend past either frame
 * edge. Delegates to the shared layout module — the ASS engine derives its
 * `MarginL`/`MarginR` from the very same number.
 */
export function computeSafeMaxWidthPercent(
  config: Pick<
    RemotionSubtitleConfig,
    "positionX" | "alignment" | "maxWidthPercent"
  >,
): number {
  return computeSafeMaxWidthPercentShared(config);
}

// ---------------------------------------------------------------------------
// computeBackgroundStyle
// ---------------------------------------------------------------------------

/**
 * The caption pill. When disabled, contributes no color and zero padding so the
 * words sit bare. Padding is `${paddingY}px ${paddingX}px`.
 */
export function computeBackgroundStyle(
  background: BackgroundConfig,
  /** Canvas scale from computeCanvasScale(); 1 keeps the authored px. */
  scale = 1,
): CSSProperties {
  if (!background || !background.enabled) {
    return { padding: 0 };
  }
  return {
    backgroundColor: background.color,
    borderRadius: background.radius * scale,
    padding: `${background.paddingY * scale}px ${background.paddingX * scale}px`,
  };
}

// ---------------------------------------------------------------------------
// pickActiveChunkIndex
// ---------------------------------------------------------------------------

/**
 * Index of the chunk visible at `timeSeconds`, or -1 if none. Ranges are
 * half-open `[start, end)` so a boundary time belongs to the later chunk; the
 * final chunk's `end` is inclusive so the last frame still shows.
 */
export function pickActiveChunkIndex(
  plan: CaptionPlan,
  timeSeconds: number,
): number {
  const last = plan.length - 1;
  for (let i = 0; i <= last; i++) {
    const chunk = plan[i];
    const withinStart = timeSeconds >= chunk.start;
    const withinEnd =
      i === last ? timeSeconds <= chunk.end : timeSeconds < chunk.end;
    if (withinStart && withinEnd) {
      return i;
    }
  }
  return -1;
}
