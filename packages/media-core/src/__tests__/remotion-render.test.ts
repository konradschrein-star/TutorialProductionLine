/**
 * Remotion Render Tests
 *
 * Tests for Remotion composition rendering with warm browser singleton
 * and concurrency management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @remotion/renderer
const mockOpenBrowser = vi.fn();
const mockSelectComposition = vi.fn();
const mockRenderMedia = vi.fn();
const mockBrowserClose = vi.fn();

vi.mock("@remotion/renderer", () => ({
  openBrowser: (...args: any[]) => mockOpenBrowser(...args),
  selectComposition: (...args: any[]) => mockSelectComposition(...args),
  renderMedia: (...args: any[]) => mockRenderMedia(...args),
}));

// Mock node:os
vi.mock("node:os", () => ({
  default: {
    cpus: () => new Array(16).fill({}), // 16-core machine
  },
}));

import {
  warmRemotionBrowser,
  shutdownRemotionBrowser,
  renderComposition,
  type RenderCompositionParams,
} from "../remotion/render.js";

describe("warmRemotionBrowser", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockOpenBrowser.mockResolvedValue({
      close: mockBrowserClose.mockResolvedValue(undefined),
    });
    // Reset the warm browser singleton so each test starts from a clean state
    await shutdownRemotionBrowser();
  });

  it("opens a Chromium instance", async () => {
    await warmRemotionBrowser();

    expect(mockOpenBrowser).toHaveBeenCalledWith(
      "chrome",
      expect.objectContaining({
        chromiumOptions: { disableWebSecurity: true },
      }),
    );
  });

  it("is idempotent (does not open multiple browsers)", async () => {
    await warmRemotionBrowser();
    await warmRemotionBrowser();
    await warmRemotionBrowser();

    expect(mockOpenBrowser).toHaveBeenCalledOnce();
  });
});

describe("shutdownRemotionBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpenBrowser.mockResolvedValue({
      close: mockBrowserClose.mockResolvedValue(undefined),
    });
  });

  it("closes the warm browser", async () => {
    await warmRemotionBrowser();
    await shutdownRemotionBrowser();

    expect(mockBrowserClose).toHaveBeenCalledWith({ silent: false });
  });

  it("is safe to call when no browser is open", async () => {
    await shutdownRemotionBrowser();

    expect(mockBrowserClose).not.toHaveBeenCalled();
  });

  it("handles browser close errors gracefully", async () => {
    mockBrowserClose.mockRejectedValue(new Error("Browser already closed"));

    await warmRemotionBrowser();
    await shutdownRemotionBrowser();

    // Should not throw
    expect(mockBrowserClose).toHaveBeenCalled();
  });
});

describe("renderComposition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.REMOTION_CONCURRENCY;

    mockOpenBrowser.mockResolvedValue({
      close: mockBrowserClose.mockResolvedValue(undefined),
    });

    mockSelectComposition.mockResolvedValue({
      id: "TestComp",
      width: 1920,
      height: 1080,
      fps: 30,
      durationInFrames: 300,
    });

    mockRenderMedia.mockImplementation(async (options: any) => {
      // Simulate progress callbacks
      options.onProgress({ progress: 0.5 });
      options.onProgress({ progress: 1.0 });
    });
  });

  describe("successful render", () => {
    it("renders a composition", async () => {
      const params: RenderCompositionParams = {
        compositionId: "MainComp",
        inputProps: { text: "Hello World" },
        outputPath: "/tmp/output.mp4",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 300,
        serveUrl: "http://localhost:3000",
      };

      await renderComposition(params);

      expect(mockSelectComposition).toHaveBeenCalledWith({
        serveUrl: "http://localhost:3000",
        id: "MainComp",
        inputProps: { text: "Hello World" },
      });

      expect(mockRenderMedia).toHaveBeenCalled();
    });

    it("passes inputProps to both selectComposition and renderMedia", async () => {
      const params: RenderCompositionParams = {
        compositionId: "TestComp",
        inputProps: { title: "Test", count: 42 },
        outputPath: "/tmp/out.mp4",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 100,
        serveUrl: "http://localhost:3000",
      };

      await renderComposition(params);

      expect(mockSelectComposition).toHaveBeenCalledWith(
        expect.objectContaining({
          inputProps: { title: "Test", count: 42 },
        }),
      );

      expect(mockRenderMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          inputProps: { title: "Test", count: 42 },
        }),
      );
    });

    it("uses h264 codec", async () => {
      const params: RenderCompositionParams = {
        compositionId: "TestComp",
        inputProps: {},
        outputPath: "/tmp/out.mp4",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 100,
        serveUrl: "http://localhost:3000",
      };

      await renderComposition(params);

      expect(mockRenderMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          codec: "h264",
        }),
      );
    });

    it("sets default timeout to 2 minutes", async () => {
      const params: RenderCompositionParams = {
        compositionId: "TestComp",
        inputProps: {},
        outputPath: "/tmp/out.mp4",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 100,
        serveUrl: "http://localhost:3000",
      };

      await renderComposition(params);

      expect(mockRenderMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          timeoutInMilliseconds: 120_000,
        }),
      );
    });

    it("accepts custom timeout", async () => {
      const params: RenderCompositionParams = {
        compositionId: "TestComp",
        inputProps: {},
        outputPath: "/tmp/out.mp4",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 100,
        serveUrl: "http://localhost:3000",
        timeoutInMilliseconds: 300_000,
      };

      await renderComposition(params);

      expect(mockRenderMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          timeoutInMilliseconds: 300_000,
        }),
      );
    });

    it("passes publicDir when provided", async () => {
      const params: RenderCompositionParams = {
        compositionId: "TestComp",
        inputProps: {},
        outputPath: "/tmp/out.mp4",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 100,
        serveUrl: "http://localhost:3000",
        publicDir: "/tmp/render-123/assets",
      };

      await renderComposition(params);

      expect(mockRenderMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          publicDir: "/tmp/render-123/assets",
        }),
      );
    });

    it("omits publicDir when not provided", async () => {
      const params: RenderCompositionParams = {
        compositionId: "TestComp",
        inputProps: {},
        outputPath: "/tmp/out.mp4",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 100,
        serveUrl: "http://localhost:3000",
      };

      await renderComposition(params);

      const renderCall = mockRenderMedia.mock.calls[0][0];
      expect(renderCall.publicDir).toBeUndefined();
    });
  });

  describe("concurrency management", () => {
    it("defaults to half of CPU count", async () => {
      // 16-core machine → 8 concurrency
      const params: RenderCompositionParams = {
        compositionId: "TestComp",
        inputProps: {},
        outputPath: "/tmp/out.mp4",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 100,
        serveUrl: "http://localhost:3000",
      };

      await renderComposition(params);

      expect(mockRenderMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          concurrency: 8,
        }),
      );
    });

    it("respects REMOTION_CONCURRENCY environment variable", async () => {
      process.env.REMOTION_CONCURRENCY = "4";

      const params: RenderCompositionParams = {
        compositionId: "TestComp",
        inputProps: {},
        outputPath: "/tmp/out.mp4",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 100,
        serveUrl: "http://localhost:3000",
      };

      await renderComposition(params);

      expect(mockRenderMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          concurrency: 4,
        }),
      );

      delete process.env.REMOTION_CONCURRENCY;
    });

    it("accepts explicit concurrency parameter", async () => {
      const params: RenderCompositionParams = {
        compositionId: "TestComp",
        inputProps: {},
        outputPath: "/tmp/out.mp4",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 100,
        serveUrl: "http://localhost:3000",
        concurrency: 12,
      };

      await renderComposition(params);

      expect(mockRenderMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          concurrency: 12,
        }),
      );
    });

    it("scales concurrency for light compositions", async () => {
      // Base concurrency: 8 (16 cpus / 2)
      // Light hint: 8 * 1.5 = 12
      const params: RenderCompositionParams = {
        compositionId: "ImageOnlyComp",
        inputProps: {},
        outputPath: "/tmp/out.mp4",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 100,
        serveUrl: "http://localhost:3000",
        complexityHint: "light",
      };

      await renderComposition(params);

      expect(mockRenderMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          concurrency: 12,
        }),
      );
    });

    it("does not scale concurrency for standard compositions", async () => {
      const params: RenderCompositionParams = {
        compositionId: "AvatarComp",
        inputProps: {},
        outputPath: "/tmp/out.mp4",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 100,
        serveUrl: "http://localhost:3000",
        complexityHint: "standard",
      };

      await renderComposition(params);

      expect(mockRenderMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          concurrency: 8,
        }),
      );
    });

    it("never uses concurrency less than 1", async () => {
      process.env.REMOTION_CONCURRENCY = "0";

      const params: RenderCompositionParams = {
        compositionId: "TestComp",
        inputProps: {},
        outputPath: "/tmp/out.mp4",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 100,
        serveUrl: "http://localhost:3000",
      };

      await renderComposition(params);

      expect(mockRenderMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          concurrency: 1,
        }),
      );

      delete process.env.REMOTION_CONCURRENCY;
    });
  });

  describe("warm browser usage", () => {
    it("uses warm browser when available", async () => {
      await warmRemotionBrowser();

      const params: RenderCompositionParams = {
        compositionId: "TestComp",
        inputProps: {},
        outputPath: "/tmp/out.mp4",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 100,
        serveUrl: "http://localhost:3000",
      };

      await renderComposition(params);

      expect(mockRenderMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          puppeteerInstance: expect.any(Object),
        }),
      );
    });

    it("works without warm browser", async () => {
      await shutdownRemotionBrowser();

      const params: RenderCompositionParams = {
        compositionId: "TestComp",
        inputProps: {},
        outputPath: "/tmp/out.mp4",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 100,
        serveUrl: "http://localhost:3000",
      };

      await renderComposition(params);

      expect(mockRenderMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          puppeteerInstance: undefined,
        }),
      );
    });
  });

  describe("error handling", () => {
    it("rejects when selectComposition fails", async () => {
      mockSelectComposition.mockRejectedValue(
        new Error("Composition not found"),
      );

      const params: RenderCompositionParams = {
        compositionId: "MissingComp",
        inputProps: {},
        outputPath: "/tmp/out.mp4",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 100,
        serveUrl: "http://localhost:3000",
      };

      await expect(renderComposition(params)).rejects.toThrow(
        "Composition not found",
      );
    });

    it("rejects when renderMedia fails", async () => {
      mockRenderMedia.mockRejectedValue(new Error("Render failed: timeout"));

      const params: RenderCompositionParams = {
        compositionId: "TestComp",
        inputProps: {},
        outputPath: "/tmp/out.mp4",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 100,
        serveUrl: "http://localhost:3000",
      };

      await expect(renderComposition(params)).rejects.toThrow(
        "Remotion render failed",
      );
    });

    it("resets warm browser on render failure", async () => {
      await warmRemotionBrowser();

      mockRenderMedia.mockRejectedValue(new Error("Render crashed"));
      mockBrowserClose.mockResolvedValue(undefined);

      const params: RenderCompositionParams = {
        compositionId: "TestComp",
        inputProps: {},
        outputPath: "/tmp/out.mp4",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 100,
        serveUrl: "http://localhost:3000",
      };

      await expect(renderComposition(params)).rejects.toThrow();

      // Warm browser should be closed after failure
      expect(mockBrowserClose).toHaveBeenCalledWith({ silent: true });
    });

    it("continues after warm browser reset failure", async () => {
      await warmRemotionBrowser();

      mockRenderMedia.mockRejectedValue(new Error("Render failed"));
      mockBrowserClose.mockRejectedValue(new Error("Close failed"));

      const params: RenderCompositionParams = {
        compositionId: "TestComp",
        inputProps: {},
        outputPath: "/tmp/out.mp4",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 100,
        serveUrl: "http://localhost:3000",
      };

      // Should still reject with the render error, not the close error
      await expect(renderComposition(params)).rejects.toThrow(
        "Remotion render failed",
      );
    });
  });

  describe("progress logging", () => {
    it("logs progress updates", async () => {
      let progressCalls = 0;

      mockRenderMedia.mockImplementation(async (options: any) => {
        options.onProgress({ progress: 0.25 });
        progressCalls++;
        options.onProgress({ progress: 0.5 });
        progressCalls++;
        options.onProgress({ progress: 0.75 });
        progressCalls++;
        options.onProgress({ progress: 1.0 });
        progressCalls++;
      });

      const params: RenderCompositionParams = {
        compositionId: "TestComp",
        inputProps: {},
        outputPath: "/tmp/out.mp4",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 100,
        serveUrl: "http://localhost:3000",
      };

      await renderComposition(params);

      expect(progressCalls).toBe(4);
    });
  });

  describe("various resolutions", () => {
    it("handles 1080p", async () => {
      const params: RenderCompositionParams = {
        compositionId: "TestComp",
        inputProps: {},
        outputPath: "/tmp/out.mp4",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 100,
        serveUrl: "http://localhost:3000",
      };

      await renderComposition(params);

      expect(mockRenderMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          composition: expect.objectContaining({
            width: 1920,
            height: 1080,
          }),
        }),
      );
    });

    it("handles 4K", async () => {
      const params: RenderCompositionParams = {
        compositionId: "TestComp",
        inputProps: {},
        outputPath: "/tmp/out.mp4",
        width: 3840,
        height: 2160,
        fps: 60,
        durationInFrames: 600,
        serveUrl: "http://localhost:3000",
      };

      await renderComposition(params);

      expect(mockRenderMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          composition: expect.objectContaining({
            width: 3840,
            height: 2160,
            fps: 60,
          }),
        }),
      );
    });

    it("handles vertical video", async () => {
      const params: RenderCompositionParams = {
        compositionId: "ShortsComp",
        inputProps: {},
        outputPath: "/tmp/out.mp4",
        width: 1080,
        height: 1920,
        fps: 30,
        durationInFrames: 300,
        serveUrl: "http://localhost:3000",
      };

      await renderComposition(params);

      expect(mockRenderMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          composition: expect.objectContaining({
            width: 1080,
            height: 1920,
          }),
        }),
      );
    });
  });
});
