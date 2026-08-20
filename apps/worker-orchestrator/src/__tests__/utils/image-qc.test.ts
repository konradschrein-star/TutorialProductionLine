import { runAutoImageQc } from "../../utils/image-qc.js";
import type { ImageQcEntry, ImageQcConfig } from "../../utils/image-qc.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Builds an ImageQcEntry that always passes the default 50 KB threshold. */
function makeValidImage(key = "channel/video/img-001.png"): ImageQcEntry {
  return { key, size_bytes: 200_000 }; // 200 KB — well above threshold
}

/** Builds an ImageQcEntry that always fails the default 50 KB threshold. */
function makeBlankImage(key = "channel/video/blank-001.png"): ImageQcEntry {
  return { key, size_bytes: 5_000 }; // 5 KB — blank/corrupt artifact
}

// ─── runAutoImageQc ───────────────────────────────────────────────────────────

describe("runAutoImageQc", () => {
  // ─── Empty list ───────────────────────────────────────────────────────

  describe("empty image list", () => {
    it("returns total=0, passedCount=0, failedCount=0", () => {
      const result = runAutoImageQc([]);

      expect(result.total).toBe(0);
      expect(result.passedCount).toBe(0);
      expect(result.failedCount).toBe(0);
    });

    it("returns an empty failedKeys array", () => {
      const result = runAutoImageQc([]);
      expect(result.failedKeys).toEqual([]);
    });

    it("auto-approves when there is nothing to check", () => {
      const result = runAutoImageQc([]);
      expect(result.autoApproved).toBe(true);
    });
  });

  // ─── All images above threshold ───────────────────────────────────────

  describe("all images above threshold", () => {
    it("counts every image as passed", () => {
      const images = [
        makeValidImage("img-1.png"),
        makeValidImage("img-2.png"),
        makeValidImage("img-3.png"),
      ];

      const result = runAutoImageQc(images);

      expect(result.total).toBe(3);
      expect(result.passedCount).toBe(3);
      expect(result.failedCount).toBe(0);
    });

    it("returns an empty failedKeys list", () => {
      const images = [makeValidImage("img-1.png"), makeValidImage("img-2.png")];
      const result = runAutoImageQc(images);
      expect(result.failedKeys).toEqual([]);
    });

    it("auto-approves the batch", () => {
      const images = [makeValidImage("img-1.png"), makeValidImage("img-2.png")];
      const result = runAutoImageQc(images);
      expect(result.autoApproved).toBe(true);
    });
  });

  // ─── All images below threshold ───────────────────────────────────────

  describe("all images below threshold", () => {
    it("counts every image as failed", () => {
      const images = [
        makeBlankImage("blank-1.png"),
        makeBlankImage("blank-2.png"),
      ];

      const result = runAutoImageQc(images);

      expect(result.total).toBe(2);
      expect(result.passedCount).toBe(0);
      expect(result.failedCount).toBe(2);
    });

    it("includes all failing keys in failedKeys", () => {
      const images = [makeBlankImage("blank-1.png"), makeBlankImage("blank-2.png")];
      const result = runAutoImageQc(images);
      expect(result.failedKeys).toEqual(["blank-1.png", "blank-2.png"]);
    });

    it("does NOT auto-approve (100% failure rate far exceeds 5% tolerance)", () => {
      const images = [makeBlankImage("blank-1.png"), makeBlankImage("blank-2.png")];
      const result = runAutoImageQc(images);
      expect(result.autoApproved).toBe(false);
    });
  });

  // ─── Mixed sizes ──────────────────────────────────────────────────────

  describe("mixed valid and blank images", () => {
    it("correctly counts passed and failed", () => {
      const images = [
        makeValidImage("ok-1.png"),
        makeBlankImage("bad-1.png"),
        makeValidImage("ok-2.png"),
        makeBlankImage("bad-2.png"),
        makeValidImage("ok-3.png"),
      ];

      const result = runAutoImageQc(images);

      expect(result.total).toBe(5);
      expect(result.passedCount).toBe(3);
      expect(result.failedCount).toBe(2);
    });

    it("includes only the failing keys in failedKeys", () => {
      const images = [
        makeValidImage("ok-1.png"),
        makeBlankImage("bad-1.png"),
        makeValidImage("ok-2.png"),
      ];

      const result = runAutoImageQc(images);

      expect(result.failedKeys).toEqual(["bad-1.png"]);
    });

    it("auto-approves when the failure rate is within the default 5% tolerance", () => {
      // 1 failure out of 40 images = 2.5% — within the 5% default tolerance
      const images: ImageQcEntry[] = [
        ...Array.from({ length: 39 }, (_, i) => makeValidImage(`ok-${i}.png`)),
        makeBlankImage("bad-1.png"),
      ];

      const result = runAutoImageQc(images);

      expect(result.autoApproved).toBe(true);
    });

    it("does NOT auto-approve when the failure rate exceeds the default 5% tolerance", () => {
      // 3 failures out of 20 images = 15% — above the 5% default tolerance
      const images: ImageQcEntry[] = [
        ...Array.from({ length: 17 }, (_, i) => makeValidImage(`ok-${i}.png`)),
        makeBlankImage("bad-1.png"),
        makeBlankImage("bad-2.png"),
        makeBlankImage("bad-3.png"),
      ];

      const result = runAutoImageQc(images);

      expect(result.autoApproved).toBe(false);
    });

    it("treats exactly 5% failure rate as auto-approved (boundary: <=)", () => {
      // 1 failure out of 20 = exactly 5%
      const images: ImageQcEntry[] = [
        ...Array.from({ length: 19 }, (_, i) => makeValidImage(`ok-${i}.png`)),
        makeBlankImage("bad-1.png"),
      ];

      const result = runAutoImageQc(images);

      expect(result.autoApproved).toBe(true);
    });
  });

  // ─── Single image edge cases ──────────────────────────────────────────

  describe("single image", () => {
    it("auto-approves a single valid image", () => {
      const result = runAutoImageQc([makeValidImage("img.png")]);

      expect(result.total).toBe(1);
      expect(result.passedCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(result.autoApproved).toBe(true);
    });

    it("does NOT auto-approve a single blank image (100% failure rate)", () => {
      const result = runAutoImageQc([makeBlankImage("blank.png")]);

      expect(result.total).toBe(1);
      expect(result.passedCount).toBe(0);
      expect(result.failedCount).toBe(1);
      expect(result.failedKeys).toEqual(["blank.png"]);
      expect(result.autoApproved).toBe(false);
    });
  });

  // ─── Custom config ────────────────────────────────────────────────────

  describe("custom config", () => {
    it("applies a custom minSizeBytes threshold", () => {
      const config: ImageQcConfig = { minSizeBytes: 100_000 };
      // 80 KB — passes default (50 KB) but fails custom (100 KB)
      const image: ImageQcEntry = { key: "img.png", size_bytes: 80_000 };

      const result = runAutoImageQc([image], config);

      expect(result.failedCount).toBe(1);
      expect(result.failedKeys).toEqual(["img.png"]);
    });

    it("applies a custom tolerancePct threshold", () => {
      // 50% tolerance — even 50% failure rate should be auto-approved
      const config: ImageQcConfig = { tolerancePct: 50 };
      const images: ImageQcEntry[] = [
        makeValidImage("ok.png"),
        makeBlankImage("bad.png"),
      ];

      const result = runAutoImageQc(images, config);

      expect(result.autoApproved).toBe(true);
    });

    it("zero tolerance rejects any single failure", () => {
      const config: ImageQcConfig = { tolerancePct: 0 };
      const images: ImageQcEntry[] = [
        makeValidImage("ok-1.png"),
        makeValidImage("ok-2.png"),
        makeBlankImage("bad-1.png"),
      ];

      const result = runAutoImageQc(images, config);

      expect(result.autoApproved).toBe(false);
    });
  });

  // ─── Result struct completeness ───────────────────────────────────────

  describe("result struct fields", () => {
    it("always returns all required fields", () => {
      const result = runAutoImageQc([makeValidImage("img.png")]);

      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("passedCount");
      expect(result).toHaveProperty("failedCount");
      expect(result).toHaveProperty("failedKeys");
      expect(result).toHaveProperty("autoApproved");
    });

    it("passedCount + failedCount always equals total", () => {
      const images: ImageQcEntry[] = [
        makeValidImage("ok-1.png"),
        makeBlankImage("bad-1.png"),
        makeValidImage("ok-2.png"),
      ];

      const result = runAutoImageQc(images);

      expect(result.passedCount + result.failedCount).toBe(result.total);
    });

    it("failedKeys.length always equals failedCount", () => {
      const images: ImageQcEntry[] = [
        makeBlankImage("bad-1.png"),
        makeValidImage("ok-1.png"),
        makeBlankImage("bad-2.png"),
      ];

      const result = runAutoImageQc(images);

      expect(result.failedKeys.length).toBe(result.failedCount);
    });
  });
});
