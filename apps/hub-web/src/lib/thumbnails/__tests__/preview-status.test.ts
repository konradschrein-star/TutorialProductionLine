import { expect, it } from "vitest";
import { thumbnailPreviewStatus } from "../preview-status";
it("a failed image must not claim it is ready for review", () => { expect(thumbnailPreviewStatus({ approved: false, hasThumbnail: true, previewFailed: true })).toBe("Restore image to review"); });
it("preserves saved approval while reporting unavailable bytes", () => { expect(thumbnailPreviewStatus({ approved: true, hasThumbnail: true, previewFailed: true })).toBe("Approved · image unavailable"); });
it("does not change the readiness of unrelated available images", () => { expect(thumbnailPreviewStatus({ approved: false, hasThumbnail: true, previewFailed: false })).toBe("Ready for review"); expect(thumbnailPreviewStatus({ approved: true, hasThumbnail: true, previewFailed: false })).toBe("Approved"); });
it("new and successfully reloaded images are not marked failed by another identity", () => { const failed = { oldImage: true } as Record<string, boolean>; expect(thumbnailPreviewStatus({ approved: false, hasThumbnail: true, previewFailed: Boolean(failed.newImage) })).toBe("Ready for review"); });
