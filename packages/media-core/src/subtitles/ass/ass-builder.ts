// ===========================================================================
// ASS builder — the libass/FFmpeg caption engine.
//
// Consumes the SAME `CaptionPlan` and the SAME canonical `SubtitleStyle` as the
// Remotion engine, and is written so that the two produce visually equivalent
// output from one preset. Every geometric decision is delegated to
// `../layout.js`; nothing is re-derived here.
//
// What this engine can and cannot do relative to Remotion is documented in
// `ENGINE_PARITY_NOTES` at the bottom of this file — the differences are
// explicit, not silent.
// ===========================================================================

import type { RemotionSubtitleConfig as SubtitleStyle } from "@repo/db";
import type { CaptionChunk, CaptionPlan, CaptionWord } from "../types.js";
import {
  activeWordRanges,
  computeAssSideMargins,
  computeCanvasScale,
  computeVerticalPlacement,
  cssStrokeToAssOutline,
} from "../layout.js";

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/**
 * Convert a CSS hex colour to an ASS `&HAABBGGRR` literal.
 *
 * Accepts `#RGB`, `#RRGGBB` and `#RRGGBBAA`. Note ASS alpha is INVERTED
 * relative to CSS: `00` is fully opaque and `FF` fully transparent.
 *
 * THROWS on anything unparseable. The previous implementation silently returned
 * white, which turned a typo in a preset into a caption that renders in the
 * wrong colour for an entire video with no diagnostic anywhere — exactly the
 * class of silent fallback this codebase forbids.
 */
export function hexToAss(hex: string): string {
  const raw = hex.trim();
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(raw);
  if (!m) {
    throw new Error(
      `hexToAss: "${hex}" is not a hex colour (#RGB, #RRGGBB or #RRGGBBAA). ` +
        `Fix the subtitle preset — a caption must never be rendered in a ` +
        `guessed colour.`,
    );
  }
  let h = m[1]!;
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  const rr = h.slice(0, 2);
  const gg = h.slice(2, 4);
  const bb = h.slice(4, 6);
  const cssAlpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255;
  const assAlpha = (255 - cssAlpha).toString(16).padStart(2, "0");
  return `&H${assAlpha}${bb}${gg}${rr}`.toUpperCase();
}

/** The `\c` inline override for a colour (primary colour only, no alpha). */
function inlineColor(hex: string): string {
  const full = hexToAss(hex);
  // \c takes &HBBGGRR& — drop the alpha byte, which \c ignores anyway.
  return `\\c&H${full.slice(4)}&`;
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** Format seconds as H:MM:SS.CC (ASS centisecond precision). */
export function formatTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.round((clamped % 1) * 100);
  // Rounding can push cs to 100; carry it rather than emitting ".100".
  if (cs === 100) return formatTime(Math.floor(clamped) + 1);
  return (
    `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.` +
    `${String(cs).padStart(2, "0")}`
  );
}

// ---------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------

/** ASS `\an` numpad alignment for an anchor + horizontal alignment pair. */
export function assAlignment(
  anchor: "bottom" | "center" | "top",
  alignment: "left" | "center" | "right",
): number {
  const row = anchor === "bottom" ? 0 : anchor === "center" ? 3 : 6;
  const col = alignment === "left" ? 1 : alignment === "center" ? 2 : 3;
  return row + col;
}

// ---------------------------------------------------------------------------
// Text escaping
// ---------------------------------------------------------------------------

/**
 * Escape a display word for an ASS Dialogue field. Braces would open an
 * override block and a backslash would start a tag, so both are neutralised;
 * literal newlines cannot occur in a single word but are handled for safety.
 */
export function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, "∖") // set minus — visually a backslash, inert in ASS
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/\r?\n/g, " ");
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function buildHeader(
  config: SubtitleStyle,
  width: number,
  height: number,
  fontName: string,
): string {
  const scale = computeCanvasScale(config.sizeMode, height);
  const placement = computeVerticalPlacement({
    positionPreset: config.positionPreset,
    positionY: config.positionY,
    safeMarginPercent: config.safeMarginPercent,
  });
  const { marginL, marginR } = computeAssSideMargins(
    {
      positionX: config.positionX,
      alignment: config.alignment,
      maxWidthPercent: config.maxWidthPercent,
    },
    width,
  );
  const marginV = Math.round((placement.marginPercent / 100) * height);
  const alignment = assAlignment(placement.anchor, config.alignment);

  const fontSize = Math.round(config.fontSize * scale);
  const bold = config.fontWeight >= 600 ? -1 : 0;

  // Box mode (BorderStyle 3) paints an opaque rectangle behind each line using
  // OutlineColour, with `Outline` acting as the box padding. Outline mode
  // (BorderStyle 1) draws a border around the glyphs.
  const boxed = config.background.enabled;
  const borderStyle = boxed ? 3 : 1;
  const outlineColour = boxed
    ? hexToAss(config.background.color)
    : hexToAss(config.stroke.color);
  const outline = boxed
    ? Math.round(config.background.paddingY * scale)
    : Number((cssStrokeToAssOutline(config.stroke.width) * scale).toFixed(2));

  // Shadow: a hard offset drop shadow. Distance is the magnitude of the
  // configured CSS shadow offset; opacity rides on `strength`.
  const shadowDistance =
    config.shadow.strength > 0 && !boxed
      ? Math.max(
          0,
          Math.round(
            Math.hypot(config.shadow.offsetX, config.shadow.offsetY) * scale,
          ),
        )
      : 0;
  const shadowAlphaByte = Math.round(
    255 - Math.min(1, Math.max(0, config.shadow.strength)) * 255,
  )
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
  const backColour = `&H${shadowAlphaByte}${hexToAss(config.shadow.color).slice(4)}`;

  return (
    `[Script Info]\n` +
    `ScriptType: v4.00+\n` +
    `Collisions: Normal\n` +
    `PlayResX: ${width}\n` +
    `PlayResY: ${height}\n` +
    // Without this, libass does NOT scale border/shadow with the render
    // resolution, so a preset that looked right at 1080p grew hairline outlines
    // at 4K.
    `ScaledBorderAndShadow: yes\n` +
    // 0 = smart wrapping with balanced lines. The chunker already emits explicit
    // line breaks (\N); this only acts as the overflow safety net, mirroring the
    // Remotion renderer's `flex-wrap`.
    `WrapStyle: 0\n` +
    `Timer: 100.0000\n` +
    `\n` +
    `[V4+ Styles]\n` +
    `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Default,${fontName},${fontSize},${hexToAss(config.fontColor)},` +
    // SecondaryColour is unused: this engine drives the word highlight with
    // explicit per-step \c overrides rather than ASS karaoke (\k), because \k
    // colours words that have NOT been spoken yet, which is backwards.
    `${hexToAss(config.fontColor)},${outlineColour},${backColour},` +
    `${bold},0,0,0,100,100,0,0,${borderStyle},${outline},${shadowDistance},` +
    `${alignment},${marginL},${marginR},${marginV},1\n` +
    `\n` +
    `[Events]\n` +
    `Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`
  );
}

// ---------------------------------------------------------------------------
// Dialogue text
// ---------------------------------------------------------------------------

/**
 * Render one chunk's text with `activeIndex` highlighted, honouring keyword
 * roles. Lines come from the chunker so BOTH engines break at the same words.
 */
function renderChunkText(
  chunk: CaptionChunk,
  config: SubtitleStyle,
  activeIndex: number,
): string {
  const lines = chunk.lines.length > 0 ? chunk.lines : [chunk.words];
  const base = config.fontColor;
  let wordCursor = 0;

  const rendered = lines.map((line) =>
    line
      .map((word: CaptionWord) => {
        const index = wordCursor++;
        const isActive = index === activeIndex;
        let color = base;
        if (word.role === "keyword") {
          color = word.keywordColor ?? config.keyword.colors[0] ?? base;
        }
        if (isActive && config.animation.activeWordColor) {
          color = config.animation.activeWordColor;
        }
        const text = escapeAssText(word.word);
        return color === base
          ? text
          : `{${inlineColor(color)}}${text}{${inlineColor(base)}}`;
      })
      .join(" "),
  );

  return rendered.join("\\N");
}

// ---------------------------------------------------------------------------
// buildAssFromPlan
// ---------------------------------------------------------------------------

export interface BuildAssOptions {
  width: number;
  height: number;
  /**
   * Overrides the ASS Style Fontname. Pass a registered font's REAL embedded
   * family name (with a matching libass `fontsdir`) so the Style binds to the
   * actual file rather than a host font that happens to share a display name.
   * Defaults to `config.fontFamily`.
   */
  fontName?: string;
}

/**
 * Build a full ASS document from a CaptionPlan and the canonical caption style.
 *
 * When `animation.activeWordColor` is set, one Dialogue is emitted per
 * highlight step (see `activeWordRanges`) so the active word advances exactly
 * as it does in Remotion — and, critically, the highlight persists through the
 * silent gaps between words instead of flickering off. When it is null a single
 * Dialogue per chunk is emitted.
 */
export function buildAssFromPlan(
  plan: CaptionPlan,
  config: SubtitleStyle,
  opts: BuildAssOptions,
): string {
  const fontName = opts.fontName ?? config.fontFamily;
  const fadeMs =
    config.animation.enabled && config.animation.caption === "fade"
      ? Math.max(0, Math.round((config.animation.durationFrames / 30) * 1000))
      : 0;
  const fadeTag = fadeMs > 0 ? `{\\fad(${fadeMs},0)}` : "";

  const dialogues: string[] = [];

  for (const chunk of plan) {
    if (chunk.words.length === 0) continue;
    if (chunk.end <= chunk.start) continue;

    if (!config.animation.activeWordColor) {
      dialogues.push(
        `Dialogue: 0,${formatTime(chunk.start)},${formatTime(chunk.end)},` +
          `Default,,0,0,0,,${fadeTag}${renderChunkText(chunk, config, -1)}`,
      );
      continue;
    }

    // One event per highlight step. Only the FIRST step carries the fade so the
    // caption does not re-fade on every word.
    const steps = activeWordRanges(chunk);
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      dialogues.push(
        `Dialogue: 0,${formatTime(step.start)},${formatTime(step.end)},` +
          `Default,,0,0,0,,${i === 0 ? fadeTag : ""}` +
          renderChunkText(chunk, config, step.index),
      );
    }
  }

  return [
    buildHeader(config, opts.width, opts.height, fontName),
    ...dialogues,
    "",
  ].join("\n");
}

/**
 * The COMPLETE list of ways the ASS engine cannot match the Remotion engine.
 * Anything not listed here is expected to be visually equivalent, and there is
 * a parity test asserting the geometry.
 *
 * 1. Rounded corners. `background.radius` is ignored — ASS `BorderStyle: 3`
 *    draws a square box. Remotion draws a rounded pill.
 * 2. Box shape. ASS paints one box PER LINE; Remotion paints one box around the
 *    whole chunk. A two-line caption therefore shows two stacked boxes here.
 * 3. Blurred shadows. ASS shadow is a hard offset copy; the Remotion shadow is a
 *    multi-layer blurred stack. `shadow.blur`/`size`/`curve` are ignored.
 * 4. Motion. Only `animation.caption: "fade"` is reproduced (via \fad). Slide,
 *    pop and bounce entrances, per-word entrance animations, `activeWordScale`
 *    and `animation.variants` are Remotion-only. The shipped presets avoid all
 *    of them, so in practice this difference is invisible.
 * 5. Line spacing. ASS uses the font's natural line gap; Remotion sets
 *    line-height 1.2. Expect a sub-pixel-to-few-pixel difference in the gap
 *    between two lines.
 * 6. Secondary font / speaker headings are Remotion-only.
 */
export const ENGINE_PARITY_NOTES = [
  "background.radius ignored (square box)",
  "box is per-line, not per-chunk",
  "shadow.blur/size/curve ignored (hard shadow)",
  "only caption animation 'fade' is reproduced",
  "line spacing follows the font, not line-height 1.2",
  "secondaryFont and speaker headings are Remotion-only",
] as const;
