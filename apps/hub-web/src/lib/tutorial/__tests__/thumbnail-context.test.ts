import { describe, expect, it } from "vitest";
import { resolveTutorialThumbnailVariant } from "../thumbnail-context";

const base = {
  id: "job-de",
  sourceJobId: "job-en",
  language: "de",
  channelId: "channel-de",
  channelLanguage: "German",
  thumbnailTextTop: "JETZT STARTEN",
  thumbnailTextBottom: "SCHRITT FÜR SCHRITT",
};

describe("resolveTutorialThumbnailVariant", () => {
  it("keeps the variant's normalized language, channel and exact two lines", () => {
    expect(resolveTutorialThumbnailVariant(base)).toEqual({
      language: "de",
      channelId: "channel-de",
      thumbnailTextTop: "JETZT STARTEN",
      thumbnailTextBottom: "SCHRITT FÜR SCHRITT",
    });
  });

  it.each([
    [{ ...base, language: null }, "tutorial language is missing"],
    [{ ...base, channelId: null }, "tutorial channel is missing"],
    [
      { ...base, channelLanguage: "fr" },
      "tutorial language does not match its channel language",
    ],
    [
      { ...base, thumbnailTextBottom: null },
      "localized two-line thumbnail copy is incomplete",
    ],
  ])("fails closed for inconsistent state", (input, message) => {
    expect(() => resolveTutorialThumbnailVariant(input)).toThrow(message);
  });
});
