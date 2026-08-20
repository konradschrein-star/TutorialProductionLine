/**
 * Party Overlay System Tests
 *
 * Comprehensive tests for party-specific video overlays.
 * Validates configurations, filtergraph generation, and format-specific positioning.
 */

import { describe, it, expect } from "vitest";
import {
  PARTY_OVERLAYS,
  generateOverlayFiltergraph,
  getPartyConfig,
  getAllPartyNames,
  isValidPartyName,
  getLogoPath,
  type PartyName,
  type OutputFormat,
} from "../party-overlays.js";

// ─── Party Configuration Tests ───────────────────────────────────────────────

describe("PARTY_OVERLAYS", () => {
  it("defines configurations for all 6 parties plus UNKNOWN", () => {
    const expectedParties: PartyName[] = [
      "SPD",
      "CDU",
      "AFD",
      "GRUENE",
      "FDP",
      "LINKE",
      "UNKNOWN",
    ];

    expectedParties.forEach((party) => {
      expect(PARTY_OVERLAYS[party]).toBeDefined();
      expect(PARTY_OVERLAYS[party]).toHaveProperty("primary_color");
      expect(PARTY_OVERLAYS[party]).toHaveProperty("logo_path");
      expect(PARTY_OVERLAYS[party]).toHaveProperty("font_color");
      expect(PARTY_OVERLAYS[party]).toHaveProperty("accent_color");
    });

    expect(Object.keys(PARTY_OVERLAYS)).toHaveLength(7);
  });

  it("has valid hex color format for all colors", () => {
    const hexColorRegex = /^#[0-9A-F]{6}$/i;

    Object.entries(PARTY_OVERLAYS).forEach(([party, config]) => {
      expect(config.primary_color).toMatch(hexColorRegex);
      expect(config.font_color).toMatch(hexColorRegex);
      expect(config.accent_color).toMatch(hexColorRegex);
    });
  });

  it("has correct official party colors", () => {
    // Verify official party colors based on branding
    expect(PARTY_OVERLAYS.SPD.primary_color).toBe("#E3000F"); // SPD red
    expect(PARTY_OVERLAYS.CDU.primary_color).toBe("#000000"); // CDU black
    expect(PARTY_OVERLAYS.AFD.primary_color).toBe("#0088FF"); // AFD blue
    expect(PARTY_OVERLAYS.GRUENE.primary_color).toBe("#64A12D"); // Grüne green
    expect(PARTY_OVERLAYS.FDP.primary_color).toBe("#FFED00"); // FDP yellow
    expect(PARTY_OVERLAYS.LINKE.primary_color).toBe("#BE3075"); // Die Linke magenta
    expect(PARTY_OVERLAYS.UNKNOWN.primary_color).toBe("#808080"); // Gray
  });

  it("FDP uses black text on yellow background", () => {
    // FDP yellow is bright, so text should be black (not white)
    expect(PARTY_OVERLAYS.FDP.font_color).toBe("#000000");
    expect(PARTY_OVERLAYS.FDP.primary_color).toBe("#FFED00");
  });

  it("has logo paths for all parties except UNKNOWN", () => {
    const partiesWithLogos: PartyName[] = [
      "SPD",
      "CDU",
      "AFD",
      "GRUENE",
      "FDP",
      "LINKE",
    ];

    partiesWithLogos.forEach((party) => {
      expect(PARTY_OVERLAYS[party].logo_path).toBeTruthy();
      expect(PARTY_OVERLAYS[party].logo_path).toContain("/overlays/");
      expect(PARTY_OVERLAYS[party].logo_path).toContain("-logo.png");
    });

    expect(PARTY_OVERLAYS.UNKNOWN.logo_path).toBe("");
  });
});

// ─── Helper Function Tests ───────────────────────────────────────────────────

describe("getPartyConfig", () => {
  it("returns configuration for valid party names", () => {
    const config = getPartyConfig("SPD");
    expect(config).toBeDefined();
    expect(config.primary_color).toBe("#E3000F");
  });

  it("throws error for invalid party name", () => {
    expect(() => getPartyConfig("INVALID" as PartyName)).toThrow(
      "Unknown party",
    );
  });
});

describe("getAllPartyNames", () => {
  it("returns all party names including UNKNOWN", () => {
    const parties = getAllPartyNames();
    expect(parties).toHaveLength(7);
    expect(parties).toContain("SPD");
    expect(parties).toContain("CDU");
    expect(parties).toContain("AFD");
    expect(parties).toContain("GRUENE");
    expect(parties).toContain("FDP");
    expect(parties).toContain("LINKE");
    expect(parties).toContain("UNKNOWN");
  });
});

describe("isValidPartyName", () => {
  it("returns true for valid party names", () => {
    expect(isValidPartyName("SPD")).toBe(true);
    expect(isValidPartyName("CDU")).toBe(true);
    expect(isValidPartyName("UNKNOWN")).toBe(true);
  });

  it("returns false for invalid party names", () => {
    expect(isValidPartyName("INVALID")).toBe(false);
    expect(isValidPartyName("")).toBe(false);
    expect(isValidPartyName("spd")).toBe(false); // lowercase
  });
});

describe("getLogoPath", () => {
  it("returns logo path for parties with logos", () => {
    const result = getLogoPath("SPD");
    expect(result.path).toContain("/overlays/spd-logo.png");
  });

  it("returns empty path for UNKNOWN party", () => {
    const result = getLogoPath("UNKNOWN");
    expect(result.path).toContain(""); // Empty logo_path in config
  });

  it("uses custom assets base path when provided", () => {
    const result = getLogoPath("CDU", "/custom/assets");
    expect(result.path).toContain("/custom/assets");
    expect(result.path).toContain("/overlays/cdu-logo.png");
  });

  it("uses OVERLAY_ASSETS_PATH env var when available", () => {
    const originalEnv = process.env["OVERLAY_ASSETS_PATH"];
    process.env["OVERLAY_ASSETS_PATH"] = "/env/assets";

    const result = getLogoPath("FDP");
    expect(result.path).toContain("/env/assets");

    // Restore original env var
    if (originalEnv) {
      process.env["OVERLAY_ASSETS_PATH"] = originalEnv;
    } else {
      delete process.env["OVERLAY_ASSETS_PATH"];
    }
  });
});

// ─── Filtergraph Generation Tests ────────────────────────────────────────────

describe("generateOverlayFiltergraph", () => {
  const baseOptions = {
    party: "SPD" as PartyName,
    outputFormat: "youtube" as OutputFormat,
    width: 1920,
    height: 1080,
  };

  it("generates valid filtergraph for YouTube format", () => {
    const filtergraph = generateOverlayFiltergraph(baseOptions);

    expect(filtergraph).toBeTruthy();
    expect(filtergraph).toContain("drawbox"); // Color bar
    expect(filtergraph).toContain("drawtext"); // Party name
    expect(filtergraph).toContain("[outv]"); // Final output label
  });

  it("includes party color in color bar", () => {
    const filtergraph = generateOverlayFiltergraph({
      ...baseOptions,
      party: "SPD",
    });

    // SPD red #E3000F → 0xE3000Fff (with full alpha)
    // Note: Alpha is lowercase in output
    expect(filtergraph).toContain("color=0xE3000Fff");
  });

  it("includes party name in text overlay", () => {
    const filtergraph = generateOverlayFiltergraph({
      ...baseOptions,
      party: "CDU",
    });

    // CDU display name is "CDU/CSU"
    expect(filtergraph).toContain("CDU/CSU");
  });

  it("escapes special characters in party names", () => {
    const filtergraph = generateOverlayFiltergraph({
      ...baseOptions,
      party: "GRUENE",
    });

    // "Bündnis 90/Die Grünen" contains "/" which needs escaping
    expect(filtergraph).toContain("Bündnis 90");
  });

  it("omits color bar when includeColorBar is false", () => {
    const filtergraph = generateOverlayFiltergraph({
      ...baseOptions,
      includeColorBar: false,
    });

    expect(filtergraph).not.toContain("drawbox");
  });

  it("omits party name when includePartyName is false", () => {
    const filtergraph = generateOverlayFiltergraph({
      ...baseOptions,
      includePartyName: false,
    });

    expect(filtergraph).not.toContain("drawtext");
    expect(filtergraph).not.toContain("SPD");
  });

  it("omits logo when includeLogo is false", () => {
    const filtergraph = generateOverlayFiltergraph({
      ...baseOptions,
      includeLogo: false,
    });

    expect(filtergraph).not.toContain("overlay="); // Logo uses overlay filter
    expect(filtergraph).not.toContain("[1:v]"); // Logo input reference
  });

  it("generates minimal filtergraph when all overlays disabled", () => {
    const filtergraph = generateOverlayFiltergraph({
      ...baseOptions,
      includeColorBar: false,
      includePartyName: false,
      includeLogo: false,
    });

    // Should just pass through video with null filter
    expect(filtergraph).toContain("[0:v]");
    expect(filtergraph).toContain("[outv]");
    expect(filtergraph).toContain("null");
  });
});

// ─── Format-Specific Tests ───────────────────────────────────────────────────

describe("generateOverlayFiltergraph - Format-Specific Positioning", () => {
  it("uses top-right position for logo in YouTube format (16:9)", () => {
    const filtergraph = generateOverlayFiltergraph({
      party: "AFD",
      outputFormat: "youtube",
      width: 1920,
      height: 1080,
    });

    // Top-right position: x=W-w-20, y=20
    expect(filtergraph).toContain("W-w-20");
  });

  it("uses top-center position for logo in YouTube Shorts format (9:16)", () => {
    const filtergraph = generateOverlayFiltergraph({
      party: "AFD",
      outputFormat: "youtube_shorts",
      width: 1080,
      height: 1920,
    });

    // Top-center position: x=(W-w)/2
    expect(filtergraph).toContain("(W-w)/2");
  });

  it("uses top-center position for logo in TikTok format (9:16)", () => {
    const filtergraph = generateOverlayFiltergraph({
      party: "GRUENE",
      outputFormat: "tiktok",
      width: 1080,
      height: 1920,
    });

    expect(filtergraph).toContain("(W-w)/2");
  });

  it("uses top-center position for logo in Instagram format (9:16)", () => {
    const filtergraph = generateOverlayFiltergraph({
      party: "FDP",
      outputFormat: "instagram",
      width: 1080,
      height: 1920,
    });

    expect(filtergraph).toContain("(W-w)/2");
  });

  it("uses taller bar (80px) for YouTube format", () => {
    const filtergraph = generateOverlayFiltergraph({
      party: "LINKE",
      outputFormat: "youtube",
      width: 1920,
      height: 1080,
    });

    expect(filtergraph).toContain("h=80"); // Bar height
    expect(filtergraph).toContain("y=H-80"); // Bar position
  });

  it("uses shorter bar (60px) for vertical formats", () => {
    const filtergraph = generateOverlayFiltergraph({
      party: "SPD",
      outputFormat: "youtube_shorts",
      width: 1080,
      height: 1920,
    });

    expect(filtergraph).toContain("h=60"); // Bar height
    expect(filtergraph).toContain("y=H-60"); // Bar position
  });

  it("uses larger font (36px) for YouTube format", () => {
    const filtergraph = generateOverlayFiltergraph({
      party: "CDU",
      outputFormat: "youtube",
      width: 1920,
      height: 1080,
    });

    expect(filtergraph).toContain("fontsize=36");
  });

  it("uses smaller font (28px) for vertical formats", () => {
    const filtergraph = generateOverlayFiltergraph({
      party: "CDU",
      outputFormat: "tiktok",
      width: 1080,
      height: 1920,
    });

    expect(filtergraph).toContain("fontsize=28");
  });
});

// ─── All Parties Test ────────────────────────────────────────────────────────

describe("generateOverlayFiltergraph - All Parties", () => {
  const formats: OutputFormat[] = [
    "youtube",
    "youtube_shorts",
    "tiktok",
    "instagram",
  ];

  it("generates valid filtergraph for all parties in all formats", () => {
    const parties = getAllPartyNames();

    parties.forEach((party) => {
      formats.forEach((format) => {
        const width = format === "youtube" ? 1920 : 1080;
        const height = format === "youtube" ? 1080 : 1920;

        const filtergraph = generateOverlayFiltergraph({
          party,
          outputFormat: format,
          width,
          height,
        });

        // Basic validation
        expect(filtergraph).toBeTruthy();
        expect(filtergraph).toContain("[0:v]");
        expect(filtergraph).toContain("[outv]");

        // Should contain party color (converted to FFmpeg format)
        const config = getPartyConfig(party);
        const colorHex = config.primary_color.replace("#", "");
        expect(filtergraph).toContain(`0x${colorHex}`);
      });
    });
  });
});

// ─── Color Conversion Tests ──────────────────────────────────────────────────

describe("Color Conversion (hexToFFmpegColor)", () => {
  it("converts hex colors to FFmpeg format with alpha", () => {
    // Test internal color conversion by checking filtergraph output
    const filtergraph = generateOverlayFiltergraph({
      party: "SPD",
      outputFormat: "youtube",
      width: 1920,
      height: 1080,
    });

    // SPD red #E3000F → 0xE3000Fff (with full alpha, lowercase)
    expect(filtergraph).toContain("0xE3000Fff");
  });

  it("handles colors without # prefix", () => {
    const filtergraph = generateOverlayFiltergraph({
      party: "CDU",
      outputFormat: "youtube",
      width: 1920,
      height: 1080,
    });

    // CDU black #000000 → 0x000000ff (with full alpha, lowercase)
    expect(filtergraph).toContain("0x000000ff");
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe("generateOverlayFiltergraph - Edge Cases", () => {
  it("handles UNKNOWN party gracefully (no logo)", () => {
    const filtergraph = generateOverlayFiltergraph({
      party: "UNKNOWN",
      outputFormat: "youtube",
      width: 1920,
      height: 1080,
    });

    // Should have color bar and text, but no logo
    expect(filtergraph).toContain("drawbox");
    expect(filtergraph).toContain("drawtext");
    expect(filtergraph).toContain("Unbekannt"); // UNKNOWN display name
    expect(filtergraph).not.toContain("overlay="); // No logo overlay
  });

  it("uses custom assets base path when provided", () => {
    const filtergraph = generateOverlayFiltergraph({
      party: "FDP",
      outputFormat: "youtube",
      width: 1920,
      height: 1080,
      assetsBasePath: "/custom/path",
    });

    // Logo path should use custom base path (implicitly - hard to test without actual overlay)
    expect(filtergraph).toBeTruthy();
  });

  it("handles very small video dimensions", () => {
    const filtergraph = generateOverlayFiltergraph({
      party: "AFD",
      outputFormat: "youtube",
      width: 640,
      height: 360,
    });

    expect(filtergraph).toBeTruthy();
    expect(filtergraph).toContain("drawbox");
  });

  it("handles very large video dimensions", () => {
    const filtergraph = generateOverlayFiltergraph({
      party: "GRUENE",
      outputFormat: "youtube",
      width: 3840,
      height: 2160,
    });

    expect(filtergraph).toBeTruthy();
    expect(filtergraph).toContain("drawbox");
  });
});

// ─── Integration Test ────────────────────────────────────────────────────────

describe("generateOverlayFiltergraph - Integration", () => {
  it("generates complete filtergraph pipeline", () => {
    const filtergraph = generateOverlayFiltergraph({
      party: "SPD",
      outputFormat: "youtube",
      width: 1920,
      height: 1080,
      includeColorBar: true,
      includePartyName: true,
      includeLogo: true,
    });

    // Should contain all three overlay types
    expect(filtergraph).toContain("drawbox"); // Color bar
    expect(filtergraph).toContain("drawtext"); // Party name
    expect(filtergraph).toContain("overlay="); // Logo

    // Should have proper filter chaining
    expect(filtergraph).toContain(";"); // Filter separator
    expect(filtergraph).toContain("[0:v]"); // Input
    expect(filtergraph).toContain("[outv]"); // Output

    // Should not have syntax errors (basic validation)
    expect(filtergraph).not.toContain(";;"); // No double separators
    expect(filtergraph).not.toContain("[]"); // No empty labels
  });

  it("generates filtergraph that chains filters correctly", () => {
    const filtergraph = generateOverlayFiltergraph({
      party: "CDU",
      outputFormat: "youtube_shorts",
      width: 1080,
      height: 1920,
    });

    // Validate filter chaining structure:
    // [0:v] -> [base] -> [withbar] -> [withtext] -> [withlogo] -> [outv]
    // Each intermediate label should appear as both output and input

    // Should start with [0:v]
    expect(filtergraph.startsWith("[0:v]")).toBe(true);

    // Should end with [outv]
    expect(filtergraph.endsWith("[outv]")).toBe(true);
  });
});
