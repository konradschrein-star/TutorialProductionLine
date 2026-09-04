import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertLocalDispatchAsset,
  DispatchGateError,
  DispatchRequestSchema,
  validateDispatchCandidate,
  type DispatchCandidate,
} from "../uploader-dispatch";

const request = DispatchRequestSchema.parse({
  visibility: "private",
  made_for_kids: false,
  monetization: "on",
  ad_suitability_confirmed: true,
});

const complete: DispatchCandidate = {
  status: "COMPLETED",
  isUploaded: false,
  sourceJobId: null,
  language: "English",
  channelLanguage: "en",
  title: "How to configure Notion",
  description: "A complete walkthrough.",
  tags: ["notion tutorial", "notion setup"],
  finalPath: "/media/final.mp4",
  uploaderChannelKey: "english_us",
};

describe("tutorial uploader dispatch gate", () => {
  it("requires suitability confirmation only for monetized requests", () => {
    expect(
      DispatchRequestSchema.safeParse({
        visibility: "private",
        made_for_kids: false,
        monetization: "off",
      }).success,
    ).toBe(true);
    expect(
      DispatchRequestSchema.safeParse({
        visibility: "private",
        made_for_kids: false,
        monetization: "on",
      }).success,
    ).toBe(false);
  });

  it("builds explicit private, not-for-kids, monetized attributes", () => {
    expect(validateDispatchCandidate(complete, request)).toEqual({
      title: complete.title,
      description: complete.description,
      tags: complete.tags,
      visibility: "private",
      made_for_kids: false,
      monetization: "on",
      ad_suitability: "none",
    });
  });

  it.each([
    ["status", { status: "RENDERING" }, "tutorial_not_completed"],
    ["uploaded", { isUploaded: true }, "tutorial_already_uploaded"],
    ["description", { description: "" }, "localized_metadata_incomplete"],
    ["tags", { tags: [] }, "localized_metadata_incomplete"],
    ["invalid tags", { tags: ["valid", 42] }, "localized_metadata_incomplete"],
    ["final", { finalPath: null }, "final_video_missing"],
    ["mapping", { uploaderChannelKey: null }, "uploader_channel_unmapped"],
  ])("fails closed for missing %s", (_name, patch, code) => {
    expect(() =>
      validateDispatchCandidate({ ...complete, ...patch }, request),
    ).toThrowError(expect.objectContaining({ code }));
  });

  it("permits only de/fr/es/ja/ko localized children", () => {
    for (const language of ["de", "fr", "es", "ja", "ko"]) {
      expect(() =>
        validateDispatchCandidate(
          {
            ...complete,
            sourceJobId: "11111111-1111-4111-8111-111111111111",
            language,
            channelLanguage: language,
          },
          request,
        ),
      ).not.toThrow();
    }
    expect(() =>
      validateDispatchCandidate(
        {
          ...complete,
          sourceJobId: "11111111-1111-4111-8111-111111111111",
          language: "it",
          channelLanguage: "it",
        },
        request,
      ),
    ).toThrowError(
      expect.objectContaining({ code: "unsupported_translation_language" }),
    );
  });

  it("does not treat a non-English original as an automatic translation", () => {
    expect(() =>
      validateDispatchCandidate(
        { ...complete, language: "de", channelLanguage: "de" },
        request,
      ),
    ).toThrowError(expect.objectContaining({ code: "source_not_english" }));
  });
});

describe("dispatch artifact checks", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true })),
    );
  });

  it("accepts nonempty local video and thumbnail files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tutorial-dispatch-"));
    dirs.push(dir);
    const video = join(dir, "final.mp4");
    const thumbnail = join(dir, "thumbnail.png");
    await writeFile(video, "video");
    await writeFile(thumbnail, "thumbnail");

    await expect(
      assertLocalDispatchAsset(video, "video"),
    ).resolves.toBeUndefined();
    await expect(
      assertLocalDispatchAsset(thumbnail, "thumbnail"),
    ).resolves.toBeUndefined();
  });

  it("rejects missing, empty, and unsupported assets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tutorial-dispatch-"));
    dirs.push(dir);
    const empty = join(dir, "empty.png");
    const wrong = join(dir, "thumbnail.gif");
    await writeFile(empty, "");
    await writeFile(wrong, "image");

    await expect(
      assertLocalDispatchAsset(empty, "thumbnail"),
    ).rejects.toBeInstanceOf(DispatchGateError);
    await expect(
      assertLocalDispatchAsset(wrong, "thumbnail"),
    ).rejects.toMatchObject({
      code: "thumbnail_type_invalid",
    });
    await expect(
      assertLocalDispatchAsset(join(dir, "missing.mp4"), "video"),
    ).rejects.toMatchObject({ code: "video_file_unavailable" });
  });
});
