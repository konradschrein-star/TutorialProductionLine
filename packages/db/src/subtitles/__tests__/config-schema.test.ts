/**
 * config-schema tests
 *
 * Covers:
 * - defaultRemotionConfig round-trips through remotionConfigSchema
 * - defaultFfmpegConfig round-trips through ffmpegConfigSchema
 * - wordsPerChunk out-of-range (9) is rejected
 * - punctuationMode invalid enum value ("weird") is rejected
 */

import { describe, it, expect } from "vitest";
import {
  RemotionConfigSchema,
  FfmpegConfigSchema,
  defaultRemotionConfig,
  defaultFfmpegConfig,
  defaultSubtitleStyle,
} from "../config-schema.js";

describe("remotionConfigSchema", () => {
  it("round-trips the default remotion config", () => {
    const parsed = RemotionConfigSchema.parse(defaultRemotionConfig);
    expect(parsed).toEqual(defaultRemotionConfig);
  });

  it("rejects wordsPerChunk: 9 (out of 1..8 range)", () => {
    const result = RemotionConfigSchema.safeParse({
      ...defaultRemotionConfig,
      wordsPerChunk: 9,
    });
    expect(result.success).toBe(false);
  });

  it("rejects punctuationMode: 'weird' (invalid enum)", () => {
    const result = RemotionConfigSchema.safeParse({
      ...defaultRemotionConfig,
      punctuationMode: "weird",
    });
    expect(result.success).toBe(false);
  });
});

describe("ffmpegConfigSchema", () => {
  it("round-trips the default ffmpeg config", () => {
    const parsed = FfmpegConfigSchema.parse(defaultFfmpegConfig);
    expect(parsed).toEqual(defaultFfmpegConfig);
  });

  it("rejects wordsPerChunk: 9 (out of 1..8 range)", () => {
    const result = FfmpegConfigSchema.safeParse({
      ...defaultFfmpegConfig,
      wordsPerChunk: 9,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Legacy FFmpeg config upgrade
// ---------------------------------------------------------------------------

describe("legacy FFmpeg config upgrade", () => {
  // The shape stored in every `engine: "ffmpeg"` preset row written before the
  // two engines were unified onto one config.
  const legacy = {
    schemaVersion: 2 as const,
    fontId: null,
    fontFamily: "Inter",
    fontSize: 44,
    colorScheme: "white_black" as const,
    primaryColor: "#FFFFFF",
    outlineColor: "#000000",
    outlineWidth: 3,
    wordsPerChunk: 6,
    verticalOffsetPercent: 8,
  };

  it("parses an untouched legacy row", () => {
    const parsed = FfmpegConfigSchema.parse(legacy);
    expect(parsed.fontFamily).toBe("Inter");
    expect(parsed.fontSize).toBe(44);
    expect(parsed.wordsPerChunk).toBe(6);
  });

  it("doubles the legacy ASS outline into a CSS centred stroke", () => {
    // ASS `Outline` is drawn entirely outside the glyph; the canonical
    // `stroke.width` is a centred CSS stroke, so it must be twice as wide to
    // show the same visible thickness.
    const parsed = FfmpegConfigSchema.parse(legacy);
    expect(parsed.stroke).toEqual({ color: "#000000", width: 6 });
  });

  it("maps verticalOffsetPercent onto the shared bottom margin", () => {
    const parsed = FfmpegConfigSchema.parse(legacy);
    expect(parsed.positionPreset).toBe("bottom");
    expect(parsed.safeMarginPercent).toBe(8);
  });

  it("replaces the backwards lime karaoke with a plain yellow highlight", () => {
    // The legacy engine put lime in the ASS SecondaryColour slot, which made
    // UNSPOKEN words lime and turned them white once spoken — the highlight ran
    // backwards, in a colour no preset had asked for.
    const parsed = FfmpegConfigSchema.parse(legacy);
    expect(parsed.fontColor).toBe("#FFFFFF");
    expect(parsed.animation.activeWordColor).toBe("#FFE000");
  });

  it("keeps an upgraded preset motionless", () => {
    const parsed = FfmpegConfigSchema.parse(legacy);
    expect(parsed.animation.enabled).toBe(false);
    expect(parsed.animation.activeWordScale).toBe(1);
  });

  it("maps the yellow_black scheme to yellow text", () => {
    const parsed = FfmpegConfigSchema.parse({
      ...legacy,
      colorScheme: "yellow_black" as const,
    });
    expect(parsed.fontColor).toBe("#FFE000");
  });

  it("honours a custom scheme's own colours", () => {
    const parsed = FfmpegConfigSchema.parse({
      ...legacy,
      colorScheme: "custom" as const,
      primaryColor: "#00FF00",
      outlineColor: "#112233",
    });
    expect(parsed.fontColor).toBe("#00FF00");
    expect(parsed.stroke.color).toBe("#112233");
  });

  it("passes an already-canonical config straight through", () => {
    const parsed = FfmpegConfigSchema.parse(defaultSubtitleStyle);
    expect(parsed).toEqual(defaultSubtitleStyle);
  });
});
