import { describe, it, expect } from "vitest";
import { RenderEngine } from "../../enums/render-engine.js";

const EXPECTED_VALUES = ["FFMPEG", "REMOTION"] as const;

describe("RenderEngine enum", () => {
  it("has exactly 2 values (guards against accidental deletion)", () => {
    expect(RenderEngine.options.length).toBe(2);
  });

  it("contains no duplicate values", () => {
    const unique = new Set(RenderEngine.options);
    expect(unique.size).toBe(RenderEngine.options.length);
  });

  it("rejects an unknown render engine", () => {
    expect(RenderEngine.safeParse("HANDBRAKE").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(RenderEngine.safeParse("").success).toBe(false);
  });

  it("contains all expected engine values", () => {
    for (const value of EXPECTED_VALUES) {
      expect(RenderEngine.safeParse(value).success, `${value} should be valid`).toBe(true);
    }
  });

  it("accepts FFMPEG (lightweight render path)", () => {
    expect(RenderEngine.safeParse("FFMPEG").success).toBe(true);
  });

  it("accepts REMOTION (heavyweight React render path)", () => {
    expect(RenderEngine.safeParse("REMOTION").success).toBe(true);
  });

  it("rejects lowercase engine name", () => {
    expect(RenderEngine.safeParse("ffmpeg").success).toBe(false);
  });

  it("rejects mixed-case engine name", () => {
    expect(RenderEngine.safeParse("Remotion").success).toBe(false);
  });
});
