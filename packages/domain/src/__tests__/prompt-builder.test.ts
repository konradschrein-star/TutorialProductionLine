/**
 * Prompt Builder Tests
 *
 * Tests for buildEnrichedImagePrompt and buildIllustrationImagePrompt.
 */

import { describe, it, expect } from "vitest";
import {
  buildEnrichedImagePrompt,
  buildIllustrationImagePrompt,
} from "../prompt-builder.js";

// ---------------------------------------------------------------------------
// buildEnrichedImagePrompt — shot type labels
// ---------------------------------------------------------------------------

describe("buildEnrichedImagePrompt — shot type labels", () => {
  const baseParams = {
    rawDescription: "a politician speaking at a podium",
    cameraAngle: "eye_level" as const,
  };

  it("uses 'Wide establishing shot of' for establishing", () => {
    const result = buildEnrichedImagePrompt({
      ...baseParams,
      shotType: "establishing",
    });
    expect(result).toContain("Wide establishing shot of");
  });

  it("uses 'Wide shot of' for wide", () => {
    const result = buildEnrichedImagePrompt({
      ...baseParams,
      shotType: "wide",
    });
    expect(result).toContain("Wide shot of");
  });

  it("uses 'Medium shot of' for medium", () => {
    const result = buildEnrichedImagePrompt({
      ...baseParams,
      shotType: "medium",
    });
    expect(result).toContain("Medium shot of");
  });

  it("uses 'Medium close-up shot of' for medium_closeup", () => {
    const result = buildEnrichedImagePrompt({
      ...baseParams,
      shotType: "medium_closeup",
    });
    expect(result).toContain("Medium close-up shot of");
  });

  it("uses 'Close-up shot of' for closeup", () => {
    const result = buildEnrichedImagePrompt({
      ...baseParams,
      shotType: "closeup",
    });
    expect(result).toContain("Close-up shot of");
  });

  it("uses 'Detail macro shot of' for detail", () => {
    const result = buildEnrichedImagePrompt({
      ...baseParams,
      shotType: "detail",
    });
    expect(result).toContain("Detail macro shot of");
  });

  it("uses 'Over-the-shoulder shot of' for over_shoulder", () => {
    const result = buildEnrichedImagePrompt({
      ...baseParams,
      shotType: "over_shoulder",
    });
    expect(result).toContain("Over-the-shoulder shot of");
  });

  it("includes the raw description in the output", () => {
    const result = buildEnrichedImagePrompt({
      ...baseParams,
      shotType: "medium",
    });
    expect(result).toContain("a politician speaking at a podium");
  });
});

// ---------------------------------------------------------------------------
// buildEnrichedImagePrompt — camera and lighting specs
// ---------------------------------------------------------------------------

describe("buildEnrichedImagePrompt — camera and lighting specs", () => {
  const baseParams = {
    rawDescription: "cityscape at night with lights",
    shotType: "medium" as const,
    cameraAngle: "eye_level" as const,
  };

  it("includes 'Camera angle:' in output", () => {
    const result = buildEnrichedImagePrompt(baseParams);
    expect(result).toContain("Camera angle:");
  });

  it("includes lens / camera information in output", () => {
    const result = buildEnrichedImagePrompt(baseParams);
    // getCameraSpec injects lens mm spec
    expect(result).toMatch(/\d+mm|lens|aperture|f\//i);
  });

  it("applies stylePrefix when provided", () => {
    const result = buildEnrichedImagePrompt({
      ...baseParams,
      stylePrefix: "Dark cinematic tone, desaturated colors.",
    });
    // stylePrefix is the first segment
    expect(result.startsWith("Dark cinematic tone, desaturated colors.")).toBe(
      true,
    );
  });

  it("applies styleSuffix when provided", () => {
    const result = buildEnrichedImagePrompt({
      ...baseParams,
      styleSuffix: "UHD 8K render.",
    });
    expect(result.endsWith("UHD 8K render.")).toBe(true);
  });

  it("omits stylePrefix section when not provided", () => {
    const result = buildEnrichedImagePrompt({ ...baseParams });
    // Should start with shot type label, not a prefix
    expect(result).toMatch(/^(Wide|Medium|Close-up|Detail|Over-the-shoulder)/);
  });

  it("includes visual theme mood when provided", () => {
    const result = buildEnrichedImagePrompt({
      ...baseParams,
      visualTheme: {
        setting: "urban",
        timeOfDay: "evening",
        colorPalette: "warm tones",
        mood: "tense and urgent",
      },
    });
    expect(result).toContain("Mood: tense and urgent");
  });

  it("includes visual theme color palette when provided", () => {
    const result = buildEnrichedImagePrompt({
      ...baseParams,
      visualTheme: {
        setting: "urban",
        timeOfDay: "daytime",
        colorPalette: "cool blues and greys",
        mood: "neutral",
      },
    });
    expect(result).toContain("Color palette: cool blues and greys");
  });

  it("includes Setting: when environmentDescription provided", () => {
    const result = buildEnrichedImagePrompt({
      ...baseParams,
      environmentDescription: "Modern open-plan office with glass walls",
    });
    expect(result).toContain(
      "Setting: Modern open-plan office with glass walls",
    );
  });
});

// ---------------------------------------------------------------------------
// buildEnrichedImagePrompt — spatial constraint (preserveRightPercent)
// ---------------------------------------------------------------------------

describe("buildEnrichedImagePrompt — preserveRightPercent spatial constraint", () => {
  const baseParams = {
    rawDescription: "a presenter in front of a whiteboard",
    shotType: "medium" as const,
    cameraAngle: "eye_level" as const,
  };

  it("includes left-X% constraint when preserveRightPercent is set", () => {
    const result = buildEnrichedImagePrompt({
      ...baseParams,
      preserveRightPercent: 30,
    });
    expect(result).toContain("left 70%");
    expect(result).toContain("rightmost 30%");
  });

  it("includes correct safe width (100 - preserveRightPercent)", () => {
    const result = buildEnrichedImagePrompt({
      ...baseParams,
      preserveRightPercent: 25,
    });
    expect(result).toContain("left 75%");
    expect(result).toContain("rightmost 25%");
  });

  it("omits spatial constraint when preserveRightPercent is 0", () => {
    const result = buildEnrichedImagePrompt({
      ...baseParams,
      preserveRightPercent: 0,
    });
    expect(result).not.toContain("rightmost");
  });

  it("omits spatial constraint when preserveRightPercent is not provided", () => {
    const result = buildEnrichedImagePrompt(baseParams);
    expect(result).not.toContain("rightmost");
  });
});

// ---------------------------------------------------------------------------
// buildEnrichedImagePrompt — anti-AI-tell instructions
// ---------------------------------------------------------------------------

describe("buildEnrichedImagePrompt — anti-AI-tell and realism modifiers", () => {
  it("includes anti-AI-tell instructions", () => {
    const result = buildEnrichedImagePrompt({
      rawDescription: "a crowd in a stadium",
      shotType: "wide",
      cameraAngle: "high_angle",
    });
    expect(result).toContain("Natural imperfections");
    expect(result).toContain("realistic skin texture");
  });
});

// ---------------------------------------------------------------------------
// buildIllustrationImagePrompt — no photography specs
// ---------------------------------------------------------------------------

describe("buildIllustrationImagePrompt — illustration style", () => {
  it("includes the raw description", () => {
    const result = buildIllustrationImagePrompt({
      rawDescription: "a stick figure explaining a graph",
    });
    expect(result).toContain("a stick figure explaining a graph");
  });

  it("does NOT include camera angle text", () => {
    const result = buildIllustrationImagePrompt({
      rawDescription: "a stick figure explaining a graph",
    });
    expect(result).not.toContain("Camera angle");
  });

  it("does NOT include mm lens specs", () => {
    const result = buildIllustrationImagePrompt({
      rawDescription: "a stick figure at whiteboard",
    });
    expect(result).not.toMatch(/\d+mm/);
  });

  it("does NOT include aperture/f-stop specs", () => {
    const result = buildIllustrationImagePrompt({
      rawDescription: "a cartoon character running",
    });
    expect(result).not.toMatch(/f\/\d/);
  });

  it("includes flat 2D illustration style modifier", () => {
    const result = buildIllustrationImagePrompt({
      rawDescription: "two stick figures talking",
    });
    expect(result).toContain("flat 2D illustration style");
  });

  it("includes no photographic elements modifier", () => {
    const result = buildIllustrationImagePrompt({
      rawDescription: "two stick figures talking",
    });
    expect(result).toContain("no photographic elements");
  });

  it("includes styleAssetContext when provided", () => {
    const result = buildIllustrationImagePrompt({
      rawDescription: "a diagram of the solar system",
      styleAssetContext: "Main character: round-headed stickman.",
    });
    expect(result).toContain("Main character: round-headed stickman.");
  });

  it("applies stylePrefix when provided", () => {
    const result = buildIllustrationImagePrompt({
      rawDescription: "stick figure at chalkboard",
      stylePrefix: "Casually Explained style.",
    });
    expect(result.startsWith("Casually Explained style.")).toBe(true);
  });

  it("applies styleSuffix when provided", () => {
    const result = buildIllustrationImagePrompt({
      rawDescription: "stick figure at chalkboard",
      styleSuffix: "white background only.",
    });
    expect(result.endsWith("white background only.")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Prompt composition — parts joined by ", "
// ---------------------------------------------------------------------------

describe("buildEnrichedImagePrompt — part joining", () => {
  it("output is a single string with comma-space separators", () => {
    const result = buildEnrichedImagePrompt({
      rawDescription: "a river valley",
      shotType: "wide",
      cameraAngle: "high_angle",
    });
    // Result should not have double commas
    expect(result).not.toContain(",,");
    expect(result).not.toContain(", ,");
  });

  it("output does not end with a trailing comma", () => {
    const result = buildEnrichedImagePrompt({
      rawDescription: "a river valley",
      shotType: "wide",
      cameraAngle: "high_angle",
    });
    expect(result.trim()).not.toMatch(/,\s*$/);
  });
});
