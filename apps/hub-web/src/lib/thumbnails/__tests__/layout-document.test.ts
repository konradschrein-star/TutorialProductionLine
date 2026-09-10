import { describe, expect, it } from "vitest";
import { readThumbnailLayout } from "../layout-document";

const layer = { id: "text-top", type: "TEXT", text: "CREATE ACCOUNT", x: 21, y: 33, width: 350, height: 95, zIndex: 4, fontSize: 42, fontWeight: "800", rotation: -4 };
describe("persisted thumbnail layouts", () => {
  it("round-trips operator geometry and copy", () => {
    const layout = { aspectRatio: "16:9", elements: [layer] };
    expect(readThumbnailLayout(JSON.stringify(layout))).toEqual(layout);
  });
  it("does not treat historical prompts or incomplete test fixtures as layouts", () => {
    for (const raw of [null, "make a thumbnail", "{}", '{"elements":[]}']) expect(readThumbnailLayout(raw)).toBeNull();
  });
  it("rejects invalid geometry and duplicate IDs", () => {
    expect(readThumbnailLayout(JSON.stringify({ aspectRatio: "16:9", elements: [{ ...layer, width: -1 }] }))).toBeNull();
    expect(readThumbnailLayout(JSON.stringify({ aspectRatio: "16:9", elements: [layer, layer] }))).toBeNull();
  });
});
