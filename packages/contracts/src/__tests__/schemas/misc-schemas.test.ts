/**
 * Tests for style-preset.ts and sentence-image.ts
 *
 * sentence-image.ts exports only a plain TypeScript interface (no Zod schema),
 * so those tests verify the interface shape via type assertions only.
 */

import { describe, it, expect } from "vitest";
import {
  ColorPaletteSchema,
  LowerThirdStyleSchema,
  TickerStyleSchema,
  CaptionStyleSchema,
  StylePresetSchema,
} from "../../schemas/style-preset.js";
import type { SentenceImage } from "../../schemas/sentence-image.js";

// ─── ColorPaletteSchema ───────────────────────────────────────────────────────

describe("ColorPaletteSchema", () => {
  const validPalette = {
    primary: "#FF0000",
    secondary: "#00FF00",
    accent: "#0000FF",
    background: "#000000",
    text: "#FFFFFF",
  };

  it("accepts a valid color palette", () => {
    expect(ColorPaletteSchema.safeParse(validPalette).success).toBe(true);
  });

  it("rejects missing primary", () => {
    const { primary: _, ...rest } = validPalette;
    expect(ColorPaletteSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects missing secondary", () => {
    const { secondary: _, ...rest } = validPalette;
    expect(ColorPaletteSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects missing accent", () => {
    const { accent: _, ...rest } = validPalette;
    expect(ColorPaletteSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects missing background", () => {
    const { background: _, ...rest } = validPalette;
    expect(ColorPaletteSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects missing text", () => {
    const { text: _, ...rest } = validPalette;
    expect(ColorPaletteSchema.safeParse(rest).success).toBe(false);
  });
});

// ─── LowerThirdStyleSchema ────────────────────────────────────────────────────

describe("LowerThirdStyleSchema", () => {
  it("accepts an empty object and applies all defaults", () => {
    const result = LowerThirdStyleSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.backgroundColor).toBe("rgba(0, 0, 0, 0.7)");
      expect(result.data.textColor).toBe("#FFFFFF");
      expect(result.data.position).toBe("bottom-left");
    }
  });

  it("accepts a fully specified lower third style", () => {
    const result = LowerThirdStyleSchema.safeParse({
      backgroundColor: "rgba(0, 0, 0, 0.9)",
      textColor: "#EEEEEE",
      accentColor: "#AAFF00",
      position: "bottom-right",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid position", () => {
    expect(LowerThirdStyleSchema.safeParse({ position: "top-left" }).success).toBe(false);
  });

  it("accepts all valid positions", () => {
    for (const pos of ["bottom-left", "bottom-center", "bottom-right"]) {
      expect(LowerThirdStyleSchema.safeParse({ position: pos }).success).toBe(true);
    }
  });
});

// ─── TickerStyleSchema ────────────────────────────────────────────────────────

describe("TickerStyleSchema", () => {
  it("accepts an empty object and applies all defaults", () => {
    const result = TickerStyleSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.backgroundColor).toBe("rgba(200, 0, 0, 0.8)");
      expect(result.data.textColor).toBe("#FFFFFF");
      expect(result.data.speed).toBe(900);
    }
  });

  it("rejects non-positive speed", () => {
    expect(TickerStyleSchema.safeParse({ speed: 0 }).success).toBe(false);
  });

  it("rejects negative speed", () => {
    expect(TickerStyleSchema.safeParse({ speed: -1 }).success).toBe(false);
  });
});

// ─── CaptionStyleSchema ───────────────────────────────────────────────────────

describe("CaptionStyleSchema", () => {
  it("accepts an empty object and applies all defaults", () => {
    const result = CaptionStyleSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.activeColor).toBe("#FFD700");
      expect(result.data.inactiveColor).toBe("#FFFFFF");
      expect(result.data.fontSize).toBe(2);
      expect(result.data.activeFontSize).toBe(2.5);
    }
  });

  it("rejects non-positive fontSize", () => {
    expect(CaptionStyleSchema.safeParse({ fontSize: 0 }).success).toBe(false);
  });

  it("rejects non-positive activeFontSize", () => {
    expect(CaptionStyleSchema.safeParse({ activeFontSize: 0 }).success).toBe(false);
  });
});

// ─── StylePresetSchema ────────────────────────────────────────────────────────

describe("StylePresetSchema", () => {
  it("accepts a minimal style preset with just a name", () => {
    expect(StylePresetSchema.safeParse({ name: "News Broadcast" }).success).toBe(true);
  });

  it("rejects a style preset without a name", () => {
    expect(StylePresetSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a fully specified style preset", () => {
    const result = StylePresetSchema.safeParse({
      name: "Dark News",
      prompt_prefix: "cinematic, dark, dramatic",
      prompt_suffix: "8k, photorealistic",
      color_palette: {
        primary: "#FF0000",
        secondary: "#00FF00",
        accent: "#AAFF00",
        background: "#000000",
        text: "#FFFFFF",
      },
      lower_third: {
        backgroundColor: "rgba(0,0,0,0.8)",
        textColor: "#FFF",
        position: "bottom-left",
      },
      ticker: {
        backgroundColor: "rgba(200,0,0,0.8)",
        textColor: "#FFF",
        speed: 900,
      },
      captions: {
        activeColor: "#FFD700",
        inactiveColor: "#FFFFFF",
        fontSize: 2,
        activeFontSize: 2.5,
      },
    });
    expect(result.success).toBe(true);
  });

  it("optional fields can all be omitted", () => {
    const result = StylePresetSchema.safeParse({ name: "Minimal" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.prompt_prefix).toBeUndefined();
      expect(result.data.prompt_suffix).toBeUndefined();
      expect(result.data.color_palette).toBeUndefined();
    }
  });
});

// ─── SentenceImage interface (type-level tests) ───────────────────────────────

describe("SentenceImage interface", () => {
  it("accepts a minimal valid SentenceImage object", () => {
    // SentenceImage is a plain TS interface — no Zod schema.
    // We verify a conformant object can be assigned to the type at runtime.
    const sentence: SentenceImage = {
      sentence_text: "The economy grew by 3% last quarter.",
      image_prompt: "A rising graph overlaid on a city skyline.",
    };
    expect(sentence.sentence_text).toBe("The economy grew by 3% last quarter.");
    expect(sentence.image_prompt).toBe("A rising graph overlaid on a city skyline.");
  });

  it("accepts optional fields being set", () => {
    const sentence: SentenceImage = {
      sentence_text: "Markets rallied.",
      image_prompt: "Stock exchange trading floor.",
      enriched_image_prompt: "Stock exchange, wide angle, golden hour lighting.",
      r2_key: "channel1/job1/scene_0_img_0.jpg",
      group_index: 0,
      is_key_fact: true,
      key_fact_text: "Markets +3%",
      start_frame: 120,
      end_frame: 240,
      duration_frames: 120,
    };
    expect(sentence.is_key_fact).toBe(true);
    expect(sentence.group_index).toBe(0);
  });
});
