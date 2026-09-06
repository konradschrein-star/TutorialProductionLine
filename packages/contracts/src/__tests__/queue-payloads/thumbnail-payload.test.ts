import { describe, expect, it } from "vitest";
import { ThumbnailPayloadSchema } from "../../queue-payloads/thumbnail-payload.js";

const base = {
  subjectKind: "tutorial_job",
  subjectId: "11111111-1111-4111-8111-111111111111",
  format: "TUTORIAL_STUDIO",
  title: "Notion einrichten",
  language: "de",
  channelId: "22222222-2222-4222-8222-222222222222",
};

describe("thumbnail payload localized copy", () => {
  it("accepts a complete two-line localized pair", () => {
    expect(
      ThumbnailPayloadSchema.safeParse({
        ...base,
        thumbnailTextTop: "NOTION RICHTIG",
        thumbnailTextBottom: "IN 2 MINUTEN",
      }).success,
    ).toBe(true);
  });

  it("rejects a partial or blank localized pair", () => {
    expect(
      ThumbnailPayloadSchema.safeParse({
        ...base,
        thumbnailTextTop: "NOTION RICHTIG",
      }).success,
    ).toBe(false);
    expect(
      ThumbnailPayloadSchema.safeParse({
        ...base,
        thumbnailTextTop: "NOTION RICHTIG",
        thumbnailTextBottom: " ",
      }).success,
    ).toBe(false);
  });

  it("rejects a tutorial with no durable localized copy", () => {
    expect(ThumbnailPayloadSchema.safeParse(base).success).toBe(false);
  });

  it("does not assume a tutorial language or channel", () => {
    const copy = {
      thumbnailTextTop: "NOTION RICHTIG",
      thumbnailTextBottom: "IN 2 MINUTEN",
    };
    expect(
      ThumbnailPayloadSchema.safeParse({
        ...base,
        ...copy,
        language: undefined,
      }).success,
    ).toBe(false);
    expect(
      ThumbnailPayloadSchema.safeParse({
        ...base,
        ...copy,
        channelId: undefined,
      }).success,
    ).toBe(false);
  });

  it("keeps the legacy English default for non-tutorial thumbnails", () => {
    const parsed = ThumbnailPayloadSchema.parse({
      subjectKind: "content_job",
      subjectId: base.subjectId,
      format: "EXPLAINER",
      title: "Set up Notion",
    });
    expect(parsed.language).toBe("en");
  });
});
