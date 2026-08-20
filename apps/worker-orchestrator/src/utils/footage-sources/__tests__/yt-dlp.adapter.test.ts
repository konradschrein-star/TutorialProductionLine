import { describe, it, expect, vi, beforeEach } from "vitest";
import { ytDlpSource } from "../yt-dlp.js";

vi.mock("../../yt-dlp-client.js", () => ({
  searchAndDownloadClip: vi.fn(),
}));
vi.mock("../../footage-quality-gate.js", () => ({
  evaluateClip: vi.fn(),
}));

import { searchAndDownloadClip } from "../../yt-dlp-client.js";
import { evaluateClip } from "../../footage-quality-gate.js";

describe("ytDlpSource", () => {
  beforeEach(() => {
    vi.mocked(searchAndDownloadClip).mockReset();
    vi.mocked(evaluateClip).mockReset();
  });

  it("returns FootageResult when search succeeds and quality passes", async () => {
    vi.mocked(searchAndDownloadClip).mockResolvedValueOnce({
      local_path: "/tmp/footage/abc.mp4",
      url: "https://youtube.com/watch?v=abc",
      title: "Apple Pixel 8 Pro review",
      channel: "Apple",
      channel_id: "uccwqcfgjznc1r2f5wwuvow",
      duration_seconds: 10,
    });
    vi.mocked(evaluateClip).mockResolvedValueOnce({
      accepted: true,
      reasons: [],
      metrics: { width: 1920, height: 1080, durationSeconds: 10, fps: 30 },
    });

    const result = await ytDlpSource.fetch({
      query: "Pixel 8 Pro review",
      format: "TECH_COMPARISON",
      durationSeconds: 10,
    });

    expect(result).not.toBeNull();
    expect(result!.source).toBe("yt-dlp");
    expect(result!.width).toBe(1920);
    expect(result!.attribution).toContain("Apple");
  });

  it("returns null when search yields no official-channel results", async () => {
    vi.mocked(searchAndDownloadClip).mockResolvedValueOnce(null);
    const result = await ytDlpSource.fetch({
      query: "obscure brand X review",
      format: "TECH_COMPARISON",
      durationSeconds: 10,
    });
    expect(result).toBeNull();
  });

  it("returns null when downloaded clip fails the quality gate", async () => {
    vi.mocked(searchAndDownloadClip).mockResolvedValueOnce({
      local_path: "/tmp/footage/bad.mp4",
      url: "https://youtube.com/watch?v=bad",
      title: "Low-res clip",
      channel: "Apple",
      channel_id: "uccwqcfgjznc1r2f5wwuvow",
      duration_seconds: 10,
    });
    vi.mocked(evaluateClip).mockResolvedValueOnce({
      accepted: false,
      reasons: ["resolution 854x480 below minimum"],
      metrics: { width: 854, height: 480, durationSeconds: 10, fps: 30 },
    });
    const result = await ytDlpSource.fetch({
      query: "x",
      format: "TECH_COMPARISON",
      durationSeconds: 10,
    });
    expect(result).toBeNull();
  });
});
