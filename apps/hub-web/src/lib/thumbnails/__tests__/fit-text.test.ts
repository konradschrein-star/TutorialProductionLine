import { describe, expect, it } from "vitest";
import { fitThumbnailText } from "../fit-text";
describe("measured headline fitting", () => {
  it("fits wide glyphs more tightly than narrow glyphs", () => {
    const box = { width: 200, height: 100, preferredSize: 64 };
    expect(fitThumbnailText(box, (size) => ({ width: size * 8, height: size }))).toBeLessThan(fitThumbnailText(box, (size) => ({ width: size * 2, height: size })));
  });
  it("rejects unreadable long translations", () => {
    expect(() => fitThumbnailText({ width: 100, height: 60, preferredSize: 64 }, (size) => ({ width: size * 20, height: size }))).toThrow("Shorten");
  });
  it("accounts for height as well as width", () => {
    expect(fitThumbnailText({ width: 500, height: 30, preferredSize: 64 }, (size) => ({ width: size, height: size }))).toBeLessThanOrEqual(30);
  });
});
