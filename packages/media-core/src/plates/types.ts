/**
 * BUSINESS_PLAN_HUB — plate types and the design tokens the plates are baked from.
 *
 * ## What a plate is
 *
 * The FFmpeg spine cannot typeset text and cannot draw vector art. So every
 * textual or vector element that is NOT inside a Remotion motion-graphic island
 * is pre-rendered ONCE to a still PNG — a "plate" — and composited by FFmpeg as
 * an ordinary image layer. That is what keeps Chromium out of the 27,000-frame
 * path: a 15-minute video costs a handful of still rasterisations instead of a
 * browser-rendered frame sequence.
 *
 * ## The consumer is the contract
 *
 * {@link PlateSet} is the exact object
 * `apps/worker-render/src/workflows/business-hub.ts` reads as
 * `metadata.business_hub.assets` (`BusinessHubRenderAssets`, declared at
 * business-hub.ts:243, parsed at :735, consumed at :1451 / :1660 / :1686 and
 * :1497). Every field name, keying rule and path expectation below was derived
 * from that file, not invented here:
 *
 * - `groundPlates` is keyed by the ground-theme slug the planner writes onto
 *   `scene.grade` (`"ground-default"` / `"ground-inverse"`), NOT by scene id.
 * - `textPlates` is keyed by SCENE ID and every entry is a full-frame RGBA
 *   plate, because the workflow composites it at `x: 0, y: 0`.
 * - `watermarkPngPath` is the mark at its own natural size — the workflow
 *   positions it with `x: "W-w-40", y: "H-h-40"`, so a full-frame plate would
 *   push the mark off screen.
 *
 * ## Token duplication is deliberate
 *
 * The palette, type scale and grid geometry are transcribed by hand from
 * `apps/worker-render/src/remotion/business-hub/theme/tokens.ts`. `media-core`
 * is a package and `worker-render` is an app; packages must not import from
 * apps, and the Remotion tokens are bundled into a browser build. The same
 * hand-port already exists for the watermark geometry in that app's
 * `ground/Watermark.tsx`. If tokens.ts changes, re-transcribe here — there is no
 * build step keeping the two in sync, which is why
 * {@link assertPlatePaletteIsOcean} exists as a cheap unit-testable guard on the
 * "no yellow, no gold" rule.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown for every fail-closed condition in the plate baker.
 *
 * There is one error class on purpose: a caller that catches it is catching
 * "a plate could not be produced", which is always fatal for the job. Nothing in
 * this module ever emits a placeholder or a zero-byte PNG instead of throwing.
 */
export class PlateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlateError";
  }
}

/** Prefix on every diagnostic this module raises or logs. */
export const PLATE_LOG_PREFIX = "[business-hub/plates]";

/**
 * Version of the plate RASTERISATION, not of this file.
 *
 * It is part of every cache key. Bump it whenever a change to the generated
 * HTML/CSS would change the pixels a given spec produces — otherwise the
 * content-addressed cache keeps serving plates baked by the old code and the
 * change silently never reaches a video.
 */
export const PLATE_SPEC_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Ground themes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The ground-theme slugs the planner writes onto `scene.grade`
 * (`GROUND_THEMES` in
 * `apps/worker-orchestrator/src/processors/business-hub/planner.ts:578`).
 */
export const GROUND_THEME_SLUGS = ["ground-default", "ground-inverse"] as const;
export type GroundThemeSlug = (typeof GROUND_THEME_SLUGS)[number];

/** The two mats. Mirrors the Remotion theme names so a plate and an island agree. */
export type PlateThemeName = "dark" | "light";

/** Type guard for a ground-theme slug coming off an untrusted scene plan. */
export function isGroundThemeSlug(value: unknown): value is GroundThemeSlug {
  return (
    typeof value === "string" &&
    (GROUND_THEME_SLUGS as readonly string[]).includes(value)
  );
}

/**
 * Map a ground-theme slug to the mat it names.
 *
 * Mirrors `REMOTION_THEME_FOR_GRADE` in the render workflow (business-hub.ts:1090)
 * so a baked ground plate and a cached motion-graphic island for the same scene
 * are the same colour.
 *
 * @param slug - `scene.grade`.
 * @param context - What is being baked, for the diagnostic.
 * @returns `"dark"` or `"light"`.
 * @throws {PlateError} If the slug is not a known ground theme. There is no
 *   default: defaulting a typo'd grade to `"dark"` would bake a light-mat
 *   chapter beat on the dark ground and cache it under a hash derived from the
 *   plan, poisoning every later video that reuses the beat.
 */
export function themeForGround(slug: unknown, context: string): PlateThemeName {
  if (!isGroundThemeSlug(slug)) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} ${context}: ground theme ${JSON.stringify(slug)} is not one of ` +
        `${GROUND_THEME_SLUGS.join(", ")}. The planner writes one of those onto every ` +
        `scene.grade; anything else means the plan was not produced by planBusinessHub.`,
    );
  }
  switch (slug) {
    case "ground-default":
      return "dark";
    case "ground-inverse":
      return "light";
    default: {
      const exhaustive: never = slug;
      throw new PlateError(
        `${PLATE_LOG_PREFIX} ${context}: unhandled ground theme ${JSON.stringify(exhaustive)}.`,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The consumed shape
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Presenter geometry and bitmaps, exactly as `parsePresenterAssets`
 * (business-hub.ts:408) validates them.
 *
 * `poses` stays `unknown[]`: entries are validated by `requireCalibratedPose`
 * inside the presenter compositor, so an UNCALIBRATED pose (every entry in
 * `poses.json` today carries `"anchor_status": "needs-calibration"`) throws
 * there rather than flowing into layout maths. Nothing in this module invents an
 * anchor.
 */
export interface PresenterPlateAssets {
  /** `poses.json`, parsed. Never empty. */
  poses: unknown[];
  /** Directory holding `<slug>.png` for every pose. */
  posePngDir: string;
  /** Rasterised RGBA head mark, at least as wide as the largest head drawn. */
  headMarkPngPath: string;
  /** Apparent-size and position knobs shared by every presenter scene. */
  placement: {
    targetCollarPx: number;
    bottomAnchor: number;
    sideInset: number;
    mirror?: boolean;
  };
  /** Upward head travel at peak loudness, in output pixels. */
  headLiftPx?: number;
}

/**
 * `metadata.business_hub.assets` — the object the render workflow refuses to
 * start without.
 *
 * Every string is an ABSOLUTE path on the render box's filesystem. Nothing here
 * is optional: `textPlates` may legitimately be empty (a plan whose non-`mg`
 * scenes carry no copy), and `presenter` may legitimately be `null` (a plan that
 * places no presenter), but the KEYS must be present or the parse throws.
 */
export interface PlateSet {
  /** Full-frame ground plate per ground-theme slug. */
  groundPlates: Record<string, string>;
  /** The corner mark at its natural size, RGBA. */
  watermarkPngPath: string;
  /** Full-frame RGBA copy plate per scene id, for non-`mg` scenes with text. */
  textPlates: Record<string, string>;
  presenter: PresenterPlateAssets | null;
}

/**
 * The box a copy plate was allowed to occupy and the box it actually filled,
 * both in output pixels with the origin at the top-left of the frame.
 *
 * The plate itself is full-frame, so the compositor does not need this to place
 * it — it needs it to place ANYTHING ELSE (the presenter, a chart, a lower
 * third) without colliding with the copy, and QC needs it to see how close a
 * headline came to overflowing.
 */
export interface TextPlateBox {
  /** Left edge of the box the copy was laid out into. */
  x: number;
  /** Top edge of that box. */
  y: number;
  /** Width of that box. */
  width: number;
  /** Height of that box — the budget, not the usage. */
  height: number;
  /** Width the laid-out copy actually used. */
  usedWidth: number;
  /** Height the laid-out copy actually used, after real wrapping. */
  usedHeight: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Palette (transcribed from the Remotion theme — see file header)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The ocean ramp. Transcribed from `theme/tokens.ts` `PALETTE`.
 *
 * `clay` is the ONLY non-ocean colour and is for negative states only. There is
 * no yellow and no gold here by design (build brief §6).
 */
export const PLATE_PALETTE = {
  ink: "#001d39",
  navy: "#0a4174",
  steel: "#49769f",
  slate: "#4e8ea2",
  silver: "#7bbde8",
  mist: "#bdd8e9",
  /** The default mat: near-black, never pure black (pure black crushes on YouTube). */
  groundDark: "#0b0f14",
  /** The inverse mat: warm near-white. */
  groundLight: "#f2f1ec",
  /** Negative state ONLY. */
  clay: "#9a5a52",
} as const;

/** The colours one mat needs to bake its plates. */
export interface PlateThemeColors {
  /** The mat. */
  ground: string;
  /** Mat colour at the frame edge, used by the vignette. */
  groundEdge: string;
  /** Fine grid line, including its own relative alpha. */
  gridMinor: string;
  /** Every Nth grid line. */
  gridMajor: string;
  /** Headline copy on the mat. */
  textPrimary: string;
  /** Body copy on the mat. */
  textSecondary: string;
  /** Eyebrow / caption copy on the mat. */
  textMuted: string;
  /**
   * Drop shadow behind copy, as a CSS `text-shadow` value.
   *
   * Not decoration: a copy plate is composited over whatever the scene's ground
   * turns out to be, and on a `broll` scene that is uncontrolled footage. The
   * shadow is what keeps the type legible when the frame under it happens to be
   * bright. It also satisfies the house rule that objects on the mat are lit
   * rather than flat-pasted (build brief §6).
   */
  copyShadow: string;
  /** Corner watermark colour. */
  watermark: string;
  /** `--mark-bg` of head-mark.svg. */
  markBg: string;
  /** `--mark-fg` of head-mark.svg. */
  markFg: string;
}

/** One mat's full plate-baking token set. */
export interface PlateTheme {
  name: PlateThemeName;
  colors: PlateThemeColors;
  /** Opacity of the whole grid layer, 0..1. */
  gridOpacity: number;
  /** Vignette strength, 0..1. `0` disables it. */
  vignette: number;
  /** Opacity baked into the watermark plate's alpha channel. */
  watermarkOpacity: number;
}

/** Dark mat — the default ground. */
export const DARK_PLATE_THEME: PlateTheme = {
  name: "dark",
  colors: {
    ground: PLATE_PALETTE.groundDark,
    groundEdge: "#05080b",
    gridMinor: "rgba(123, 189, 232, 0.55)",
    gridMajor: "rgba(123, 189, 232, 0.95)",
    textPrimary: PLATE_PALETTE.groundLight,
    textSecondary: PLATE_PALETTE.mist,
    textMuted: PLATE_PALETTE.silver,
    copyShadow: "0 6px 18px rgba(0, 0, 0, 0.55)",
    watermark: PLATE_PALETTE.mist,
    markBg: PLATE_PALETTE.navy,
    markFg: PLATE_PALETTE.groundLight,
  },
  gridOpacity: 0.16,
  vignette: 0.55,
  watermarkOpacity: 0.5,
};

/** Light mat — chapter breaks and contrast beats. */
export const LIGHT_PLATE_THEME: PlateTheme = {
  name: "light",
  colors: {
    ground: PLATE_PALETTE.groundLight,
    groundEdge: "#e4e1d9",
    gridMinor: "rgba(0, 29, 57, 0.45)",
    gridMajor: "rgba(0, 29, 57, 0.8)",
    textPrimary: PLATE_PALETTE.ink,
    textSecondary: "#22425c",
    textMuted: PLATE_PALETTE.steel,
    copyShadow: "0 4px 12px rgba(0, 29, 57, 0.22)",
    watermark: PLATE_PALETTE.steel,
    markBg: PLATE_PALETTE.ink,
    markFg: PLATE_PALETTE.groundLight,
  },
  gridOpacity: 0.14,
  vignette: 0.32,
  watermarkOpacity: 0.45,
};

/**
 * Resolve a mat by name.
 *
 * @throws {PlateError} If `name` is not `"dark"` or `"light"`.
 */
export function getPlateTheme(name: PlateThemeName): PlateTheme {
  switch (name) {
    case "dark":
      return DARK_PLATE_THEME;
    case "light":
      return LIGHT_PLATE_THEME;
    default: {
      const exhaustive: never = name;
      throw new PlateError(
        `${PLATE_LOG_PREFIX} unknown plate theme ${JSON.stringify(exhaustive)}; ` +
          `expected "dark" or "light".`,
      );
    }
  }
}

/**
 * Assert a colour is not yellow or gold.
 *
 * The palette is hand-transcribed from another tree, so the "ocean tones only"
 * rule (build brief §6) is enforced here rather than trusted. Yellow/gold is
 * detected in HSL terms: a hue between 35 and 70 degrees with real saturation.
 * Greys and near-whites (`#f2f1ec` is a warm near-white) are unsaturated and
 * pass.
 *
 * @param hex - `#rgb` or `#rrggbb`.
 * @param context - Token name, for the diagnostic.
 * @throws {PlateError} If the colour is not a hex literal, or reads as yellow/gold.
 */
export function assertNotYellow(hex: string, context: string): string {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (match === null) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} ${context}: expected a #rgb or #rrggbb literal, got ` +
        `${JSON.stringify(hex)}.`,
    );
  }
  const body = match[1] ?? "";
  const full =
    body.length === 3
      ? body
          .split("")
          .map((c) => `${c}${c}`)
          .join("")
      : body;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  // Saturation in HSL terms; a low value is a grey/near-white and has no hue.
  const lightness = (max + min) / 2;
  const saturation =
    delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1) || 1);
  if (saturation < 0.25) return hex;

  let hue: number;
  if (delta === 0) hue = 0;
  else if (max === r) hue = 60 * (((g - b) / delta + 6) % 6);
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);

  if (hue >= 35 && hue <= 70) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} ${context}: ${hex} reads as yellow/gold (hue ${hue.toFixed(0)}°, ` +
        `saturation ${saturation.toFixed(2)}). Build brief §6: ocean tones only — no yellow, ` +
        `no gold. The only non-ocean colour is clay ${PLATE_PALETTE.clay}, and only for a ` +
        `negative state.`,
    );
  }
  return hex;
}

/**
 * Assert the whole transcribed palette still obeys the ocean rule.
 *
 * Cheap enough to call from a unit test; exists so a bad hand-transcription is a
 * test failure rather than a published video.
 *
 * @throws {PlateError} On the first offending swatch.
 */
export function assertPlatePaletteIsOcean(): void {
  for (const [name, hex] of Object.entries(PLATE_PALETTE)) {
    assertNotYellow(hex, `PLATE_PALETTE.${name}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Type scale and geometry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Smallest type that survives a 1080p render watched at 360p on a phone.
 * A hard floor, not a guideline (build brief §6).
 */
export const MIN_LEGIBLE_PX = 18;

/** Headline character budget (build brief §6, and `HEADLINE_MAX_CHARS` in contracts). */
export const HEADLINE_MAX_CHARS = 68;

/** Type scale in px at 1920x1080. Transcribed from `theme/tokens.ts`. */
export const PLATE_TYPE_SCALE = {
  micro: 18,
  caption: 22,
  label: 26,
  body: 32,
  bodyLead: 38,
  subhead: 46,
  headline: 58,
  display: 76,
  hero: 96,
} as const;

/** Line heights, unitless. */
export const PLATE_LINE_HEIGHT = {
  hero: 1.02,
  display: 1.06,
  headline: 1.1,
  subhead: 1.18,
  body: 1.42,
  caption: 1.3,
} as const;

/** Letter spacing in px at 1080p. */
export const PLATE_LETTER_SPACING = {
  headline: -0.8,
  body: 0,
  /** Mono eyebrows are tracked out. */
  eyebrow: 3.2,
} as const;

/**
 * Font stacks, mirroring the Remotion tokens. The fallbacks are load-bearing:
 * the render box is not guaranteed to have the brand faces installed, and a
 * missing family must degrade to a sane system face rather than to Times.
 */
export const PLATE_FONT_FAMILY = {
  serif:
    "'Fraunces Variable', 'Fraunces', ui-serif, Georgia, 'Times New Roman', serif",
  sans: "'Geist Variable', 'Geist', ui-sans-serif, system-ui, 'Segoe UI', Helvetica, Arial, sans-serif",
  mono: "'Geist Mono Variable', 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as const;

/** Grid geometry in px at 1080p height. Transcribed from `GRID_1080`. */
export const PLATE_GRID_1080 = {
  cellPx: 80,
  minorWidthPx: 2,
  majorEvery: 5,
  majorWidthPx: 3,
} as const;

/** Safe margin from the frame edge in px at 1080p. Copy never crosses it. */
export const PLATE_SAFE_MARGIN_PX = 96;

/** Corner watermark geometry at 1080p. The source lockup is 152x114. */
export const PLATE_WATERMARK_1080 = {
  widthPx: 84,
  marginPx: 48,
} as const;

/**
 * Scale a 1080p px value to the actual frame height.
 *
 * @throws {PlateError} If `frameHeight` is not a positive finite number.
 */
export function scaleFor1080(px: number, frameHeight: number): number {
  if (!Number.isFinite(px)) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} scaleFor1080: px must be finite, got ${String(px)}.`,
    );
  }
  if (!Number.isFinite(frameHeight) || frameHeight <= 0) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} scaleFor1080: frameHeight must be > 0, got ${String(frameHeight)}.`,
    );
  }
  return (px * frameHeight) / 1080;
}

/**
 * Assert a font size is legible once rendered.
 *
 * The floor is expressed at 1080p, so the check is applied to the 1080p-relative
 * size: at 1080p a 18px word is 18px, and at any other height the same token
 * scales with the frame, so the reading distance — not the pixel count — is what
 * the floor is really about.
 *
 * @param px1080 - The size in px AT 1080p (before {@link scaleFor1080}).
 * @param context - Scene id and slot, for the diagnostic.
 * @returns `px1080`, unchanged.
 * @throws {PlateError} If the size is non-finite or below {@link MIN_LEGIBLE_PX}.
 *   Shrinking type below the floor to make copy fit is exactly the silent
 *   degradation this throw exists to prevent.
 */
export function assertLegible(px1080: number, context: string): number {
  if (!Number.isFinite(px1080)) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} ${context}: non-finite font size ${String(px1080)}.`,
    );
  }
  if (px1080 < MIN_LEGIBLE_PX) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} ${context}: font size ${px1080}px is below the ` +
        `${MIN_LEGIBLE_PX}px floor and is unreadable at 360p. Shorten the copy or change ` +
        `the layout — do not shrink the type.`,
    );
  }
  return px1080;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared validation helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assert a canvas size is usable.
 *
 * @throws {PlateError} If either dimension is not a positive integer, or is odd.
 *   Odd dimensions are rejected because every plate ends up in an FFmpeg
 *   `overlay` against a yuv420p canvas, where an odd size produces a half-pixel
 *   chroma offset that reads as a soft edge on the whole layer.
 */
export function assertCanvasSize(
  width: number,
  height: number,
  context: string,
): void {
  for (const [name, value] of [
    ["width", width],
    ["height", height],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new PlateError(
        `${PLATE_LOG_PREFIX} ${context}: ${name} must be a positive integer, got ` +
          `${String(value)}.`,
      );
    }
    if (value % 2 !== 0) {
      throw new PlateError(
        `${PLATE_LOG_PREFIX} ${context}: ${name} ${value} is odd. Plates are composited ` +
          `onto a yuv420p canvas, where an odd dimension costs a half-pixel chroma shift.`,
      );
    }
  }
}

/**
 * Parse an aspect token (`"16:9"`) and assert it agrees with the canvas.
 *
 * The aspect is part of every cache key — both here and for the Remotion islands
 * — so an envelope whose aspect and canvas disagree would file a 9:16 plate
 * under a 16:9 key and serve it to every later video that reuses the beat.
 *
 * @returns The parsed ratio.
 * @throws {PlateError} If the token is malformed, or the ratio disagrees with
 *   `width / height` by more than 1%.
 */
export function assertAspectMatchesCanvas(
  aspect: string,
  width: number,
  height: number,
  context: string,
): { w: number; h: number } {
  const match = /^(\d+):(\d+)$/.exec(aspect.trim());
  if (match === null) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} ${context}: aspect ${JSON.stringify(aspect)} is not a "W:H" ` +
        `token (e.g. "16:9").`,
    );
  }
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (w <= 0 || h <= 0) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} ${context}: aspect ${JSON.stringify(aspect)} has a zero term.`,
    );
  }
  const declared = w / h;
  const actual = width / height;
  if (Math.abs(declared - actual) / declared > 0.01) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} ${context}: aspect ${aspect} (${declared.toFixed(4)}) disagrees ` +
        `with the canvas ${width}x${height} (${actual.toFixed(4)}). The aspect token is part ` +
        `of every plate and island cache key, so the mismatch would file this video's plates ` +
        `under another format's key.`,
    );
  }
  return { w, h };
}
