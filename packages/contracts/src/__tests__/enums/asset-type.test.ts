import { describe, it, expect } from "vitest";
import { AssetType } from "../../enums/asset-type.js";

const EXPECTED_VALUES = [
  "audio/tts",
  "audio/music",
  "audio/sfx",
  "video/raw-va-footage",
  "video/composition",
  "video/final-render",
  "image/thumbnail",
  "image/broll",
  "text/script",
  "text/subtitles",
  "image/product-hero-candidate",
  "image/product-hero-selected",
] as const;

describe("AssetType enum", () => {
  it("has exactly 12 values (guards against accidental deletion)", () => {
    expect(AssetType.options.length).toBe(12);
  });

  it("contains no duplicate values", () => {
    const unique = new Set(AssetType.options);
    expect(unique.size).toBe(AssetType.options.length);
  });

  it("rejects an unknown asset type", () => {
    expect(AssetType.safeParse("video/drone-footage").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(AssetType.safeParse("").success).toBe(false);
  });

  it("contains all expected asset type values", () => {
    for (const value of EXPECTED_VALUES) {
      expect(AssetType.safeParse(value).success, `${value} should be valid`).toBe(true);
    }
  });

  it("uses MIME-style slash-separated category/subtype format", () => {
    // Spot-check that the format is category/subtype not SCREAMING_SNAKE
    expect(AssetType.safeParse("audio/tts").success).toBe(true);
    expect(AssetType.safeParse("AUDIO_TTS").success).toBe(false);
  });

  it("contains the audio asset types", () => {
    expect(AssetType.safeParse("audio/tts").success).toBe(true);
    expect(AssetType.safeParse("audio/music").success).toBe(true);
    expect(AssetType.safeParse("audio/sfx").success).toBe(true);
  });

  it("contains the video asset types", () => {
    expect(AssetType.safeParse("video/raw-va-footage").success).toBe(true);
    expect(AssetType.safeParse("video/composition").success).toBe(true);
    expect(AssetType.safeParse("video/final-render").success).toBe(true);
  });

  it("contains the image asset types", () => {
    expect(AssetType.safeParse("image/thumbnail").success).toBe(true);
    expect(AssetType.safeParse("image/broll").success).toBe(true);
    expect(AssetType.safeParse("image/product-hero-candidate").success).toBe(true);
    expect(AssetType.safeParse("image/product-hero-selected").success).toBe(true);
  });

  it("contains the text asset types", () => {
    expect(AssetType.safeParse("text/script").success).toBe(true);
    expect(AssetType.safeParse("text/subtitles").success).toBe(true);
  });
});
