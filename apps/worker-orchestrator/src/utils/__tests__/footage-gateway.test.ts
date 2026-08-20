import { describe, it, expect, vi, beforeEach } from "vitest";
import { requestFootage } from "../footage-gateway.js";

vi.mock("../footage-sources/yt-dlp.js", () => ({
  ytDlpSource: { name: "yt-dlp", fetch: vi.fn() },
}));
vi.mock("../footage-sources/pexels.js", () => ({
  pexelsSource: { name: "pexels", fetch: vi.fn() },
}));
vi.mock("../footage-sources/clip-library.js", () => ({
  clipLibrarySource: { name: "clip-library", fetch: vi.fn() },
}));

import { ytDlpSource } from "../footage-sources/yt-dlp.js";
import { pexelsSource } from "../footage-sources/pexels.js";
import { clipLibrarySource } from "../footage-sources/clip-library.js";

describe("requestFootage", () => {
  beforeEach(() => {
    vi.mocked(ytDlpSource.fetch).mockReset();
    vi.mocked(pexelsSource.fetch).mockReset();
    vi.mocked(clipLibrarySource.fetch).mockReset();
  });

  it("returns the first source that produces a result", async () => {
    vi.mocked(ytDlpSource.fetch).mockResolvedValueOnce({
      ref: "footage/abc.mp4",
      localPath: "/data/footage/abc.mp4",
      source: "yt-dlp",
      durationSeconds: 10,
      width: 1920,
      height: 1080,
      attribution: "Apple",
      providerMeta: {},
    });
    const result = await requestFootage({
      query: "Pixel 8",
      format: "TECH_COMPARISON",
      durationSeconds: 10,
    });
    expect(result!.source).toBe("yt-dlp");
    expect(pexelsSource.fetch).not.toHaveBeenCalled();
  });

  it("falls through when first source returns null", async () => {
    vi.mocked(ytDlpSource.fetch).mockResolvedValueOnce(null);
    vi.mocked(pexelsSource.fetch).mockResolvedValueOnce({
      ref: "footage/def.mp4",
      localPath: "/data/footage/def.mp4",
      source: "pexels",
      durationSeconds: 8,
      width: 1920,
      height: 1080,
      attribution: "Pexels",
      providerMeta: {},
    });
    const result = await requestFootage({
      query: "obscure",
      format: "TECH_COMPARISON",
      durationSeconds: 10,
    });
    expect(result!.source).toBe("pexels");
  });

  it("returns null when every source fails", async () => {
    vi.mocked(ytDlpSource.fetch).mockResolvedValueOnce(null);
    vi.mocked(pexelsSource.fetch).mockResolvedValueOnce(null);
    vi.mocked(clipLibrarySource.fetch).mockResolvedValueOnce(null);
    const result = await requestFootage({
      query: "nope",
      format: "TECH_COMPARISON",
      durationSeconds: 10,
    });
    expect(result).toBeNull();
  });

  it("respects per-call sources override", async () => {
    vi.mocked(clipLibrarySource.fetch).mockResolvedValueOnce({
      ref: "footage/lib.mp4",
      localPath: "/data/footage/lib.mp4",
      source: "clip-library",
      durationSeconds: 7,
      width: 1920,
      height: 1080,
      attribution: null,
      providerMeta: {},
    });
    const result = await requestFootage({
      query: "anything",
      format: "TECH_COMPARISON",
      durationSeconds: 7,
      sources: ["clip-library"],
    });
    expect(result!.source).toBe("clip-library");
    expect(ytDlpSource.fetch).not.toHaveBeenCalled();
    expect(pexelsSource.fetch).not.toHaveBeenCalled();
  });

  it("continues cascade when a source throws", async () => {
    vi.mocked(ytDlpSource.fetch).mockRejectedValueOnce(
      new Error("yt-dlp down"),
    );
    vi.mocked(pexelsSource.fetch).mockResolvedValueOnce({
      ref: "footage/x.mp4",
      localPath: "/data/footage/x.mp4",
      source: "pexels",
      durationSeconds: 5,
      width: 1920,
      height: 1080,
      attribution: "Pexels",
      providerMeta: {},
    });
    const result = await requestFootage({
      query: "fallback",
      format: "TECH_COMPARISON",
      durationSeconds: 5,
    });
    expect(result!.source).toBe("pexels");
  });
});
