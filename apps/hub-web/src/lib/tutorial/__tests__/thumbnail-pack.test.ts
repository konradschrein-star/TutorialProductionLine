import { describe, expect, it } from "vitest";
import {
  THUMBNAIL_PACK_LANGUAGES,
  assessThumbnailPack,
  assessThumbnailPackJob,
  type ThumbnailPackJob,
} from "../thumbnail-pack";

function complete(language: string): ThumbnailPackJob {
  return {
    jobId: `job-${language}`,
    language,
    title: `Title ${language}`,
    description: `Description ${language}`,
    tags: [`tag ${language}`],
    thumbnailTextTop: "DO THIS",
    thumbnailTextBottom: "IN MINUTES",
    status: "COMPLETED",
    finalPath: `/media/${language}.mp4`,
    thumbnailId: null,
  };
}

describe("thumbnail publication pack", () => {
  it("uses exactly English plus the four automatic translations", () => {
    expect(THUMBNAIL_PACK_LANGUAGES).toEqual(["en", "de", "fr", "it", "sv"]);
    expect(new Set(THUMBNAIL_PACK_LANGUAGES).size).toBe(5);
  });

  it("requires localized metadata, copy and a completed video", () => {
    const result = assessThumbnailPackJob({
      ...complete("de"),
      description: null,
      thumbnailTextBottom: " ",
    });
    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual([
      "localized description missing",
      "thumbnail bottom line missing",
    ]);
  });

  it("does not accept fewer than five variants", () => {
    const result = assessThumbnailPack(
      THUMBNAIL_PACK_LANGUAGES.slice(0, 4).map(complete),
    );
    expect(result.ready).toBe(false);
    expect(result.expected).toBe(5);
    expect(result.readyCount).toBe(4);
    expect(result.variants[4]?.reasons).toContain(
      "language variant job missing",
    );
  });

  it("rejects duplicate jobs for one language instead of picking one", () => {
    const jobs = THUMBNAIL_PACK_LANGUAGES.map(complete);
    const result = assessThumbnailPack([
      ...jobs,
      { ...complete(jobs[0]!.language), jobId: "duplicate" },
    ]);
    expect(result.ready).toBe(false);
    expect(result.variants[0]?.reasons).toEqual([
      "multiple translation jobs found (2)",
    ]);
  });

  it("accepts a complete five-language set", () => {
    const result = assessThumbnailPack(THUMBNAIL_PACK_LANGUAGES.map(complete));
    expect(result.ready).toBe(true);
    expect(result.readyCount).toBe(5);
  });
});
