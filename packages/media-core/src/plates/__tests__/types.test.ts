import { describe, expect, it } from "vitest";

import {
  DARK_PLATE_THEME,
  GROUND_THEME_SLUGS,
  HEADLINE_MAX_CHARS,
  LIGHT_PLATE_THEME,
  MIN_LEGIBLE_PX,
  PLATE_PALETTE,
  PlateError,
  assertAspectMatchesCanvas,
  assertCanvasSize,
  assertLegible,
  assertNotYellow,
  assertPlatePaletteIsOcean,
  getPlateTheme,
  isGroundThemeSlug,
  scaleFor1080,
  themeForGround,
} from "../types.js";

describe("themeForGround", () => {
  it("maps the planner's two ground slugs onto the two mats", () => {
    expect(themeForGround("ground-default", "test")).toBe("dark");
    expect(themeForGround("ground-inverse", "test")).toBe("light");
  });

  it("throws rather than defaulting an unknown grade", () => {
    expect(() => themeForGround("ground-defualt", "scene s01")).toThrow(
      PlateError,
    );
    expect(() => themeForGround("ground-defualt", "scene s01")).toThrow(
      /scene s01/,
    );
  });

  it("throws on a missing grade instead of picking the dark mat", () => {
    expect(() => themeForGround(undefined, "scene s07")).toThrow(PlateError);
    expect(() => themeForGround(null, "scene s07")).toThrow(PlateError);
  });

  it("guards every slug it claims to know", () => {
    for (const slug of GROUND_THEME_SLUGS) {
      expect(isGroundThemeSlug(slug)).toBe(true);
      expect(() => themeForGround(slug, "test")).not.toThrow();
    }
    expect(isGroundThemeSlug("dark")).toBe(false);
  });
});

describe("getPlateTheme", () => {
  it("returns the two mats with the palette's ground colours", () => {
    expect(getPlateTheme("dark").colors.ground).toBe(PLATE_PALETTE.groundDark);
    expect(getPlateTheme("light").colors.ground).toBe(
      PLATE_PALETTE.groundLight,
    );
  });

  it("pins the mats the build brief names", () => {
    expect(DARK_PLATE_THEME.colors.ground).toBe("#0b0f14");
    expect(LIGHT_PLATE_THEME.colors.ground).toBe("#f2f1ec");
  });

  it("gives both mats every token, so nothing branches on theme name", () => {
    const darkKeys = Object.keys(DARK_PLATE_THEME.colors).sort();
    const lightKeys = Object.keys(LIGHT_PLATE_THEME.colors).sort();
    expect(darkKeys).toEqual(lightKeys);
  });
});

describe("assertNotYellow", () => {
  it("passes every swatch of the transcribed palette", () => {
    expect(() => assertPlatePaletteIsOcean()).not.toThrow();
  });

  it("rejects the design system's gold", () => {
    expect(() => assertNotYellow("#c9a24b", "gold")).toThrow(PlateError);
    expect(() => assertNotYellow("#ffff00", "yellow")).toThrow(/yellow\/gold/);
  });

  it("does not mistake the warm near-white mat for gold", () => {
    expect(() => assertNotYellow("#f2f1ec", "groundLight")).not.toThrow();
  });

  it("rejects a value that is not a hex literal", () => {
    expect(() => assertNotYellow("rgb(1,2,3)", "x")).toThrow(PlateError);
  });
});

describe("assertLegible", () => {
  it("accepts the floor exactly", () => {
    expect(assertLegible(MIN_LEGIBLE_PX, "micro")).toBe(MIN_LEGIBLE_PX);
  });

  it("throws below the floor instead of shrinking type to fit", () => {
    expect(() => assertLegible(MIN_LEGIBLE_PX - 1, "scene s03 body")).toThrow(
      PlateError,
    );
    expect(() => assertLegible(12, "scene s03 body")).toThrow(
      /do not shrink the type/,
    );
  });

  it("throws on a non-finite size", () => {
    expect(() => assertLegible(Number.NaN, "x")).toThrow(PlateError);
  });
});

describe("assertCanvasSize", () => {
  it("accepts an even, positive canvas", () => {
    expect(() => assertCanvasSize(1920, 1080, "test")).not.toThrow();
  });

  it("rejects odd dimensions (half-pixel chroma on a yuv420p composite)", () => {
    expect(() => assertCanvasSize(1921, 1080, "test")).toThrow(PlateError);
    expect(() => assertCanvasSize(1920, 1081, "test")).toThrow(/odd/);
  });

  it("rejects zero, negatives and fractions", () => {
    expect(() => assertCanvasSize(0, 1080, "test")).toThrow(PlateError);
    expect(() => assertCanvasSize(-1920, 1080, "test")).toThrow(PlateError);
    expect(() => assertCanvasSize(1920.5, 1080, "test")).toThrow(PlateError);
  });
});

describe("assertAspectMatchesCanvas", () => {
  it("accepts a token that agrees with the canvas", () => {
    expect(assertAspectMatchesCanvas("16:9", 1920, 1080, "t")).toEqual({
      w: 16,
      h: 9,
    });
    expect(() =>
      assertAspectMatchesCanvas("9:16", 1080, 1920, "t"),
    ).not.toThrow();
  });

  it("throws when the token and the canvas disagree", () => {
    expect(() => assertAspectMatchesCanvas("9:16", 1920, 1080, "t")).toThrow(
      PlateError,
    );
  });

  it("throws on a malformed token", () => {
    expect(() => assertAspectMatchesCanvas("16x9", 1920, 1080, "t")).toThrow(
      PlateError,
    );
    expect(() => assertAspectMatchesCanvas("0:9", 1920, 1080, "t")).toThrow(
      PlateError,
    );
  });
});

describe("scaleFor1080", () => {
  it("is the identity at 1080p", () => {
    expect(scaleFor1080(80, 1080)).toBe(80);
  });

  it("scales with frame height so the 9:16 repurpose reuses the tokens", () => {
    expect(scaleFor1080(80, 1920)).toBeCloseTo(142.222, 3);
    expect(scaleFor1080(80, 540)).toBe(40);
  });

  it("throws on a non-positive frame height", () => {
    expect(() => scaleFor1080(80, 0)).toThrow(PlateError);
  });
});

describe("the headline budget", () => {
  it("is the same number the contracts schema enforces", () => {
    expect(HEADLINE_MAX_CHARS).toBe(68);
  });
});
