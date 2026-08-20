import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  assertGeminiFreeTierModel,
  isGeminiFreeTierModel,
  geminiFreeTierKey,
  GEMINI_FREE_TIER_MODELS,
} from "../gemini-free-tier.js";

describe("gemini free-tier guard (§2.3)", () => {
  it("accepts every allow-listed free-tier model", () => {
    for (const m of GEMINI_FREE_TIER_MODELS) {
      expect(() => assertGeminiFreeTierModel(m)).not.toThrow();
      expect(isGeminiFreeTierModel(m)).toBe(true);
    }
  });

  it("rejects Pro / image / Veo / Lyria models (billed)", () => {
    const paid = [
      "gemini-3-pro",
      "gemini-3-pro-image-preview",
      "gemini-3.1-flash-image-preview",
      "nano-banana-2",
      "imagen-3",
      "veo-3",
      "lyria-2",
    ];
    for (const m of paid) {
      expect(() => assertGeminiFreeTierModel(m)).toThrow();
      expect(isGeminiFreeTierModel(m)).toBe(false);
    }
  });

  it("rejects empty / unknown models", () => {
    expect(() => assertGeminiFreeTierModel("")).toThrow();
    expect(() => assertGeminiFreeTierModel("some-random-model")).toThrow();
  });

  it("geminiFreeTierKey throws for a paid model even when a key is set", () => {
    const prev = process.env["GEMINI_DIRECT_API_KEY"];
    process.env["GEMINI_DIRECT_API_KEY"] = "test-key-1234";
    try {
      expect(() => geminiFreeTierKey("gemini-3-pro-image-preview")).toThrow();
      expect(geminiFreeTierKey("gemini-2.5-flash")).toBe("test-key-1234");
    } finally {
      if (prev === undefined) delete process.env["GEMINI_DIRECT_API_KEY"];
      else process.env["GEMINI_DIRECT_API_KEY"] = prev;
    }
  });
});

describe("gemini image path is deleted (§2.3 Layer 1)", () => {
  it("packages/media-core/src/google-gemini/image.ts no longer exists", () => {
    // Walk up from packages/config to the repo root.
    const repoRoot = join(__dirname, "..", "..", "..", "..");
    const deleted = join(
      repoRoot,
      "packages",
      "media-core",
      "src",
      "google-gemini",
      "image.ts",
    );
    expect(existsSync(deleted)).toBe(false);
  });

  it("media-core no longer exports generateImageGoogleDirect", () => {
    const repoRoot = join(__dirname, "..", "..", "..", "..");
    const mediaIndex = join(
      repoRoot,
      "packages",
      "media-core",
      "src",
      "index.ts",
    );
    const src = readFileSync(mediaIndex, "utf8");
    expect(src.includes("export { generateImageGoogleDirect }")).toBe(false);
  });
});
