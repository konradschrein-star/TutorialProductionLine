import { describe, expect, it } from "vitest";
import { assessTutorialThumbnailSelection } from "../thumbnail-selection";

const owner = { language: "de", channelId: "channel-de" };
const thumbnail = {
  id: "thumb-de",
  language: "de",
  channelId: "channel-de",
  status: "completed",
  isSelected: true,
  outputPath: "/media/de.jpg",
};

describe("tutorial thumbnail selection", () => {
  it("ignores another language's selected asset", () => {
    const result = assessTutorialThumbnailSelection(owner, [
      { ...thumbnail, id: "thumb-en", language: "en" },
      thumbnail,
    ]);
    expect(result).toMatchObject({
      ready: true,
      thumbnail: { id: "thumb-de" },
    });
  });

  it("fails closed for missing or ambiguous selected assets", () => {
    expect(assessTutorialThumbnailSelection(owner, []).reasons[0]).toContain(
      "found 0",
    );
    expect(
      assessTutorialThumbnailSelection(owner, [
        thumbnail,
        { ...thumbnail, id: "duplicate" },
      ]).reasons[0],
    ).toContain("found 2");
  });

  it("rejects a selected asset from another channel", () => {
    expect(
      assessTutorialThumbnailSelection(owner, [
        { ...thumbnail, channelId: "channel-en" },
      ]),
    ).toMatchObject({
      ready: false,
      reasons: ["selected thumbnail belongs to a different channel"],
    });
  });

  it("does not default missing ownership state to English", () => {
    expect(
      assessTutorialThumbnailSelection({ language: null, channelId: null }, [
        thumbnail,
      ]).reasons,
    ).toEqual(["tutorial language is missing", "tutorial channel is missing"]);
  });
});
