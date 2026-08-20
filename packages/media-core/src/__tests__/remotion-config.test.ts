/**
 * Remotion Config Tests
 *
 * Tests for Remotion configuration parsing and defaults.
 */

import { describe, it, expect } from "vitest";
import { parseRenderConfig, type RenderSettings, type RemotionRenderConfig } from "../remotion/config.js";

describe("parseRenderConfig", () => {
  describe("complete valid config", () => {
    it("parses complete Remotion config", () => {
      const input = {
        engine: "REMOTION" as const,
        captions_enabled: true,
        settings: {
          fps: 30,
          width: 1920,
          height: 1080,
          composition_id: "MainComposition",
          captions_enabled: true,
        },
      };

      const result = parseRenderConfig(input);

      expect(result).toEqual(input);
    });

    it("parses FFMPEG engine config", () => {
      const input = {
        engine: "FFMPEG" as const,
        captions_enabled: false,
        settings: {
          fps: 60,
          width: 3840,
          height: 2160,
          composition_id: "4KComposition",
          captions_enabled: false,
        },
      };

      const result = parseRenderConfig(input);

      expect(result.engine).toBe("FFMPEG");
      expect(result.captions_enabled).toBe(false);
      expect(result.settings.fps).toBe(60);
      expect(result.settings.width).toBe(3840);
      expect(result.settings.height).toBe(2160);
    });
  });

  describe("default values", () => {
    it("defaults to REMOTION engine when missing", () => {
      const input = {
        captions_enabled: true,
        settings: {
          fps: 30,
          width: 1920,
          height: 1080,
          composition_id: "Test",
        },
      };

      const result = parseRenderConfig(input);

      expect(result.engine).toBe("REMOTION");
    });

    it("defaults captions_enabled to true when missing", () => {
      const input = {
        engine: "REMOTION",
        settings: {
          fps: 30,
          width: 1920,
          height: 1080,
          composition_id: "Test",
        },
      };

      const result = parseRenderConfig(input);

      expect(result.captions_enabled).toBe(true);
    });

    it("defaults fps to 30 when missing", () => {
      const input = {
        engine: "REMOTION",
        captions_enabled: true,
        settings: {
          width: 1920,
          height: 1080,
          composition_id: "Test",
        },
      };

      const result = parseRenderConfig(input);

      expect(result.settings.fps).toBe(30);
    });

    it("defaults width to 1920 when missing", () => {
      const input = {
        engine: "REMOTION",
        captions_enabled: true,
        settings: {
          fps: 30,
          height: 1080,
          composition_id: "Test",
        },
      };

      const result = parseRenderConfig(input);

      expect(result.settings.width).toBe(1920);
    });

    it("defaults height to 1080 when missing", () => {
      const input = {
        engine: "REMOTION",
        captions_enabled: true,
        settings: {
          fps: 30,
          width: 1920,
          composition_id: "Test",
        },
      };

      const result = parseRenderConfig(input);

      expect(result.settings.height).toBe(1080);
    });

    it("defaults composition_id to DefaultComposition when missing", () => {
      const input = {
        engine: "REMOTION",
        captions_enabled: true,
        settings: {
          fps: 30,
          width: 1920,
          height: 1080,
        },
      };

      const result = parseRenderConfig(input);

      expect(result.settings.composition_id).toBe("DefaultComposition");
    });

    it("defaults settings.captions_enabled to true when missing", () => {
      const input = {
        engine: "REMOTION",
        captions_enabled: false,
        settings: {
          fps: 30,
          width: 1920,
          height: 1080,
          composition_id: "Test",
        },
      };

      const result = parseRenderConfig(input);

      expect(result.settings.captions_enabled).toBe(true);
    });
  });

  describe("empty or minimal input", () => {
    it("handles empty object with all defaults", () => {
      const result = parseRenderConfig({});

      expect(result).toEqual({
        engine: "REMOTION",
        captions_enabled: true,
        settings: {
          fps: 30,
          width: 1920,
          height: 1080,
          composition_id: "DefaultComposition",
          captions_enabled: true,
        },
      });
    });

    it("handles null input gracefully", () => {
      const result = parseRenderConfig(null);

      expect(result.engine).toBe("REMOTION");
      expect(result.captions_enabled).toBe(true);
    });

    it("handles undefined input gracefully", () => {
      const result = parseRenderConfig(undefined);

      expect(result.engine).toBe("REMOTION");
      expect(result.settings.fps).toBe(30);
    });
  });

  describe("various resolutions", () => {
    it("parses 4K resolution (3840x2160)", () => {
      const input = {
        settings: {
          width: 3840,
          height: 2160,
          fps: 60,
          composition_id: "4K",
        },
      };

      const result = parseRenderConfig(input);

      expect(result.settings.width).toBe(3840);
      expect(result.settings.height).toBe(2160);
    });

    it("parses 720p resolution (1280x720)", () => {
      const input = {
        settings: {
          width: 1280,
          height: 720,
          fps: 30,
          composition_id: "HD",
        },
      };

      const result = parseRenderConfig(input);

      expect(result.settings.width).toBe(1280);
      expect(result.settings.height).toBe(720);
    });

    it("parses vertical video (1080x1920)", () => {
      const input = {
        settings: {
          width: 1080,
          height: 1920,
          fps: 30,
          composition_id: "Shorts",
        },
      };

      const result = parseRenderConfig(input);

      expect(result.settings.width).toBe(1080);
      expect(result.settings.height).toBe(1920);
    });
  });

  describe("various frame rates", () => {
    it("parses 24fps (cinematic)", () => {
      const input = {
        settings: { fps: 24, width: 1920, height: 1080, composition_id: "Cinematic" },
      };

      const result = parseRenderConfig(input);

      expect(result.settings.fps).toBe(24);
    });

    it("parses 60fps (smooth)", () => {
      const input = {
        settings: { fps: 60, width: 1920, height: 1080, composition_id: "Smooth" },
      };

      const result = parseRenderConfig(input);

      expect(result.settings.fps).toBe(60);
    });

    it("parses 120fps (slow-motion)", () => {
      const input = {
        settings: { fps: 120, width: 1920, height: 1080, composition_id: "SlowMo" },
      };

      const result = parseRenderConfig(input);

      expect(result.settings.fps).toBe(120);
    });
  });

  describe("captions configuration", () => {
    it("respects top-level captions_enabled false", () => {
      const input = {
        captions_enabled: false,
        settings: { composition_id: "NoSubs" },
      };

      const result = parseRenderConfig(input);

      expect(result.captions_enabled).toBe(false);
    });

    it("respects settings-level captions_enabled false", () => {
      const input = {
        settings: {
          captions_enabled: false,
          composition_id: "Test",
        },
      };

      const result = parseRenderConfig(input);

      expect(result.settings.captions_enabled).toBe(false);
    });

    it("handles captions disabled at both levels", () => {
      const input = {
        captions_enabled: false,
        settings: {
          captions_enabled: false,
          composition_id: "NoCaptions",
        },
      };

      const result = parseRenderConfig(input);

      expect(result.captions_enabled).toBe(false);
      expect(result.settings.captions_enabled).toBe(false);
    });
  });

  describe("composition IDs", () => {
    it("preserves custom composition IDs", () => {
      const compositionIds = [
        "ExplainerTemplate",
        "DocumentaryLongForm",
        "PoliticalCommentary",
        "TechReview",
        "VideoEssay",
      ];

      compositionIds.forEach((composition_id) => {
        const result = parseRenderConfig({
          settings: { composition_id },
        });

        expect(result.settings.composition_id).toBe(composition_id);
      });
    });

    it("handles composition IDs with special characters", () => {
      const result = parseRenderConfig({
        settings: { composition_id: "Template-v2.5_Final" },
      });

      expect(result.settings.composition_id).toBe("Template-v2.5_Final");
    });
  });

  describe("type safety", () => {
    it("returns RenderSettings type", () => {
      const result = parseRenderConfig({});

      // TypeScript compile-time check
      const engine: "REMOTION" | "FFMPEG" = result.engine;
      const captions: boolean = result.captions_enabled;
      const fps: number = result.settings.fps;

      expect(engine).toBeDefined();
      expect(typeof captions).toBe("boolean");
      expect(typeof fps).toBe("number");
    });
  });
});
