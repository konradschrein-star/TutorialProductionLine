import { describe, it, expect, vi, beforeEach } from "vitest";
import { pexelsSource } from "../pexels.js";

vi.mock("../../pexels-client.js", () => ({
  searchPexelsVideos: vi.fn(),
  searchPexelsPhotos: vi.fn(),
  downloadUrlToFile: vi.fn(),
}));
vi.mock("../../footage-quality-gate.js", () => ({
  evaluateClip: vi.fn(),
}));

import {
  searchPexelsVideos,
  searchPexelsPhotos,
  downloadUrlToFile,
} from "../../pexels-client.js";
import { evaluateClip } from "../../footage-quality-gate.js";

describe("pexelsSource", () => {
  beforeEach(() => {
    vi.mocked(searchPexelsVideos).mockReset();
    vi.mocked(searchPexelsPhotos).mockReset();
    vi.mocked(downloadUrlToFile).mockReset();
    vi.mocked(evaluateClip).mockReset();
    process.env["PEXELS_API_KEY"] = "test-api-key";
  });

  it("returns a video result when Pexels has a usable video", async () => {
    vi.mocked(searchPexelsVideos).mockResolvedValueOnce([
      {
        id: 42,
        duration: 12,
        download_url: "https://videos.pexels.com/abc.mp4",
        width: 1920,
        height: 1080,
        attribution: {
          provider: "pexels",
          photographer: "Jane Doe",
          source_url: "https://www.pexels.com/video/42",
        },
      },
    ] as any);
    vi.mocked(downloadUrlToFile).mockResolvedValueOnce(undefined);
    vi.mocked(evaluateClip).mockResolvedValueOnce({
      accepted: true,
      reasons: [],
      metrics: { width: 1920, height: 1080, durationSeconds: 12, fps: 30 },
    });

    const result = await pexelsSource.fetch({
      query: "skyscraper at night",
      format: "TECH_COMPARISON",
      durationSeconds: 10,
    });

    expect(result).not.toBeNull();
    expect(result!.source).toBe("pexels");
    expect(result!.durationSeconds).toBeGreaterThan(0);
    expect(result!.providerMeta.kind).toBe("video");
    expect(result!.attribution).toContain("Jane Doe");
  });

  it("falls through to photo when no video found", async () => {
    vi.mocked(searchPexelsVideos).mockResolvedValueOnce([]);
    vi.mocked(searchPexelsPhotos).mockResolvedValueOnce([
      {
        id: 99,
        download_url: "https://images.pexels.com/photo.jpg",
        width: 1920,
        height: 1280,
        alt: "still",
        attribution: {
          provider: "pexels",
          photographer: "Jane Doe",
          photographer_url: "https://pexels.com/jane",
          photographer_id: 1,
          source_url: "https://www.pexels.com/photo/99",
        },
        avg_color_hex: "#404040",
      },
    ] as any);
    vi.mocked(downloadUrlToFile).mockResolvedValueOnce(undefined);

    const result = await pexelsSource.fetch({
      query: "abstract texture",
      format: "TECH_COMPARISON",
      durationSeconds: 8,
    });

    expect(result).not.toBeNull();
    expect(result!.durationSeconds).toBe(0); // still image signal
    expect(result!.providerMeta.kind).toBe("photo");
    expect(evaluateClip).not.toHaveBeenCalled();
  });

  it("returns null when both video and photo search are empty", async () => {
    vi.mocked(searchPexelsVideos).mockResolvedValueOnce([]);
    vi.mocked(searchPexelsPhotos).mockResolvedValueOnce([]);
    const result = await pexelsSource.fetch({
      query: "no results",
      format: "TECH_COMPARISON",
      durationSeconds: 8,
    });
    expect(result).toBeNull();
  });

  it("falls through to photo when video fails quality gate", async () => {
    vi.mocked(searchPexelsVideos).mockResolvedValueOnce([
      {
        id: 1,
        duration: 10,
        download_url: "https://videos.pexels.com/lowres.mp4",
        width: 640,
        height: 360,
        attribution: {
          provider: "pexels",
          photographer: "X",
          source_url: "https://www.pexels.com/video/1",
        },
      },
    ] as any);
    vi.mocked(downloadUrlToFile).mockResolvedValueOnce(undefined);
    vi.mocked(evaluateClip).mockResolvedValueOnce({
      accepted: false,
      reasons: ["resolution 640x360 below minimum"],
      metrics: { width: 640, height: 360, durationSeconds: 10, fps: 30 },
    });
    vi.mocked(searchPexelsPhotos).mockResolvedValueOnce([
      {
        id: 2,
        download_url: "https://images.pexels.com/photo.jpg",
        width: 1920,
        height: 1280,
        alt: null,
        attribution: {
          provider: "pexels",
          photographer: "Y",
          photographer_url: "https://pexels.com/y",
          photographer_id: 2,
          source_url: "https://www.pexels.com/photo/2",
        },
        avg_color_hex: "#000000",
      },
    ] as any);
    vi.mocked(downloadUrlToFile).mockResolvedValueOnce(undefined);

    const result = await pexelsSource.fetch({
      query: "x",
      format: "TECH_COMPARISON",
      durationSeconds: 8,
    });
    expect(result!.providerMeta.kind).toBe("photo");
  });
});
