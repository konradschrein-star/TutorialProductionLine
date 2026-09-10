import { expect, it, vi } from "vitest";
import sharp from "sharp";
import { inspectThumbnailQuality, qualityTextInstruction } from "../quality.js";
const image = async () => sharp({ create: { width: 1280, height: 720, channels: 3, background: "white" } }).composite([{ input: Buffer.from('<svg width="1280" height="720"><rect width="640" height="720" fill="black"/></svg>') }]).jpeg().toBuffer();
it("binds visual evidence to bytes, while keeping human approval required", async () => {
  const check = vi.fn().mockResolvedValue({ legible: true, textCorrect: true, referencePreserved: true, issues: [], repairInstructions: null });
  const bytes = await image();
  const result = await inspectThumbnailQuality(bytes, "HELLO WORLD", bytes, check);
  expect(result.status).toBe("passed"); expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(result.approval).toBe("human_required"); expect(check).toHaveBeenCalledTimes(1);
});
it("does not label failed or missing vision checks as passed or retry them", async () => {
  const check = vi.fn().mockRejectedValue(Error("private provider failure"));
  const result = await inspectThumbnailQuality(await image(), "HELLO", undefined, check);
  expect(result.status).toBe("unverified"); expect(result.visualCheck).toBe("unavailable");
  expect(JSON.stringify(result)).not.toContain("private provider"); expect(check).toHaveBeenCalledTimes(1);
});
it("flags blank images and unreadable or altered text without approving them", async () => {
  const bytes = await sharp({ create: { width: 1280, height: 720, channels: 3, background: "white" } }).png().toBuffer();
  const result = await inspectThumbnailQuality(bytes, "HELLO", undefined, async () => ({ legible: false, textCorrect: false, referencePreserved: false, issues: [], repairInstructions: "Enlarge the headline" }));
  expect(result.status).toBe("needs_review"); expect(result.checks.nonBlank).toBe(false);
  expect(result.repairInstructions).toBe("Enlarge the headline");
});
it("cannot verify reference preservation when no reference bytes were supplied", async () => {
  const result = await inspectThumbnailQuality(await image(), "HELLO", undefined, async () => ({ legible: true, textCorrect: true, referencePreserved: true, issues: [], repairInstructions: null }));
  expect(result.status).toBe("needs_review");
  expect(result.issues).toContain("Reference consistency needs human review.");
});
it("treats malformed vision output as unverified", async () => {
  const result = await inspectThumbnailQuality(await image(), "HELLO", undefined, async () => ({ approved: true }) as never);
  expect(result.status).toBe("unverified");
});
it("checks localized meaning against English reference, not an empty exact headline", async () => {
  const context = { localized: true, targetLanguage: "de" };
  const check = vi.fn().mockResolvedValue({ legible: true, textCorrect: true, referencePreserved: true, issues: [], repairInstructions: null });
  const bytes = await image();
  const result = await inspectThumbnailQuality(bytes, "", bytes, check, context);
  expect(check).toHaveBeenCalledWith(bytes, bytes, "", context);
  expect(qualityTextInstruction("", context)).toContain('target language "de"');
  expect(qualityTextInstruction("", context)).toContain("faithfully translate");
  expect(result.status).toBe("passed");
  expect(result.approval).toBe("human_required");
});
it("cannot pass an original with unknown wording even if vision returns all true", async () => {
  const bytes = await image();
  const result = await inspectThumbnailQuality(bytes, "", bytes, async () => ({ legible: true, textCorrect: true, referencePreserved: true, issues: [], repairInstructions: null }));
  expect(result.status).toBe("needs_review");
  expect(qualityTextInstruction("")).toContain("textCorrect must be false");
});
