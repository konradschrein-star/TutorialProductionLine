import { describe, expect, it } from "vitest";
import { THUMBNAIL_COLUMN_WIDTH, THUMBNAIL_LANGUAGE_COLUMNS, hasCompleteThumbnailPack, thumbnailCanvasScale, thumbnailEditorAvailability, thumbnailEditorUrl } from "../workspace-model";

describe("thumbnail production workspace", () => {
  it("keeps the English source followed by the four launch locales", () => {
    expect(THUMBNAIL_LANGUAGE_COLUMNS).toEqual(["en", "de", "fr", "it", "sv"]);
  });
  it("reserves at least 320px of image width after cell padding and borders", () => {
    expect(THUMBNAIL_COLUMN_WIDTH.comfortable - 34).toBeGreaterThanOrEqual(320);
    expect(THUMBNAIL_COLUMN_WIDTH.large - 34).toBeGreaterThan(400);
  });
  it("offers a compact five-language overview without removing detailed previews", () => {
    expect(THUMBNAIL_COLUMN_WIDTH.compact * 5 + 196).toBeLessThanOrEqual(1100);
    expect(THUMBNAIL_COLUMN_WIDTH.compact).toBeLessThan(THUMBNAIL_COLUMN_WIDTH.comfortable);
  });
  it("deep links the chosen locale and safely encodes job identifiers", () => {
    expect(thumbnailEditorUrl("a&b", "de")).toBe("/thumbnails?jobId=a%26b&language=de");
    expect(thumbnailEditorUrl("job", "unknown")).toBe("/thumbnails?jobId=job");
    expect(thumbnailEditorUrl("job", "pt-BR")).toBe("/thumbnails?jobId=job&language=pt-br");
  });
  it("never enables row approval for absent, duplicated, or empty locale cells", () => {
    const complete = THUMBNAIL_LANGUAGE_COLUMNS.map((language) => ({ language, thumbnailId: language }));
    expect(hasCompleteThumbnailPack(complete)).toBe(true);
    expect(hasCompleteThumbnailPack(complete.slice(1))).toBe(false);
    expect(hasCompleteThumbnailPack([...complete.slice(1), complete[1]!])).toBe(false);
    expect(hasCompleteThumbnailPack(complete.map((v) => ({ ...v, thumbnailId: v.language === "en" ? null : v.thumbnailId })))).toBe(false);
    expect(hasCompleteThumbnailPack(complete.slice(0, 2), ["en", "de"])).toBe(true);
  });
  it("fits desktop and narrow canvases without changing logical export dimensions", () => {
    expect(thumbnailCanvasScale(1240, 800, false, "fit")).toBe(1.5);
    expect(thumbnailCanvasScale(360, 800, false, "fit")).toBe(.4);
    expect(thumbnailCanvasScale(1200, 450, true, "fit")).toBe(.85);
    expect(thumbnailCanvasScale(360, 800, false, "100")).toBe(1);
    expect(thumbnailCanvasScale(1240, 800, false, "fit", 720) * 450).toBeLessThanOrEqual(400);
  });
  it("derives visible editor modes from the channel profile before the legacy global fallback", () => {
    expect(thumbnailEditorAvailability("procedural", "ai")).toEqual({ procedural: true, ai: false });
    expect(thumbnailEditorAvailability("ai", "manual")).toEqual({ procedural: false, ai: true });
    expect(thumbnailEditorAvailability("both", "manual")).toEqual({ procedural: true, ai: true });
    expect(thumbnailEditorAvailability(undefined, "ai")).toEqual({ procedural: false, ai: true });
    expect(thumbnailEditorAvailability(undefined, "manual")).toEqual({ procedural: true, ai: false });
  });
});
