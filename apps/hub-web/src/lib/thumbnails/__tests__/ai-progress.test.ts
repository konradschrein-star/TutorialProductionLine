import { expect, it } from "vitest";
import { currentThumbnailLocales, thumbnailBatchProgress } from "../ai-progress";
const now = Date.parse("2026-09-09T12:00:00Z");
const batch = { requestId: "batch", count: 5, createdAt: new Date(now), attempted: [] };
it("shows all five persisted variants before any worker admits work", () => {
  const result = thumbnailBatchProgress(batch, [], now);
  expect(result.count).toBe(5); expect(result.completed).toBe(0);
  expect(result.variants.every(item => item.state === "waiting_for_worker")).toBe(true);
});
it("marks stale generating and unadmitted work unknown without granting retry", () => {
  const result = thumbnailBatchProgress({ ...batch, createdAt: new Date(now - 3600000) }, [{ requestId: "batch", index: 0, status: "generating", path: null, updatedAt: new Date(now - 3600000) }], now);
  expect(result.variants.every(item => item.state === "waiting_unknown")).toBe(true);
  expect(JSON.stringify(result)).not.toContain("retry");
});
it("counts only current-batch completed bytes, never an old batch or missing path", () => {
  expect(thumbnailBatchProgress(batch, [{ requestId: "old", index: 0, status: "completed", path: "/old", updatedAt: new Date(now) }, { requestId: "batch", index: 1, status: "completed", path: null, updatedAt: new Date(now) }, { requestId: "batch", index: 2, status: "completed", path: "/saved", updatedAt: new Date(now) }], now).completed).toBe(1);
});
it("represents one-image refinement without fabricating five outputs", () => {
  expect(thumbnailBatchProgress({ ...batch, count: 1 }, [], now).variants).toHaveLength(1);
});
it("never shows old English bytes as current localization", () => {
  const rows = [{ sourceThumbnailId: "en", approvalRevision: "old-bytes", language: "de" }, { sourceThumbnailId: "old-image", approvalRevision: "current", language: "fr" }, { sourceThumbnailId: "en", approvalRevision: "current", language: "sv" }];
  expect(currentThumbnailLocales(rows, "en", "current")).toEqual([rows[2]]);
  expect(currentThumbnailLocales(rows, "en", null)).toEqual([]);
});
