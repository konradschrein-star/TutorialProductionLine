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
      '{"description":"Do the thing.","tags":["gmail 2fa","security"],"thumbnail_text_top":"LOCK IT DOWN","thumbnail_text_bottom":"IN 2 MINUTES"}',
    );
    expect(r.description).toBe("Do the thing.");
    expect(r.tags).toEqual(["gmail 2fa", "security"]);
    expect(r.thumbnailTextTop).toBe("LOCK IT DOWN");
    expect(r.thumbnailTextBottom).toBe("IN 2 MINUTES");
  });

  it("survives the fenced code block models insist on adding", () => {
    const r = parseUploadMetadataResponse(
      'Sure! Here you go:\n```json\n{"description":"Do the thing.","tags":["a"],"thumbnail_text_top":"SECURE GMAIL","thumbnail_text_bottom":"RIGHT NOW"}\n```\nHope that helps!',
    );
    expect(r.description).toBe("Do the thing.");
    expect(r.tags).toEqual(["a"]);
  });

  it("returns nulls for unparseable output rather than guessing", () => {
    expect(parseUploadMetadataResponse("I cannot help with that.")).toEqual({
      description: null,
      tags: null,
      thumbnailTextTop: null,
      thumbnailTextBottom: null,
    });
    expect(parseUploadMetadataResponse("{not json at all")).toEqual({
      description: null,
      tags: null,
      thumbnailTextTop: null,
      thumbnailTextBottom: null,
    });
    expect(parseUploadMetadataResponse("")).toEqual({
      description: null,
      tags: null,
      thumbnailTextTop: null,
      thumbnailTextBottom: null,
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

  it("returns null thumbnail copy instead of inventing a fallback", () => {
    const missing = parseUploadMetadataResponse(
      '{"description":"x","tags":["gmail"]}',
    );
    expect(missing.thumbnailTextTop).toBeNull();
    expect(missing.thumbnailTextBottom).toBeNull();

    const invalid = parseUploadMetadataResponse(
      JSON.stringify({
        description: "x",
        tags: ["gmail"],
        thumbnail_text_top: "LEARN FAST",
        thumbnail_text_bottom: "STEP BY STEP",
      }),
    );
    expect(invalid.thumbnailTextTop).toBeNull();
    expect(invalid.thumbnailTextBottom).toBeNull();

    const tooLong = parseUploadMetadataResponse(
      JSON.stringify({
        description: "x",
        tags: ["gmail"],
        thumbnail_text_top: "   ",
        thumbnail_text_bottom: "x".repeat(49),
      }),
    );
    expect(tooLong.thumbnailTextTop).toBeNull();
    expect(tooLong.thumbnailTextBottom).toBeNull();
  });
});

describe("buildUploadMetadataPrompt", () => {
  it("includes the title and forbids inventing details", () => {
    const p = buildUploadMetadataPrompt("Set up 2FA", "Step one...", "en");
    expect(p).toContain("Set up 2FA");
    expect(p).toContain("Never invent");
    expect(p).toContain("thumbnail_text_top");
    expect(p).toContain("Never use generic filler");
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
