import { describe, it, expect } from "vitest";
import { ProductionVersion } from "../../enums/production-version.js";

const EXPECTED_VALUES = ["V1", "V2", "V3"] as const;

describe("ProductionVersion enum", () => {
  it("has exactly 3 values (guards against accidental deletion)", () => {
    expect(ProductionVersion.options.length).toBe(3);
  });

  it("contains no duplicate values", () => {
    const unique = new Set(ProductionVersion.options);
    expect(unique.size).toBe(ProductionVersion.options.length);
  });

  it("rejects an unknown production version", () => {
    expect(ProductionVersion.safeParse("V4").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(ProductionVersion.safeParse("").success).toBe(false);
  });

  it("contains all expected version values", () => {
    for (const value of EXPECTED_VALUES) {
      expect(ProductionVersion.safeParse(value).success, `${value} should be valid`).toBe(true);
    }
  });

  it("accepts V1 (clean layout)", () => {
    expect(ProductionVersion.safeParse("V1").success).toBe(true);
  });

  it("accepts V2 (parametric biome-based)", () => {
    expect(ProductionVersion.safeParse("V2").success).toBe(true);
  });

  it("accepts V3 (future)", () => {
    expect(ProductionVersion.safeParse("V3").success).toBe(true);
  });

  it("rejects lowercase version string", () => {
    expect(ProductionVersion.safeParse("v2").success).toBe(false);
  });

  it("rejects a number instead of a version string", () => {
    expect(ProductionVersion.safeParse(2).success).toBe(false);
  });
});
