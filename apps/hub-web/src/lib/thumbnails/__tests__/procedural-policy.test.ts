import { describe, expect, it } from "vitest";
import { distributeHeadlineWords, initialLocaleOnly, moveLayerBefore, removeRepresentedProduct, validateProceduralHeadlines } from "../procedural-policy";

describe("procedural thumbnail policy", () => {
  it("accepts one to four independently positioned single-line blocks with four total words", () => {
    expect(validateProceduralHeadlines([
      { type: "TEXT", text: "DELETE PHOTO" },
      { type: "TEXT", text: "IN GOOGLE" },
    ])).toBeNull();
    expect(validateProceduralHeadlines([{ type: "TEXT", text: "FIX GOOGLE DRIVE NOW" }])).toBeNull();
    expect(validateProceduralHeadlines([
      { type: "TEXT", text: "FIX" },
      { type: "TEXT", text: "GOOGLE" },
      { type: "TEXT", text: "DRIVE" },
      { type: "TEXT", text: "NOW" },
    ])).toBeNull();
  });

  it("rejects overflow instead of semantically truncating it", () => {
    const copy = "DO NOT DELETE THIS PHOTO";
    expect(validateProceduralHeadlines([{ type: "TEXT", text: copy }])).toMatch(/no more than four words/i);
    expect(copy).toBe("DO NOT DELETE THIS PHOTO");
  });

  it("rejects wrapped or more than four headline blocks", () => {
    expect(validateProceduralHeadlines([{ type: "TEXT", text: "DELETE\nPHOTO" }])).toMatch(/one line/i);
    expect(validateProceduralHeadlines([
      { type: "TEXT", text: "ONE" },
      { type: "TEXT", text: "TWO" },
      { type: "TEXT", text: "THREE" },
      { type: "TEXT", text: "FOUR" },
      { type: "TEXT", text: "FIVE" },
    ])).toMatch(/one and four/i);
  });

  it("balances four words into the requested number of hitboxes", () => {
    expect(distributeHeadlineWords(["ADD", "DOCUSIGN", "FIELDS"], 3)).toEqual(["ADD", "DOCUSIGN", "FIELDS"]);
    expect(distributeHeadlineWords(["DELETE", "PHOTO", "IN", "GOOGLE"], 3)).toEqual(["DELETE PHOTO", "IN", "GOOGLE"]);
    expect(distributeHeadlineWords(["FIX", "GOOGLE", "DRIVE"], 4)).toEqual(["FIX", "GOOGLE", "DRIVE"]);
    expect(distributeHeadlineWords(["RADIO", "&", "DROPDOWN"], 3)).toEqual(["RADIO &", "DROPDOWN"]);
  });

  it("removes the exact product name already represented by a logo", () => {
    expect(removeRepresentedProduct("DocuSign Radio & Dropdown", "DocuSign")).toBe("Radio & Dropdown");
    expect(removeRepresentedProduct("DocuSign Radio & Dropdown", "DocuSign Templates")).toBe("Radio & Dropdown");
    expect(removeRepresentedProduct("Add Fields", "DocuSign")).toBe("Add Fields");
  });

  it("defaults any locale deep link, including English, to locale-only editing", () => {
    expect(initialLocaleOnly("de", "en")).toBe(true);
    expect(initialLocaleOnly("en", "en")).toBe(true);
    expect(initialLocaleOnly(null, "de")).toBe(true);
    expect(initialLocaleOnly(null, "en")).toBe(false);
  });

  it("reorders layers without dropping their identities", () => {
    const layers = [
      { id: "back", zIndex: 1 },
      { id: "middle", zIndex: 2 },
      { id: "front", zIndex: 3 },
    ];
    const moved = moveLayerBefore(layers, "back", "front");
    expect([...moved].sort((a, b) => b.zIndex - a.zIndex).map((layer) => layer.id)).toEqual(["back", "front", "middle"]);
    expect(new Set(moved.map((layer) => layer.id))).toEqual(new Set(layers.map((layer) => layer.id)));
  });
});
