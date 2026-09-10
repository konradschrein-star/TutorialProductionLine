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
  it("keeps the variant's normalized language, channel and exact headline blocks", () => {
    expect(resolveTutorialThumbnailVariant(base)).toEqual({
      language: "de",
      channelId: "channel-de",
      thumbnailTextTop: "JETZT STARTEN",
      thumbnailTextBottom: "SCHRITT FÜR SCHRITT",
    });
  });

  it("supports one independently positioned headline block", () => {
    expect(resolveTutorialThumbnailVariant({ ...base, thumbnailTextBottom: null })).toMatchObject({
      thumbnailTextTop: "JETZT STARTEN",
      thumbnailTextBottom: "",
    });
  });

  it.each([
    [{ ...base, language: null }, "tutorial language is missing"],
    [{ ...base, channelId: null }, "tutorial channel is missing"],
    [
      { ...base, channelLanguage: "fr" },
      "tutorial language does not match its channel language",
    ],
  ])("fails closed for inconsistent state", (input, message) => {
    expect(() => resolveTutorialThumbnailVariant(input)).toThrow(message);
  });
});
