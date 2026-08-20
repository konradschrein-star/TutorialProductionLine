/**
 * Prompt Builder — Enriched Image Prompt Construction
 *
 * Takes a raw image description (from Claude scene analysis) and enriches it
 * with broadcast photography specifications, camera/lens/lighting details,
 * and AI-tell avoidance instructions.
 *
 * Pure functions. No IO.
 */

import type { ShotType, CameraAngle } from "./visual-guidelines.js";
import {
  getCameraSpec,
  getLightingSpec,
  getCompositionRules,
  getRealismModifiers,
  getCameraAngleDescription,
} from "./visual-guidelines.js";

// ---------------------------------------------------------------------------
// Visual Theme
// ---------------------------------------------------------------------------

export interface VisualTheme {
  setting: string;
  timeOfDay: string;
  colorPalette: string;
  mood: string;
  weatherConditions?: string;
}

// ---------------------------------------------------------------------------
// Prompt Builder
// ---------------------------------------------------------------------------

export interface EnrichedPromptParams {
  /** Raw image description from Claude scene analysis */
  rawDescription: string;
  /** Shot type for this scene */
  shotType: ShotType;
  /** Camera angle for this scene */
  cameraAngle: CameraAngle;
  /** Visual theme for consistency across scenes */
  visualTheme?: VisualTheme;
  /** Style prefix from template preset (prepended to prompt) */
  stylePrefix?: string;
  /** Style suffix from template preset (appended to prompt) */
  styleSuffix?: string;
  /**
   * Natural-language description of the scene's location/setting.
   * Sourced from the Environment record attached to the job.
   * Example: "Modern open-plan office: glass walls, exposed concrete, city skyline view"
   */
  environmentDescription?: string;
  /**
   * Percentage of the right edge to keep unobstructed (0–100).
   * Pass a non-zero value only for AVATAR_PIP layouts — reserves space for the
   * avatar overlay so the AI doesn't place the subject's face there.
   * Derived from environment.spatial_hints.safe_zone_right_percent.
   */
  preserveRightPercent?: number;
}

/**
 * Build an enriched image prompt by composing:
 * [stylePrefix] + [shot type + raw description] + [camera/lens spec] +
 * [lighting] + [angle] + [composition] + [reality modifiers] + [styleSuffix]
 *
 * The result is a single string optimized for AI image generation APIs
 * that produces photorealistic broadcast-quality images.
 */
export function buildEnrichedImagePrompt(params: EnrichedPromptParams): string {
  const {
    rawDescription,
    shotType,
    cameraAngle,
    visualTheme,
    stylePrefix,
    styleSuffix,
    environmentDescription,
    preserveRightPercent,
  } = params;

  const parts: string[] = [];

  // Style prefix (e.g., "Dark cinematic tone, desaturated colors.")
  if (stylePrefix) {
    parts.push(stylePrefix.trim());
  }

  // Shot type label + raw description
  const shotLabel = formatShotTypeLabel(shotType);
  parts.push(`${shotLabel} ${rawDescription.trim()}`);

  // Camera and lens specification
  parts.push(getCameraSpec(shotType));

  // Lighting (from visual theme time of day, or default)
  const timeOfDay = visualTheme?.timeOfDay ?? "daytime";
  parts.push(getLightingSpec(timeOfDay));

  // Camera angle
  const angleDesc = getCameraAngleDescription(cameraAngle);
  parts.push(`Camera angle: ${angleDesc}`);

  // Composition rules for this shot type
  parts.push(getCompositionRules(shotType));

  // Visual theme context (if provided)
  if (visualTheme) {
    const themeContext = [
      visualTheme.mood && `Mood: ${visualTheme.mood}`,
      visualTheme.colorPalette && `Color palette: ${visualTheme.colorPalette}`,
      visualTheme.weatherConditions &&
        `Weather: ${visualTheme.weatherConditions}`,
    ]
      .filter(Boolean)
      .join(". ");
    if (themeContext) {
      parts.push(themeContext);
    }
  }

  // Environment setting context
  if (environmentDescription) {
    parts.push(`Setting: ${environmentDescription}`);
  }

  // Avatar PIP spatial constraint — keep subject clear of overlay zone
  if (preserveRightPercent && preserveRightPercent > 0) {
    const safeWidth = 100 - preserveRightPercent;
    parts.push(
      `Keep all subjects and focal points within the left ${safeWidth}% of the frame; the rightmost ${preserveRightPercent}% must remain unobstructed — no faces, text, important objects, or action in this zone`,
    );
  }

  // Production reality modifiers
  parts.push(getRealismModifiers());

  // Anti-AI-tell instructions (compact)
  parts.push(
    "Natural imperfections, no perfect symmetry, no oversaturation, realistic skin texture, environmental clutter",
  );

  // Style suffix
  if (styleSuffix) {
    parts.push(styleSuffix.trim());
  }

  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Illustration Prompt Builder
// ---------------------------------------------------------------------------

export interface IllustrationPromptParams {
  /** Raw illustration description from Claude scene analysis */
  rawDescription: string;
  /** Style prefix from template preset (prepended to prompt) */
  stylePrefix?: string;
  /** Style suffix from template preset (appended to prompt) */
  styleSuffix?: string;
  /**
   * Assembled descriptions from the style asset library
   * (e.g. "Main character: tall stick figure with glasses. Background: whiteboard.")
   * Injected between the raw description and quality modifiers.
   */
  styleAssetContext?: string;
  /**
   * CASUALLY_EXPLAINED "hybrid" mode: rawDescription may legitimately describe
   * a photorealistic or richly-detailed background behind the stick-figure
   * subject (see buildIllustrationSceneSystemPrompt's STYLE BLEND rules for
   * CASUALLY_EXPLAINED). When true, the blanket "pure white background / no
   * photographic elements" modifiers are skipped so they don't contradict a
   * hybrid background described in rawDescription — only the character
   * rendering is constrained to line art. Defaults to false (unchanged
   * behavior for EXPLAINER and any other illustration-mode consumer).
   */
  hybridStyle?: boolean;
}

/**
 * Build a simple illustration-focused image prompt.
 *
 * Used for formats like CASUALLY_EXPLAINED where background imagery
 * should be flat illustration art (stick figures, diagrams, cartoons)
 * rather than photorealistic broadcast footage.
 *
 * Deliberately skips all broadcast photography enrichment (camera specs,
 * aperture, lighting, composition rules) — those are counterproductive
 * for illustration-style AI image generation.
 *
 * Composes: [stylePrefix] + [rawDescription] + [styleAssetContext] +
 *           [illustration quality modifiers] + [styleSuffix]
 */
export function buildIllustrationImagePrompt(
  params: IllustrationPromptParams,
): string {
  const {
    rawDescription,
    stylePrefix,
    styleSuffix,
    styleAssetContext,
    hybridStyle,
  } = params;

  const parts: string[] = [];

  if (stylePrefix) {
    parts.push(stylePrefix.trim());
  }

  parts.push(rawDescription.trim());

  if (styleAssetContext) {
    parts.push(styleAssetContext.trim());
  }

  if (hybridStyle) {
    // Hybrid mode: constrain only the character rendering to line art —
    // rawDescription may legitimately call for a photorealistic or richly
    // detailed background, so we must not blanket-forbid photorealism here.
    parts.push(
      "the stick-figure character is rendered in simple hand-drawn black line art (thick outlines, crude shapes, no photographic treatment on the character itself); the background follows the scene description exactly, including photorealistic or richly detailed backgrounds when described",
    );
  } else {
    // Illustration-specific quality modifiers
    parts.push(
      "flat 2D illustration style, minimal linework, limited color palette, simple geometric shapes",
    );
    parts.push(
      "pure white background (#FFFFFF), stick figure art, hand-drawn MS Paint aesthetic, simple black line drawings, crude shapes, no photographic elements",
    );
  }

  if (styleSuffix) {
    parts.push(styleSuffix.trim());
  }

  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Format shot type as a human-readable label for prompt injection.
 */
function formatShotTypeLabel(shotType: ShotType): string {
  const labels: Record<ShotType, string> = {
    establishing: "Wide establishing shot of",
    wide: "Wide shot of",
    medium: "Medium shot of",
    medium_closeup: "Medium close-up shot of",
    closeup: "Close-up shot of",
    detail: "Detail macro shot of",
    over_shoulder: "Over-the-shoulder shot of",
  };
  return labels[shotType];
}
