/**
 * parseMetadataResponse — unit tests
 *
 * Pure function: no IO, no mocks needed.
 * Covers happy-path parsing, field validation, edge cases, and tag sanitisation.
 */

import { parseMetadataResponse } from "../../youtube-metadata/parser.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Happy-path — well-formed JSON
// ═══════════════════════════════════════════════════════════════════════════════

describe("valid input", () => {
  it("returns a structured YouTubeMetadata object for well-formed JSON", () => {
    const raw = JSON.stringify({
      title: "Why Quantum Computers Will Change Everything",
      description: "Quantum computers are no longer science fiction.\n\nHere's what they can actually do.",
      tags: ["quantum computing", "technology", "physics"],
    });

    const result = parseMetadataResponse(raw);

    expect(result).not.toBeNull();
    expect(result!.title).toBe("Why Quantum Computers Will Change Everything");
    expect(result!.description).toContain("Quantum computers");
    expect(result!.tags).toEqual(["quantum computing", "technology", "physics"]);
  });

  it("trims whitespace from title and description", () => {
    const raw = JSON.stringify({
      title: "  Trimmed Title  ",
      description: "  Trimmed description.  ",
      tags: [],
    });

    const result = parseMetadataResponse(raw);

    expect(result!.title).toBe("Trimmed Title");
    expect(result!.description).toBe("Trimmed description.");
  });

  it("strips # prefix from tags and lowercases them", () => {
    const raw = JSON.stringify({
      title: "A valid title",
      description: "A valid description.",
      tags: ["#Technology", "#AI", "Machine Learning"],
    });

    const result = parseMetadataResponse(raw);

    expect(result!.tags).toEqual(["technology", "ai", "machine learning"]);
  });

  it("strips multiple leading # characters from tags", () => {
    const raw = JSON.stringify({
      title: "Title",
      description: "Description.",
      tags: ["##doubleHash"],
    });

    const result = parseMetadataResponse(raw);

    expect(result!.tags).toEqual(["doublehash"]);
  });

  it("removes non-string elements from tags array", () => {
    const raw = JSON.stringify({
      title: "Title",
      description: "Description.",
      tags: ["valid", 42, null, "also valid", true],
    });

    const result = parseMetadataResponse(raw);

    expect(result!.tags).toEqual(["valid", "also valid"]);
  });

  it("removes blank tags after trimming", () => {
    const raw = JSON.stringify({
      title: "Title",
      description: "Description.",
      tags: ["  ", "#  ", "real tag"],
    });

    const result = parseMetadataResponse(raw);

    expect(result!.tags).not.toContain("");
    expect(result!.tags).toContain("real tag");
  });

  it("normalises internal whitespace in tags to single spaces", () => {
    const raw = JSON.stringify({
      title: "Title",
      description: "Description.",
      tags: ["artificial   intelligence"],
    });

    const result = parseMetadataResponse(raw);

    expect(result!.tags).toEqual(["artificial intelligence"]);
  });

  it("accepts an empty tags array", () => {
    const raw = JSON.stringify({
      title: "Title",
      description: "Description.",
      tags: [],
    });

    const result = parseMetadataResponse(raw);

    expect(result).not.toBeNull();
    expect(result!.tags).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Title truncation — DB varchar(100) constraint
// ═══════════════════════════════════════════════════════════════════════════════

describe("title truncation at 100 characters", () => {
  it("passes through a title at exactly 100 characters without truncation", () => {
    const title = "A".repeat(100);
    const raw = JSON.stringify({ title, description: "Desc.", tags: [] });

    const result = parseMetadataResponse(raw);

    expect(result!.title).toHaveLength(100);
  });

  it("truncates a title longer than 100 characters", () => {
    const title = "A".repeat(101);
    const raw = JSON.stringify({ title, description: "Desc.", tags: [] });

    const result = parseMetadataResponse(raw);

    expect(result!.title.length).toBeLessThanOrEqual(100);
  });

  it("backs up to word boundary when slicing mid-word (last space > 70% of limit)", () => {
    // Construct a 105-char title where the last space is well above 70 chars
    // "The quick brown fox jumped over the lazy dog " (44) + filler to push over 100
    const words = "The quick brown fox jumped over the lazy dog and then some more stuff here";
    // Force length > 100 by appending non-space chars
    const title = words + "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"; // push over 100
    expect(title.length).toBeGreaterThan(100);

    const raw = JSON.stringify({ title, description: "Desc.", tags: [] });
    const result = parseMetadataResponse(raw);

    expect(result!.title.length).toBeLessThanOrEqual(100);
    // Result must not end mid-word (no trailing non-space-then-cut)
    expect(result!.title).not.toMatch(/\s$/); // no trailing space
  });

  it("does not produce a title longer than 100 chars under any input", () => {
    const longTitle = "This is a very long title that definitely exceeds the one hundred character database constraint limit here";
    const raw = JSON.stringify({ title: longTitle, description: "Desc.", tags: [] });

    const result = parseMetadataResponse(raw);

    expect(result!.title.length).toBeLessThanOrEqual(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Malformed / invalid input — must return null, never throw
// ═══════════════════════════════════════════════════════════════════════════════

describe("malformed input returns null", () => {
  it("returns null for a completely empty string", () => {
    expect(parseMetadataResponse("")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseMetadataResponse("{not valid json}")).toBeNull();
    expect(parseMetadataResponse("undefined")).toBeNull();
    expect(parseMetadataResponse("null")).toBeNull();
  });

  it("returns null for a JSON array at the top level", () => {
    expect(parseMetadataResponse('["title", "description", []]')).toBeNull();
  });

  it("returns null when title field is missing", () => {
    const raw = JSON.stringify({ description: "Desc.", tags: [] });
    expect(parseMetadataResponse(raw)).toBeNull();
  });

  it("returns null when description field is missing", () => {
    const raw = JSON.stringify({ title: "Title", tags: [] });
    expect(parseMetadataResponse(raw)).toBeNull();
  });

  it("returns null when tags field is missing", () => {
    const raw = JSON.stringify({ title: "Title", description: "Desc." });
    expect(parseMetadataResponse(raw)).toBeNull();
  });

  it("returns null when title is a non-string type", () => {
    const raw = JSON.stringify({ title: 42, description: "Desc.", tags: [] });
    expect(parseMetadataResponse(raw)).toBeNull();
  });

  it("returns null when description is a non-string type", () => {
    const raw = JSON.stringify({ title: "Title", description: ["line1"], tags: [] });
    expect(parseMetadataResponse(raw)).toBeNull();
  });

  it("returns null when tags is not an array", () => {
    const raw = JSON.stringify({ title: "Title", description: "Desc.", tags: "tag1,tag2" });
    expect(parseMetadataResponse(raw)).toBeNull();
  });

  it("returns null when title is an empty string after trimming", () => {
    const raw = JSON.stringify({ title: "   ", description: "Desc.", tags: [] });
    expect(parseMetadataResponse(raw)).toBeNull();
  });

  it("returns null when description is an empty string after trimming", () => {
    const raw = JSON.stringify({ title: "Title", description: "   ", tags: [] });
    expect(parseMetadataResponse(raw)).toBeNull();
  });

  it("returns null for a markdown-fenced JSON block (LLM commonly wraps output)", () => {
    const raw = '```json\n{"title":"T","description":"D","tags":[]}\n```';
    expect(parseMetadataResponse(raw)).toBeNull();
  });

  it("returns null for a JSON primitive (string)", () => {
    expect(parseMetadataResponse('"just a string"')).toBeNull();
  });

  it("returns null for a JSON numeric value", () => {
    expect(parseMetadataResponse("123")).toBeNull();
  });
});
