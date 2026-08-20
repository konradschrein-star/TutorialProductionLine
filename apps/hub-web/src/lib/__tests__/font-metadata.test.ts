import { describe, it, expect } from "vitest";
import {
  weightLabel,
  deriveFontWeights,
  resolveFontFamily,
  type ParsedFontInfo,
} from "../font-metadata";

describe("weightLabel", () => {
  it("maps exact standard weights", () => {
    expect(weightLabel(400)).toBe("Regular");
    expect(weightLabel(700)).toBe("Bold");
    expect(weightLabel(900)).toBe("Black");
    expect(weightLabel(100)).toBe("Thin");
  });

  it("snaps arbitrary weights to the nearest standard stop", () => {
    expect(weightLabel(430)).toBe("Regular");
    expect(weightLabel(650)).toBe("SemiBold");
    expect(weightLabel(1000)).toBe("Black");
    expect(weightLabel(0)).toBe("Thin");
  });
});

describe("deriveFontWeights (static fonts)", () => {
  it("uses OS/2 usWeightClass for a static font", () => {
    const info: ParsedFontInfo = {
      familyName: "Anton",
      subfamilyName: "Regular",
      usWeightClass: 400,
    };
    expect(deriveFontWeights(info, "/f/anton.ttf")).toEqual([
      { weight: 400, label: "Regular", file_path: "/f/anton.ttf" },
    ]);
  });

  it("defaults to 400/Regular when weight class is missing or zero", () => {
    expect(
      deriveFontWeights({ familyName: "X", usWeightClass: 0 }, "/f/x.ttf"),
    ).toEqual([{ weight: 400, label: "Regular", file_path: "/f/x.ttf" }]);
    expect(deriveFontWeights({ familyName: "X" }, "/f/x.ttf")).toEqual([
      { weight: 400, label: "Regular", file_path: "/f/x.ttf" },
    ]);
  });

  it("labels a bold static font", () => {
    expect(
      deriveFontWeights(
        { familyName: "THE BOLD Font", usWeightClass: 700 },
        "/f/bold.ttf",
      ),
    ).toEqual([{ weight: 700, label: "Bold", file_path: "/f/bold.ttf" }]);
  });
});

describe("deriveFontWeights (variable fonts)", () => {
  it("expands the wght axis into all standard stops within range, sharing one file", () => {
    const info: ParsedFontInfo = {
      familyName: "Inter",
      variationAxes: {
        wght: { name: "Weight", min: 100, default: 400, max: 900 },
      },
    };
    const weights = deriveFontWeights(info, "/f/inter.ttf");
    expect(weights).toHaveLength(9);
    expect(weights.map((w) => w.weight)).toEqual([
      100, 200, 300, 400, 500, 600, 700, 800, 900,
    ]);
    expect(weights.every((w) => w.file_path === "/f/inter.ttf")).toBe(true);
    expect(weights.find((w) => w.weight === 700)?.label).toBe("Bold");
  });

  it("clamps stops to a narrower axis range", () => {
    const info: ParsedFontInfo = {
      familyName: "Montserrat",
      variationAxes: {
        wght: { name: "Weight", min: 400, default: 400, max: 700 },
      },
    };
    expect(deriveFontWeights(info, "/f/m.ttf").map((w) => w.weight)).toEqual([
      400, 500, 600, 700,
    ]);
  });

  it("falls back to the axis default when no standard stop falls in range", () => {
    const info: ParsedFontInfo = {
      familyName: "Weird",
      variationAxes: {
        wght: { name: "Weight", min: 410, default: 450, max: 490 },
      },
    };
    expect(deriveFontWeights(info, "/f/w.ttf")).toEqual([
      { weight: 450, label: "Regular", file_path: "/f/w.ttf" },
    ]);
  });

  it("treats a degenerate axis (max<=min) as a static font", () => {
    const info: ParsedFontInfo = {
      familyName: "Static",
      usWeightClass: 500,
      variationAxes: {
        wght: { name: "Weight", min: 400, default: 400, max: 400 },
      },
    };
    expect(deriveFontWeights(info, "/f/s.ttf")).toEqual([
      { weight: 500, label: "Medium", file_path: "/f/s.ttf" },
    ]);
  });
});

describe("resolveFontFamily", () => {
  it("uses the parsed family name when present", () => {
    expect(resolveFontFamily({ familyName: "Komika Axis" }, "fallback")).toBe(
      "Komika Axis",
    );
  });

  it("falls back when the family name is empty/whitespace", () => {
    expect(resolveFontFamily({ familyName: "   " }, "My Upload")).toBe(
      "My Upload",
    );
    expect(
      resolveFontFamily(
        { familyName: undefined as unknown as string },
        "My Upload",
      ),
    ).toBe("My Upload");
  });
});
