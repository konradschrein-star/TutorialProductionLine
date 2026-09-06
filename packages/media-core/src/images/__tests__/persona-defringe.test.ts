import { describe, expect, it } from "vitest";
import { defringePersonaRgba } from "../persona-defringe.js";

function pixel(
  rgba: Uint8Array,
  width: number,
  x: number,
  y: number,
): number[] {
  const offset = (y * width + x) * 4;
  return Array.from(rgba.slice(offset, offset + 4));
}

describe("defringePersonaRgba", () => {
  it("replaces a keyed hair fringe with nearby hair colour", () => {
    const width = 9;
    const height = 9;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 2; y <= 6; y += 1) {
      for (let x = 2; x <= 6; x += 1) {
        const offset = (y * width + x) * 4;
        const edge = x === 2 || x === 6 || y === 2 || y === 6;
        rgba.set(edge ? [8, 155, 66, 255] : [72, 48, 34, 255], offset);
      }
    }

    const cleaned = defringePersonaRgba(rgba, width, height, {
      edgeRadius: 3,
      hairRegionRatio: 0.75,
    });

    expect(pixel(cleaned, width, 2, 4)[3]).toBe(0);
    expect(pixel(cleaned, width, 4, 4)).toEqual([72, 48, 34, 255]);
  });

  it("preserves an intentional green garment away from the keyed edge", () => {
    const width = 11;
    const height = 11;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 5; y <= 9; y += 1) {
      for (let x = 2; x <= 8; x += 1) {
        rgba.set([24, 118, 72, 255], (y * width + x) * 4);
      }
    }

    const cleaned = defringePersonaRgba(rgba, width, height, {
      edgeRadius: 2,
      hairRegionRatio: 0.4,
    });

    expect(pixel(cleaned, width, 5, 7)).toEqual([24, 118, 72, 255]);
  });

  it("drops almost-transparent green-screen noise", () => {
    const rgba = new Uint8Array([0, 255, 0, 5]);
    expect(defringePersonaRgba(rgba, 1, 1)).toEqual(
      new Uint8Array([0, 255, 0, 0]),
    );
  });
});
