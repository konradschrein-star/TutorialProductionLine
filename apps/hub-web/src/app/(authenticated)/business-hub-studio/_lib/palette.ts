/**
 * Colours used inside the Presenter Studio.
 *
 * Two separate systems, deliberately not merged:
 *
 *  - {@link UI} is the hub's V2 console skin (inline styles, `--v2-*` tokens).
 *    Everything that is chrome — panels, labels, buttons — uses it, so the
 *    Studio looks like the rest of the app.
 *  - {@link FORMAT} is the BUSINESS_PLAN_HUB palette from design §3.1 / brief §6:
 *    a single ocean hue ramp, clay for negative states, **no yellow and no
 *    gold**. Anything that previews what the VIDEO will look like uses it, so
 *    the operator judges the frame against the real palette rather than against
 *    the console's lime accent.
 */

/** Console chrome — matches `(authenticated)/v2.css`. */
export const UI = {
  text1: "#e5e2e1",
  text2: "#cdc3d7",
  text3: "var(--v2-text-3)",
  accent: "var(--v2-accent)",
  accentSoft: "rgba(var(--v2-accent-rgb), 0.12)",
  accentBorder: "rgba(var(--v2-accent-rgb), 0.25)",
  hairline: "rgba(255,255,255,0.09)",
  surface: "rgba(255,255,255,0.03)",
  surfaceRaised: "rgba(255,255,255,0.06)",
  warning: "var(--v2-warning)",
  error: "var(--v2-error)",
  success: "var(--v2-success)",
} as const;

/** BUSINESS_PLAN_HUB video palette — design §3.1, brief §6. */
export const FORMAT = {
  /** Near-black mat. */
  groundDark: "#0b0f14",
  /** Near-white mat, for chapter breaks and contrast. */
  groundLight: "#f2f1ec",
  ink: "#001d39",
  navy: "#0a4174",
  steel: "#49769f",
  slate: "#4e8ea2",
  silver: "#7bbde8",
  mist: "#bdd8e9",
  /** Negative states only. The one non-ocean colour in the format. */
  clay: "#9a5a52",
} as const;

/**
 * Per-hitbox overlay colours on the calibration canvas.
 *
 * These are TOOL chrome drawn over the pose PNG, never composited into a frame,
 * so they are chosen for maximum separation against a black suit rather than
 * from {@link FORMAT}. No yellow appears even here: the rule is absolute in this
 * format's surfaces, and an operator who sees gold in the Studio will assume it
 * is available in a layout.
 */
export const HITBOX_COLOURS = {
  head: "#7bbde8",
  collar: "#ff5fa2",
  pointOrigin: "#23decb",
  pointDirection: "#23decb",
  safeRegion: "#904efb",
  crop: "#e5e2e1",
} as const;
