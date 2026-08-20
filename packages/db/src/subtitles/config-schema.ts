/**
 * Global Subtitle System — the ONE caption style schema.
 *
 * History / why this file changed shape
 * -------------------------------------
 * This used to define two disjoint config shapes: a rich `RemotionSubtitleConfig`
 * and a minimal `FFmpegSubtitleConfig` that shared almost no fields. Because the
 * two renderers were fed different fields, and because the FFmpeg path
 * additionally hardcoded its own segmentation options, the SAME sentence
 * rendered through the two engines came out with different type size, different
 * margins, different line breaks and a different (in fact inverted) word
 * highlight. That divergence WAS the "inconsistent / unprofessional captions"
 * defect.
 *
 * There is now exactly one canonical shape — `SubtitleStyleSchema`. Both
 * engines consume it. `engine` on the preset row still selects the RENDERER
 * (Remotion bake-in vs ASS burn-in), it no longer selects a different schema.
 *
 * `FfmpegConfigSchema` is kept as a named export and still parses rows written
 * under the old minimal shape: a `z.preprocess` step upgrades a legacy config to
 * the canonical one (see `upgradeLegacyFfmpegConfig`). Nothing has to be
 * back-filled in the database for old presets to keep working.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Canonical caption style config (consumed by BOTH engines)
// ---------------------------------------------------------------------------

const strokeSchema = z.object({
  color: z.string(),
  width: z.number(),
});

const shadowSchema = z.object({
  color: z.string(),
  blur: z.number(),
  strength: z.number().min(0).max(1),
  size: z.number(),
  offsetX: z.number(),
  offsetY: z.number(),
  curve: z.enum(["linear", "easeOut", "easeIn", "gaussian"]),
});

const secondaryFontSchema = z
  .object({
    fontId: z.string().nullable(),
    fontFamily: z.string(),
    fontWeight: z.number(),
  })
  .nullable();

const oneWordModeSchema = z.object({
  pairShortWords: z.boolean(),
  shortWordMaxLen: z.number(),
});

const keywordSchema = z.object({
  enabled: z.boolean(),
  wordClasses: z.array(
    z.enum(["noun", "verb", "adjective", "adverb", "number"]),
  ),
  aggressiveness: z.number().min(0).max(100),
  colors: z.array(z.string()),
  bold: z.boolean(),
  italic: z.boolean(),
  background: z.string().nullable(),
});

const animationSchema = z.object({
  enabled: z.boolean(),
  caption: z.enum(["none", "fade", "slideUp", "slideDown", "pop", "bounce"]),
  word: z.enum(["none", "fadeInFast", "pop", "scale", "colorReveal"]),
  variants: z.boolean(),
  durationFrames: z.number(),
  activeWordScale: z.number(),
  activeWordColor: z.string().nullable(),
});

const backgroundSchema = z.object({
  enabled: z.boolean(),
  color: z.string(),
  radius: z.number(),
  paddingX: z.number(),
  paddingY: z.number(),
});

const speakersSchema = z
  .object({
    enabled: z.boolean(),
    showHeading: z.boolean(),
    registry: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        color: z.string(),
      }),
    ),
  })
  .nullable();

export const SubtitleStyleSchema = z.object({
  schemaVersion: z.literal(2),

  // Font
  fontId: z.string().nullable(),
  fontFamily: z.string(),
  fontWeight: z.number(),
  textCase: z.enum(["asIs", "upper", "lower"]),
  fontSize: z.number(),
  fontColor: z.string(),
  stroke: strokeSchema,
  shadow: shadowSchema,

  // Secondary font
  secondaryFont: secondaryFontSchema,

  // Caption layout
  wordsPerChunk: z.number().int().min(1).max(8),
  oneWordMode: oneWordModeSchema,
  positionX: z.number().min(0).max(100),
  positionY: z.number().min(0).max(100),
  positionPreset: z.enum(["bottom", "center", "top", "lowerThird", "custom"]),
  alignment: z.enum(["left", "center", "right"]),

  /**
   * Distance from the anchored frame edge to the caption BLOCK edge, as a
   * percent of frame HEIGHT. Drives `positionPreset: "bottom" | "top"` in both
   * engines (ASS `MarginV`, CSS `bottom`/`top`).
   *
   * Broadcast title-safe is 5% of height. Captions are conventionally set a
   * little further in so they clear player chrome, and vertical-video platforms
   * overlay their own UI across the bottom of the frame — which is why the
   * shorts-oriented presets raise this rather than the renderer trying to guess
   * from the aspect ratio. Defaulted so every already-stored preset keeps
   * parsing.
   */
  safeMarginPercent: z.number().min(0).max(45).default(10),

  /**
   * Safe area: the widest the caption block may get, as a % of frame width.
   * Without this the caption line was `flex-wrap: nowrap` inside an
   * unconstrained absolutely-positioned box, so a wide chunk simply ran off
   * both edges of the frame — the single worst real-world defect at 9:16.
   * Defaulted (not required) so every already-stored preset keeps parsing.
   */
  maxWidthPercent: z.number().min(20).max(100).default(86),

  /**
   * How the px values in this config (fontSize, stroke width, shadow, pill
   * padding/radius) map onto the actual canvas.
   *
   * - "canvasRelative" (default): the config is authored against a 1080-tall
   *   reference frame and scaled by `canvasHeight / 1080`. A preset then reads
   *   the same at 1920x1080 and 1080x1920 (~5-6% of frame height either way),
   *   which is what makes one preset usable for BOTH 16:9 and 9:16.
   * - "absolute": legacy behaviour — px are canvas px, so the identical preset
   *   renders ~44% smaller (relative to frame) on a 9:16 canvas.
   */
  sizeMode: z.enum(["canvasRelative", "absolute"]).default("canvasRelative"),

  // Segmentation rules
  punctuationMode: z.enum(["all", "soft", "none"]),
  breakLines: z.boolean(),
  maxLines: z.number(),
  gapFree: z.boolean(),
  smartSplit: z.boolean(),

  // Keyword highlight
  keyword: keywordSchema,

  // Animations
  animation: animationSchema,

  // Caption background
  background: backgroundSchema,

  // Video background fill
  videoBackgroundColor: z.string().nullable(),

  // Multi-speaker (Phase 4; off by default)
  speakers: speakersSchema,
});

export type SubtitleStyle = z.infer<typeof SubtitleStyleSchema>;

/**
 * Back-compatible alias. The Remotion engine always spoke the canonical shape,
 * so `RemotionConfigSchema` IS `SubtitleStyleSchema`; the name is kept because
 * it is referenced from the worker resolver, the API routes and the editor.
 */
export const RemotionConfigSchema = SubtitleStyleSchema;
export type RemotionSubtitleConfig = SubtitleStyle;

// ---------------------------------------------------------------------------
// FFmpeg config — the same canonical shape, with a legacy upgrade in front
// ---------------------------------------------------------------------------

/** The old minimal FFmpeg config shape, still present in stored preset rows. */
const LegacyFfmpegConfigSchema = z.object({
  schemaVersion: z.literal(2),
  fontId: z.string().nullable().optional(),
  fontFamily: z.string(),
  fontSize: z.number(),
  colorScheme: z.enum(["white_black", "yellow_black", "black", "custom"]),
  primaryColor: z.string(),
  outlineColor: z.string(),
  outlineWidth: z.number(),
  wordsPerChunk: z.number().int().min(1).max(8),
  verticalOffsetPercent: z.number(),
});

/** Text / highlight colours the three legacy built-in colour schemes implied. */
const LEGACY_SCHEME_COLORS: Record<
  "white_black" | "yellow_black" | "black",
  { fontColor: string; strokeColor: string; activeWordColor: string }
> = {
  // NOTE the historical highlight colour here was #AAFF00 (lime) and it was
  // wired into the ASS SecondaryColour slot, which made UNSPOKEN words lime and
  // turned them white once spoken — i.e. the highlight ran backwards, in a
  // colour no preset asked for. The upgrade maps these to a plain, correct
  // yellow highlight.
  white_black: {
    fontColor: "#FFFFFF",
    strokeColor: "#000000",
    activeWordColor: "#FFE000",
  },
  yellow_black: {
    fontColor: "#FFE000",
    strokeColor: "#000000",
    activeWordColor: "#FFFFFF",
  },
  black: {
    fontColor: "#111111",
    strokeColor: "#FFFFFF",
    activeWordColor: "#FFE000",
  },
};

/**
 * Upgrade a legacy minimal FFmpeg config to the canonical caption style.
 *
 * Passed straight through when the input is already canonical (detected by the
 * absence of the legacy-only `colorScheme` key), so this is a no-op for every
 * preset written after the unification.
 *
 * Geometry notes:
 *  - legacy `outlineWidth` was an ASS `Outline` (thickness drawn OUTSIDE the
 *    glyph); the canonical `stroke.width` is a CSS centred stroke, so it is
 *    twice the legacy value. See `cssStrokeToAssOutline` in media-core/layout.
 *  - legacy `verticalOffsetPercent` was an ASS `MarginV` measured from the frame
 *    bottom, which is exactly the canonical `safeMarginPercent` with a
 *    bottom-anchored `positionPreset`.
 */
export function upgradeLegacyFfmpegConfig(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object") return raw;
  if (!("colorScheme" in (raw as Record<string, unknown>))) return raw;

  const parsed = LegacyFfmpegConfigSchema.safeParse(raw);
  if (!parsed.success) return raw; // let the canonical schema report the issues

  const legacy = parsed.data;
  const scheme =
    legacy.colorScheme === "custom"
      ? {
          fontColor: legacy.primaryColor,
          strokeColor: legacy.outlineColor,
          activeWordColor: "#FFE000",
        }
      : LEGACY_SCHEME_COLORS[legacy.colorScheme];

  return {
    ...defaultSubtitleStyle,
    fontId: legacy.fontId ?? null,
    fontFamily: legacy.fontFamily,
    fontSize: legacy.fontSize,
    fontColor: scheme.fontColor,
    stroke: { color: scheme.strokeColor, width: legacy.outlineWidth * 2 },
    wordsPerChunk: legacy.wordsPerChunk,
    positionPreset: "bottom",
    safeMarginPercent: Math.min(45, Math.max(0, legacy.verticalOffsetPercent)),
    animation: {
      ...defaultSubtitleStyle.animation,
      // The legacy ASS engine had no entrance animation at all; keep it that way
      // so an upgraded preset does not suddenly start moving.
      enabled: false,
      caption: "none",
      word: "none",
      activeWordScale: 1,
      activeWordColor: scheme.activeWordColor,
    },
  };
}

export const FfmpegConfigSchema = z.preprocess(
  upgradeLegacyFfmpegConfig,
  SubtitleStyleSchema,
);

/**
 * The FFmpeg engine now consumes the identical canonical style. The alias is
 * retained because it is referenced widely (worker resolver, editor, API).
 */
export type FFmpegSubtitleConfig = SubtitleStyle;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * The canonical default caption style: white, black outline, two lines, gap-free,
 * smart-split, no motion.
 *
 * Numbers are authored against a 1080-tall reference frame (see `sizeMode`):
 *  - fontSize 58 = 5.4% of frame height, inside the readable 3.8-8.5% band that
 *    broadcast and streaming caption specs converge on.
 *  - maxWidthPercent 82 leaves a 9% margin each side, a little inside the 10%
 *    title-safe convention, which caps a line at roughly the 42-character
 *    subtitle limit at this type size.
 *  - safeMarginPercent 10 lifts the caption clear of player chrome.
 *  - stroke.width 8 is a CSS centred stroke, i.e. 4px of VISIBLE outline — heavy
 *    enough to survive bright, busy footage without closing up the counters.
 */
export const defaultSubtitleStyle: SubtitleStyle = {
  schemaVersion: 2,

  fontId: null,
  // Montserrat, not Inter.
  //
  // With `fontId: null` the renderers fall back to a HOST font, and libass and
  // Chromium do not pick the same fallback — which silently reintroduces the
  // cross-engine divergence this system exists to prevent. Montserrat is
  // installed on the render host (`fc-list`); Inter is not. Presets that need a
  // guaranteed face should set `fontId`, which hands BOTH engines the same file.
  fontFamily: "Montserrat",
  fontWeight: 700,
  textCase: "asIs",
  fontSize: 58,
  fontColor: "#FFFFFF",
  stroke: { color: "#000000", width: 8 },
  shadow: {
    color: "#000000",
    blur: 6,
    strength: 0.5,
    size: 0,
    offsetX: 0,
    offsetY: 2,
    curve: "easeOut",
  },

  secondaryFont: null,

  wordsPerChunk: 4,
  oneWordMode: {
    pairShortWords: true,
    shortWordMaxLen: 3,
  },
  positionX: 50,
  positionY: 50,
  positionPreset: "bottom",
  alignment: "center",
  maxWidthPercent: 82,
  safeMarginPercent: 10,
  sizeMode: "canvasRelative",

  punctuationMode: "soft",
  breakLines: true,
  maxLines: 2,
  gapFree: true,
  smartSplit: true,

  keyword: {
    enabled: false,
    wordClasses: ["noun", "verb"],
    aggressiveness: 40,
    colors: ["#FFD400", "#00E0FF", "#FF3D71"],
    bold: true,
    italic: false,
    background: null,
  },

  animation: {
    // A caption that fades in over ~4 frames reads as deliberate; per-word
    // scale-pop and jitter read as amateur, so both default off.
    enabled: true,
    caption: "fade",
    word: "none",
    variants: false,
    durationFrames: 4,
    activeWordScale: 1,
    activeWordColor: null,
  },

  background: {
    enabled: false,
    color: "#000000B3",
    radius: 8,
    paddingX: 18,
    paddingY: 8,
  },

  videoBackgroundColor: null,

  speakers: null,
};

/**
 * Back-compatible aliases. Both engines now default to the SAME style — that is
 * the point of the unification, and the only reason two names still exist is
 * that the editor and the seed script refer to them by engine.
 */
export const defaultRemotionConfig: RemotionSubtitleConfig =
  defaultSubtitleStyle;
export const defaultFfmpegConfig: FFmpegSubtitleConfig = defaultSubtitleStyle;
