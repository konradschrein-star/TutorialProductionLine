import { describe, it, expect } from "vitest";
import { ContentFormat } from "../../enums/content-format.js";

const EXPECTED_VALUES = [
  "EXPLAINER",
  "NEWS_BROADCAST",
  "DOCUMENTARY",
  "POLITICAL_COMMENTARY",
  "TECH_COMPARISON",
  "DAY_IN_THE_LIFE",
  "HISTORICAL_WHAT_IF",
  "VIDEO_ESSAY",
  "CASUALLY_EXPLAINED",
  "STICKMAN_ANIMATION",
  "SELF_NARRATED_STORY",
  "BUNDESTAG",
] as const;

describe("ContentFormat enum", () => {
  it("has exactly 17 values (guards against accidental deletion)", () => {
    // 16 → 17 on 2026-08-15 with BUSINESS_PLAN_HUB.
    expect(ContentFormat.options.length).toBe(17);
  });

  it("contains no duplicate values", () => {
    const unique = new Set(ContentFormat.options);
    expect(unique.size).toBe(ContentFormat.options.length);
  });

  it("rejects an unknown format value", () => {
    expect(ContentFormat.safeParse("COOKING_SHOW").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(ContentFormat.safeParse("").success).toBe(false);
  });

  it("contains all expected format values", () => {
    for (const value of EXPECTED_VALUES) {
      expect(
        ContentFormat.safeParse(value).success,
        `${value} should be valid`,
      ).toBe(true);
    }
  });

  it("rejects lowercase version of a valid format", () => {
    // Enum values are SCREAMING_SNAKE_CASE — lowercase must fail
    expect(ContentFormat.safeParse("explainer").success).toBe(false);
  });

  it("contains the most recently added formats", () => {
    // Guards against regression if new formats were partially removed
    expect(ContentFormat.safeParse("CASUALLY_EXPLAINED").success).toBe(true);
    expect(ContentFormat.safeParse("STICKMAN_ANIMATION").success).toBe(true);
    expect(ContentFormat.safeParse("SELF_NARRATED_STORY").success).toBe(true);
    expect(ContentFormat.safeParse("BUNDESTAG").success).toBe(true);
  });
});
