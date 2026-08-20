import { describe, it, expect } from "vitest";
import {
  parseUploadMetadataResponse,
  buildUploadMetadataPrompt,
} from "../../utils/tutorial/upload-metadata.js";

/**
 * The parser's job is to extract real metadata or admit it has none. It must
 * never manufacture a description — a plausible sentence nobody wrote gets
 * published under the owner's channel.
 */

describe("parseUploadMetadataResponse", () => {
  it("parses a clean JSON response", () => {
    const r = parseUploadMetadataResponse(
      '{"description":"Do the thing.","tags":["gmail 2fa","security"]}',
    );
    expect(r.description).toBe("Do the thing.");
    expect(r.tags).toEqual(["gmail 2fa", "security"]);
  });

  it("survives the fenced code block models insist on adding", () => {
    const r = parseUploadMetadataResponse(
      'Sure! Here you go:\n```json\n{"description":"Do the thing.","tags":["a"]}\n```\nHope that helps!',
    );
    expect(r.description).toBe("Do the thing.");
    expect(r.tags).toEqual(["a"]);
  });

  it("returns nulls for unparseable output rather than guessing", () => {
    expect(parseUploadMetadataResponse("I cannot help with that.")).toEqual({
      description: null,
      tags: null,
    });
    expect(parseUploadMetadataResponse("{not json at all")).toEqual({
      description: null,
      tags: null,
    });
    expect(parseUploadMetadataResponse("")).toEqual({
      description: null,
      tags: null,
    });
  });

  it("treats an empty or whitespace description as absent", () => {
    expect(
      parseUploadMetadataResponse('{"description":"   ","tags":["a"]}')
        .description,
    ).toBeNull();
  });

  it("drops hashes, blanks, over-long tags and duplicates", () => {
    const r = parseUploadMetadataResponse(
      JSON.stringify({
        description: "x",
        tags: [
          "#gmail",
          "  ",
          "Gmail",
          "gmail",
          "a".repeat(31),
          "keep this one",
        ],
      }),
    );
    // "#gmail" -> "gmail"; "Gmail"/"gmail" dedupe case-insensitively.
    expect(r.tags).toEqual(["gmail", "keep this one"]);
  });

  it("caps tags at 15", () => {
    const many = Array.from({ length: 40 }, (_, i) => `tag${i}`);
    const r = parseUploadMetadataResponse(
      JSON.stringify({ description: "x", tags: many }),
    );
    expect(r.tags).toHaveLength(15);
  });

  it("returns null tags when the model sends a non-array", () => {
    expect(
      parseUploadMetadataResponse('{"description":"x","tags":"a, b, c"}').tags,
    ).toBeNull();
  });

  it("returns null tags when every candidate is rejected", () => {
    expect(
      parseUploadMetadataResponse('{"description":"x","tags":["","   "]}').tags,
    ).toBeNull();
  });
});

describe("buildUploadMetadataPrompt", () => {
  it("includes the title and forbids inventing details", () => {
    const p = buildUploadMetadataPrompt("Set up 2FA", "Step one...", "en");
    expect(p).toContain("Set up 2FA");
    expect(p).toContain("Never invent");
  });

  it("truncates a very long script rather than sending an hour of text", () => {
    const huge = "word ".repeat(50_000);
    const p = buildUploadMetadataPrompt("T", huge, "en");
    expect(p.length).toBeLessThan(6000);
  });

  it("asks for the requested language when it is not English", () => {
    expect(buildUploadMetadataPrompt("T", "s", "de")).toContain("in de");
    expect(buildUploadMetadataPrompt("T", "s", "en")).toContain("in English");
    expect(buildUploadMetadataPrompt("T", "s", null)).toContain("in English");
  });
});
