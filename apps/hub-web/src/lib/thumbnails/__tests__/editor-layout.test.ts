import { describe, expect, it } from "vitest";
import { thumbnailTextPadding, nextLayerId } from "../editor-layout";
import { assetPreferenceSchema, eligibleBackgrounds } from "../asset-preferences";
import { thumbnailLayoutSchema } from "../layout-document";
describe("thumbnail editing correctness", () => {
  it("reserves actual edge space for T/S strokes and shadows", () => {
    expect(thumbnailTextPadding(5)).toBe("8px");
    expect(thumbnailTextPadding(10, "0 16px")).toBe("10px 16px");
    expect(thumbnailTextPadding(5, "0", .5)).toBe("4px");
  });
  it("creates collision-free layer IDs for rapid additions", () => { expect(new Set(Array.from({ length: 100 }, () => nextLayerId())).size).toBe(100); });
  it("persists editable shapes and shadow settings", () => {
    expect(thumbnailLayoutSchema.parse({ aspectRatio: "16:9", elements: [{ id: "shape", type: "SHAPE", x: 0, y: 0, width: 200, height: 100, zIndex: 2, borderRadius: "24px", bgColor: "#fff", shadow: true }] }).elements[0]).toMatchObject({ type: "SHAPE", shadow: true });
  });
  it("excludes personal hidden/unchecked backgrounds without modifying the global list", () => {
    const backgrounds = [{ key: "a" }, { key: "b" }, { key: "c" }];
    expect(eligibleBackgrounds(backgrounds, { a: { hidden: true }, b: { includeInRotation: false } })).toEqual([{ key: "c" }]);
    expect(backgrounds).toHaveLength(3);
  });
  it("validates preference keys and explicit changes", () => {
    expect(assetPreferenceSchema.safeParse({ assetKey: "/background/office.png", hidden: true }).success).toBe(true);
    for (const assetKey of ["/../secret", "//evil.test/a", "", "https://evil.test/a"]) expect(assetPreferenceSchema.safeParse({ assetKey, hidden: true }).success).toBe(false);
    expect(assetPreferenceSchema.safeParse({ assetKey: "asset" }).success).toBe(false);
  });
});
