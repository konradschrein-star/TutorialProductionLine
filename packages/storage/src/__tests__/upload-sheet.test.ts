import { describe, it, expect } from "vitest";
import { buildUploadSheet, ARTIFACT_FILENAMES } from "../folder-scheme.js";

/**
 * The upload sheet is the artefact that makes "open Drive and upload" true.
 * Its one hard rule is that a missing field is STATED, never filled — an
 * invented description gets published under the owner's channel, a visible
 * blank costs thirty seconds.
 */

const complete = {
  jobId: "11111111-2222-3333-4444-555555555555",
  title: "How to Set Up Two-Factor Authentication in Gmail",
  description:
    "Turn on 2FA in under five minutes.\n\n- Open settings\n- Add a phone",
  tags: ["gmail 2fa", "two factor authentication", "gmail security"],
  channelName: "Blink Blueprint",
  language: "en",
  videoFilename: ARTIFACT_FILENAMES.final_video,
  thumbnailFilename: ARTIFACT_FILENAMES.thumbnail,
  durationSeconds: 384,
};

describe("buildUploadSheet", () => {
  it("carries everything needed to publish without opening the app", () => {
    const sheet = buildUploadSheet(complete);
    expect(sheet).toContain("How to Set Up Two-Factor Authentication in Gmail");
    expect(sheet).toContain("Turn on 2FA in under five minutes.");
    expect(sheet).toContain(
      "gmail 2fa, two factor authentication, gmail security",
    );
    expect(sheet).toContain("Blink Blueprint");
    expect(sheet).toContain(ARTIFACT_FILENAMES.final_video);
    expect(sheet).toContain(ARTIFACT_FILENAMES.thumbnail);
    expect(sheet).not.toContain("INCOMPLETE");
  });

  it("preserves the properly-cased title, not a slug", () => {
    const sheet = buildUploadSheet(complete);
    expect(sheet).not.toContain(
      "how-to-set-up-two-factor-authentication-in-gmail",
    );
  });

  it("states a missing description instead of inventing one", () => {
    const sheet = buildUploadSheet({ ...complete, description: null });
    expect(sheet).toContain("NOT GENERATED");
    expect(sheet).toContain("INCOMPLETE");
    expect(sheet).toContain("Missing: description");
  });

  it("states missing tags instead of deriving them from the title", () => {
    const sheet = buildUploadSheet({ ...complete, tags: null });
    expect(sheet).toContain("Missing: tags");
    // The obvious wrong fix is splitting the title into tags.
    expect(sheet).not.toContain("how, to, set, up");
  });

  it("treats an empty tag array as missing", () => {
    expect(buildUploadSheet({ ...complete, tags: [] })).toContain(
      "Missing: tags",
    );
  });

  it("ignores whitespace-only tags", () => {
    expect(buildUploadSheet({ ...complete, tags: ["   ", ""] })).toContain(
      "Missing: tags",
    );
  });

  it("flags a missing thumbnail so the VA is not surprised in Drive", () => {
    const sheet = buildUploadSheet({ ...complete, thumbnailFilename: null });
    expect(sheet).toContain("Missing: thumbnail");
  });

  it("lists every missing field at once", () => {
    const sheet = buildUploadSheet({
      ...complete,
      title: null,
      description: null,
      tags: null,
      thumbnailFilename: null,
    });
    expect(sheet).toContain("Missing: title, description, tags, thumbnail");
  });

  it("says the channel is unassigned rather than guessing one", () => {
    const sheet = buildUploadSheet({ ...complete, channelName: null });
    expect(sheet).toContain("unassigned");
  });

  it("formats durations the way a person says them", () => {
    expect(buildUploadSheet({ ...complete, durationSeconds: 384 })).toContain(
      "6m 24s",
    );
    expect(buildUploadSheet({ ...complete, durationSeconds: 3852 })).toContain(
      "1h 04m 12s",
    );
    expect(buildUploadSheet({ ...complete, durationSeconds: 48 })).toContain(
      "48s",
    );
    expect(buildUploadSheet({ ...complete, durationSeconds: null })).toContain(
      "unknown",
    );
  });
});

describe("archive split keeps the leaf publishable", () => {
  it("puts the raw recording one level down, under the same leaf", async () => {
    const { planTutorialFolder, planTutorialArchiveFolder } =
      await import("../folder-scheme.js");
    const leaf = planTutorialFolder({
      jobId: "11111111-2222-3333-4444-555555555555",
      title: "Set Up 2FA",
      channelName: "Blink Blueprint",
      completedAt: new Date("2026-08-04T10:00:00Z"),
    });
    const archive = planTutorialArchiveFolder(leaf);

    // Same job folder — the translation pipeline consumes raw + transcript
    // together, so they must not end up in unrelated trees.
    expect(archive.segments.slice(0, -1)).toEqual(leaf.segments);
    expect(archive.segments.at(-1)).toBe("_raw");
    expect(archive.path.startsWith(leaf.path + "/")).toBe(true);
  });
});
