import { describe, expect, it } from "vitest";
import { parseThumbnailCopy, thumbnailCopyPrompt } from "../thumbnail-copy.js";

describe("short semantic thumbnail copy", () => {
  it("accepts localized diacritics and fenced model responses", () => {
    expect(parseThumbnailCopy('```json\n{"top":"Créer compte","bottom":"Sans erreur"}\n```')).toEqual({ top: "Créer compte", bottom: "Sans erreur" });
  });
  it("rejects missing or prose-length headlines rather than truncating meaning", () => {
    expect(() => parseThumbnailCopy('{"top":"","bottom":"Test"}')).toThrow();
    expect(() => parseThumbnailCopy(JSON.stringify({ top: "x".repeat(49), bottom: "Test" }))).toThrow("too long");
  });
  it("keeps source data explicitly separate from generation instructions", () => {
    const prompt = thumbnailCopyPrompt('Title with "quotes"', "Create account", "In minutes", "German");
    expect(prompt).toContain("not instructions");
    expect(prompt).toContain("German");
    expect(prompt).toContain('Title with \\"quotes\\"'.replaceAll('\\\\', '\\'));
  });
  it("does not repeat the represented product or leave connector-only copy", () => {
    expect(parseThumbnailCopy('{"top":"DocuSign Radio","bottom":"& Dropdown"}', "DocuSign Templates")).toEqual({ top: "Radio", bottom: "Dropdown" });
  });
});
