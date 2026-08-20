import { z } from "zod";

/**
 * Style Preset Schema
 *
 * Defines visual styling for Remotion compositions (lower thirds, ticker, captions)
 * and image generation prompt modifiers (prefix/suffix).
 *
 * Stored in template.metadata.style_preset JSONB — no separate DB table needed.
 * Components fall back to hardcoded defaults when a style preset is not provided.
 */

export const ColorPaletteSchema = z.object({
  primary: z.string().describe("Primary brand color (hex)"),
  secondary: z.string().describe("Secondary color (hex)"),
  accent: z.string().describe("Accent/highlight color (hex)"),
  background: z.string().describe("Background color (hex)"),
  text: z.string().describe("Primary text color (hex)"),
});

export type ColorPalette = z.infer<typeof ColorPaletteSchema>;

export const LowerThirdStyleSchema = z.object({
  backgroundColor: z.string().default("rgba(0, 0, 0, 0.7)"),
  textColor: z.string().default("#FFFFFF"),
  accentColor: z.string().optional().describe("Accent bar color"),
  position: z
    .enum(["bottom-left", "bottom-center", "bottom-right"])
    .default("bottom-left"),
});

export type LowerThirdStyle = z.infer<typeof LowerThirdStyleSchema>;

export const TickerStyleSchema = z.object({
  backgroundColor: z.string().default("rgba(200, 0, 0, 0.8)"),
  textColor: z.string().default("#FFFFFF"),
  speed: z
    .number()
    .positive()
    .default(900)
    .describe("Scroll duration in frames"),
});

export type TickerStyle = z.infer<typeof TickerStyleSchema>;

export const CaptionStyleSchema = z.object({
  activeColor: z
    .string()
    .default("#FFD700")
    .describe("Current word highlight color"),
  inactiveColor: z
    .string()
    .default("#FFFFFF")
    .describe("Surrounding words color"),
  fontSize: z.number().positive().default(2).describe("Font size in rem"),
  activeFontSize: z
    .number()
    .positive()
    .default(2.5)
    .describe("Active word font size in rem"),
  fontFamily: z.string().optional(),
  fontWeight: z.number().optional(),
  textColorOnBackground: z.string().optional(),
  textTransform: z
    .enum(["uppercase", "lowercase", "capitalize", "none"])
    .optional(),
  letterSpacing: z.string().optional(),
  backgroundColor: z.string().optional(),
  background: z.enum(["pill", "box", "none"]).optional(),
  outlineWidth: z.number().optional(),
  outlineColor: z.string().optional(),
  /** Solid color box that sits behind the currently spoken word. Hormozi-style. */
  highlightBackgroundColor: z.string().optional(),
  /** Padding inside the highlight box in px. Default 6×12. */
  highlightBackgroundPadding: z
    .object({ x: z.number(), y: z.number() })
    .optional(),
  /** Drop shadow on the text. Renders on top of outline. */
  shadow: z
    .object({
      offsetX: z.number().default(0),
      offsetY: z.number().default(4),
      blur: z.number().default(8),
      color: z.string().default("rgba(0,0,0,0.5)"),
    })
    .optional(),
  /** Neon glow (renders as a colored blurred shadow). */
  glow: z
    .object({ color: z.string(), blur: z.number().default(18) })
    .optional(),
  animation: z
    .enum([
      "spring-pop",
      "word-pop",
      "karaoke-fill",
      "fade-up",
      "bounce-in",
      "none",
    ])
    .optional(),
  // How text fits its container when it would otherwise overflow.
  //   - "wrap"       : whiteSpace=normal, no auto-shrink (lets text break to
  //                     multiple lines).
  //   - "scale-down" : whiteSpace=nowrap, shrink font to fit one line.
  //   - "scale-wrap" : whiteSpace=normal AND shrink font if the longest single
  //                     word still wouldn't fit on one line (German compounds).
  // Default: caption pill = "scale-wrap", subtitle words = "scale-down".
  textWrapMode: z.enum(["wrap", "scale-down", "scale-wrap"]).optional(),
  /** Hard cap on wrapped lines. Above this, font shrinks. Default: 2. */
  maxLines: z.number().optional(),
  /** Explicit CSS word-spacing (e.g. "0", "-0.05em"). Default: "normal". */
  wordSpacing: z.string().optional(),
});

export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;

export const StylePresetSchema = z.object({
  name: z.string(),
  /** Prepended to every image generation prompt */
  prompt_prefix: z.string().optional(),
  /** Appended to every image generation prompt */
  prompt_suffix: z.string().optional(),
  color_palette: ColorPaletteSchema.optional(),
  lower_third: LowerThirdStyleSchema.optional(),
  ticker: TickerStyleSchema.optional(),
  captions: CaptionStyleSchema.optional(),
});

export type StylePreset = z.infer<typeof StylePresetSchema>;

export type SubtitleStyleId =
  | "impact-white"
  | "bold-yellow"
  | "outline-black"
  | "karaoke-green"
  | "clean-soft"
  | "komika-yellow"
  | "komika-white";
export type CaptionPillId =
  | "white-pill-black"
  | "yellow-pill-dark"
  | "transparent"
  | "black-pill-white"
  | "sticker-outlined"
  | "komika-yellow-pill";

export const SUBTITLE_STYLE_PRESETS: Record<string, CaptionStyle> = {
  "impact-white": {
    activeColor: "#FFFFFF",
    inactiveColor: "#CCCCCC",
    fontSize: 2.2,
    activeFontSize: 2.6,
    fontFamily: "'Anton', Impact, 'Arial Black', sans-serif",
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.02em",
    outlineWidth: 3,
    outlineColor: "#000000",
    animation: "spring-pop",
  },
  "bold-yellow": {
    activeColor: "#FFD700",
    inactiveColor: "#FFFFFF",
    fontSize: 2.2,
    activeFontSize: 2.6,
    fontFamily: "'Anton', Impact, 'Arial Black', sans-serif",
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.02em",
    outlineWidth: 2,
    outlineColor: "#000000",
    animation: "spring-pop",
  },
  "outline-black": {
    activeColor: "#000000",
    inactiveColor: "#333333",
    fontSize: 2,
    activeFontSize: 2.4,
    fontWeight: 800,
    textTransform: "uppercase",
    outlineWidth: 2,
    outlineColor: "#FFFFFF",
    animation: "spring-pop",
  },
  // Karaoke-style green highlight on each spoken word — heavy black outline
  // keeps it legible against any backdrop. Pairs with the "black-pill-white"
  // caption.
  "karaoke-green": {
    activeColor: "#39FF6A",
    inactiveColor: "#39FF6A",
    fontSize: 2.2,
    activeFontSize: 2.6,
    fontFamily: "'Anton', Impact, 'Arial Black', sans-serif",
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.02em",
    outlineWidth: 4,
    outlineColor: "#000000",
    animation: "word-pop",
  },
  // Clean white with a soft drop shadow — for sources where impact lettering
  // would clash with the visual style.
  "clean-soft": {
    activeColor: "#FFFFFF",
    inactiveColor: "#E8E8E8",
    fontSize: 2,
    activeFontSize: 2.2,
    fontFamily: "Montserrat, Inter, sans-serif",
    fontWeight: 800,
    textTransform: "none",
    letterSpacing: "-0.01em",
    outlineWidth: 1,
    outlineColor: "rgba(0,0,0,0.6)",
    animation: "spring-pop",
  },
  // Komika Axis — thick comic-display lettering, used by a lot of viral
  // German short-form creators. Wide glyphs, so default to "scale-wrap" to
  // gracefully handle compound words like KLEINUNTERNEHMERREGEL.
  "komika-yellow": {
    activeColor: "#FFD400",
    inactiveColor: "#FFD400",
    fontSize: 2.2,
    activeFontSize: 2.5,
    fontFamily: "'Komika Axis', Impact, 'Arial Black', sans-serif",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.01em",
    outlineWidth: 6,
    outlineColor: "#000000",
    animation: "spring-pop",
    textWrapMode: "scale-wrap",
    maxLines: 2,
  },
  "komika-white": {
    activeColor: "#FFFFFF",
    inactiveColor: "#FFFFFF",
    fontSize: 2.2,
    activeFontSize: 2.5,
    fontFamily: "'Komika Axis', Impact, 'Arial Black', sans-serif",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.01em",
    outlineWidth: 6,
    outlineColor: "#000000",
    animation: "spring-pop",
    textWrapMode: "scale-wrap",
    maxLines: 2,
  },
};

export const CAPTION_PILL_PRESETS: Record<string, CaptionStyle> = {
  "white-pill-black": {
    activeColor: "#000000",
    inactiveColor: "#333333",
    fontSize: 1.8,
    activeFontSize: 2,
    fontFamily:
      "Montserrat, 'Helvetica Neue', Inter, -apple-system, sans-serif",
    fontWeight: 800,
    background: "pill",
    backgroundColor: "#FFFFFF",
    textColorOnBackground: "#000000",
    animation: "word-pop",
    textWrapMode: "scale-wrap",
    maxLines: 2,
    wordSpacing: "0",
    letterSpacing: "0.01em",
  },
  "yellow-pill-dark": {
    activeColor: "#FFD700",
    inactiveColor: "#FFFFFF",
    fontSize: 1.8,
    activeFontSize: 2,
    fontWeight: 700,
    background: "pill",
    backgroundColor: "#1A1A1A",
    textColorOnBackground: "#FFD700",
    animation: "word-pop",
  },
  transparent: {
    activeColor: "#FFD700",
    inactiveColor: "#FFFFFF",
    fontSize: 1.8,
    activeFontSize: 2,
    fontWeight: 600,
    background: "none",
    animation: "word-pop",
  },
  // Inverse of white-pill-black — black pill, bright white text. Pairs
  // with the karaoke-green subtitle style for contrast.
  "black-pill-white": {
    activeColor: "#FFFFFF",
    inactiveColor: "#E8E8E8",
    fontSize: 1.8,
    activeFontSize: 2,
    fontFamily:
      "Montserrat, 'Helvetica Neue', Inter, -apple-system, sans-serif",
    fontWeight: 800,
    background: "pill",
    backgroundColor: "#0A0A0A",
    textColorOnBackground: "#FFFFFF",
    animation: "word-pop",
    textWrapMode: "scale-wrap",
    maxLines: 2,
    wordSpacing: "0",
    letterSpacing: "0.01em",
  },
  "komika-yellow-pill": {
    activeColor: "#FFD400",
    inactiveColor: "#FFD400",
    fontSize: 1.8,
    activeFontSize: 2,
    fontFamily: "'Komika Axis', Impact, 'Arial Black', sans-serif",
    fontWeight: 400,
    background: "pill",
    backgroundColor: "#000000",
    textColorOnBackground: "#FFD400",
    animation: "word-pop",
    textWrapMode: "scale-wrap",
    maxLines: 2,
    wordSpacing: "0",
    letterSpacing: "0.02em",
  },
  // Outlined sticker look — no pill, heavy black outline around white text.
  // Reads as an organic hand-placed sticker.
  "sticker-outlined": {
    activeColor: "#FFFFFF",
    inactiveColor: "#FFFFFF",
    fontSize: 1.8,
    activeFontSize: 2,
    fontFamily: "Montserrat, Inter, sans-serif",
    fontWeight: 900,
    background: "none",
    outlineWidth: 4,
    outlineColor: "#000000",
    animation: "spring-pop",
  },
};
