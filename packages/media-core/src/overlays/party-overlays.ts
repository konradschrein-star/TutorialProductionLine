/**
 * Party Overlay System for Bundestag Video Processing
 *
 * Provides party-specific visual overlays (colors, logos, text) for segmented
 * parliamentary speeches. Generates FFmpeg filtergraph commands to apply overlays
 * during rendering.
 *
 * Supports multiple output formats:
 * - YouTube (16:9, 1920x1080)
 * - YouTube Shorts (9:16, 1080x1920)
 * - TikTok (9:16, 1080x1920)
 * - Instagram Reels (9:16, 1080x1920)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Party identifier for German Bundestag parties.
 * UNKNOWN used for undetected or fallback cases.
 */
export type PartyName =
  | "SPD"
  | "CDU"
  | "AFD"
  | "GRUENE"
  | "FDP"
  | "LINKE"
  | "UNKNOWN";

/**
 * Visual configuration for a party's overlay.
 */
export interface PartyOverlayConfig {
  /** Primary party color (hex format, e.g., "#E3000F") */
  primary_color: string;
  /** Path to party logo PNG (relative to OVERLAY_ASSETS_PATH) */
  logo_path: string;
  /** Text color for party name (hex format) */
  font_color: string;
  /** Secondary accent color (hex format) */
  accent_color: string;
}

/**
 * Output format determines aspect ratio and element positioning.
 */
export type OutputFormat =
  | "youtube"
  | "youtube_shorts"
  | "tiktok"
  | "instagram";

/**
 * Options for generating overlay filtergraph.
 */
export interface OverlayOptions {
  /** Party to display overlay for */
  party: PartyName;
  /** Target output format (determines aspect ratio and positioning) */
  outputFormat: OutputFormat;
  /** Video width in pixels */
  width: number;
  /** Video height in pixels */
  height: number;
  /** Display party name as text overlay (default: true) */
  includePartyName?: boolean;
  /** Display party logo (default: true, requires logo file) */
  includeLogo?: boolean;
  /** Display colored bar at bottom (default: true) */
  includeColorBar?: boolean;
  /** Base path for overlay assets (logos, fonts). If not provided, uses env var OVERLAY_ASSETS_PATH */
  assetsBasePath?: string;
}

// ─── Party Configurations ────────────────────────────────────────────────────

/**
 * Party-specific overlay configurations.
 * Colors based on official party branding.
 * Logo paths are relative to OVERLAY_ASSETS_PATH environment variable.
 */
export const PARTY_OVERLAYS: Record<PartyName, PartyOverlayConfig> = {
  SPD: {
    primary_color: "#E3000F", // SPD red
    logo_path: "/overlays/spd-logo.png",
    font_color: "#FFFFFF",
    accent_color: "#000000",
  },
  CDU: {
    primary_color: "#000000", // CDU black
    logo_path: "/overlays/cdu-logo.png",
    font_color: "#FFFFFF",
    accent_color: "#FF9900", // CDU orange accent
  },
  AFD: {
    primary_color: "#0088FF", // AFD blue
    logo_path: "/overlays/afd-logo.png",
    font_color: "#FFFFFF",
    accent_color: "#FF0000",
  },
  GRUENE: {
    primary_color: "#64A12D", // Grüne green
    logo_path: "/overlays/gruene-logo.png",
    font_color: "#FFFFFF",
    accent_color: "#FFED00", // Grüne yellow accent
  },
  FDP: {
    primary_color: "#FFED00", // FDP yellow
    logo_path: "/overlays/fdp-logo.png",
    font_color: "#000000", // Black text on yellow
    accent_color: "#009EE0", // FDP blue accent
  },
  LINKE: {
    primary_color: "#BE3075", // Die Linke magenta
    logo_path: "/overlays/linke-logo.png",
    font_color: "#FFFFFF",
    accent_color: "#8B1A4F", // Darker magenta accent
  },
  UNKNOWN: {
    primary_color: "#808080", // Gray for unknown/undetected
    logo_path: "", // No logo for unknown
    font_color: "#FFFFFF",
    accent_color: "#666666",
  },
};

// ─── Format-Specific Positioning ─────────────────────────────────────────────

/**
 * Logo position coordinates for different output formats.
 * Uses FFmpeg expression syntax (W = output width, H = output height, w = logo width, h = logo height).
 */
interface Position {
  x: string;
  y: string;
}

/**
 * Get logo position based on output format.
 * - YouTube (16:9): Logo in top-right corner
 * - Vertical formats (9:16): Logo centered at top
 */
function getLogoPosition(format: OutputFormat): Position {
  const margin = 20; // pixels from edge

  if (format === "youtube") {
    // 16:9 landscape: Top-right corner
    return {
      x: `W-w-${margin}`,
      y: String(margin),
    };
  } else {
    // 9:16 vertical: Top-center
    return {
      x: "(W-w)/2", // Centered horizontally
      y: String(margin),
    };
  }
}

/**
 * Bar dimensions for colored bar overlay.
 * Bar appears at bottom of video with party color.
 */
interface BarDimensions {
  height: number; // pixels
  y: string; // FFmpeg expression for Y position
}

/**
 * Get color bar dimensions based on output format.
 * Taller bars for horizontal videos, shorter for vertical to save space.
 */
function getBarDimensions(format: OutputFormat, videoHeight: number): BarDimensions {
  if (format === "youtube") {
    // 16:9: Taller bar (80px)
    return {
      height: 80,
      y: "H-80",
    };
  } else {
    // 9:16: Shorter bar (60px) to maximize content area
    return {
      height: 60,
      y: "H-60",
    };
  }
}

/**
 * Text position for party name display.
 * Positioned inside the colored bar at the bottom.
 */
interface TextPosition {
  x: string;
  y: string;
  fontSize: number;
}

/**
 * Get text position for party name based on format.
 * Text appears inside the colored bar at bottom.
 */
function getTextPosition(format: OutputFormat, barHeight: number): TextPosition {
  const marginLeft = 20;

  if (format === "youtube") {
    return {
      x: String(marginLeft),
      y: `H-${Math.floor(barHeight * 0.6)}`, // Vertically centered in bar
      fontSize: 36,
    };
  } else {
    // Vertical formats: Smaller text
    return {
      x: String(marginLeft),
      y: `H-${Math.floor(barHeight * 0.6)}`,
      fontSize: 28,
    };
  }
}

// ─── FFmpeg Helper Functions ─────────────────────────────────────────────────

/**
 * Convert hex color to FFmpeg color format.
 * FFmpeg accepts hex colors with 0x prefix (e.g., 0xE3000F).
 * Also handles alpha channel if needed (0xRRGGBBAA).
 */
function hexToFFmpegColor(hex: string, alpha = 255): string {
  // Remove # prefix if present
  const clean = hex.replace(/^#/, "");

  // Ensure 6 characters (RGB)
  if (clean.length !== 6) {
    throw new Error(`Invalid hex color: ${hex} (expected 6 characters after #)`);
  }

  // Convert alpha to hex (0-255 → 00-FF)
  const alphaHex = alpha.toString(16).padStart(2, "0");

  // FFmpeg format: 0xRRGGBBAA
  return `0x${clean}${alphaHex}`;
}

/**
 * Escape text for FFmpeg drawtext filter.
 * FFmpeg requires escaping special characters in text strings.
 */
function escapeFFmpegText(text: string): string {
  return text
    .replace(/\\/g, "\\\\") // Backslashes
    .replace(/'/g, "\\'") // Single quotes
    .replace(/:/g, "\\:") // Colons
    .replace(/\[/g, "\\[") // Brackets
    .replace(/\]/g, "\\]");
}

/**
 * Get party display name (formatted for display).
 */
function getPartyDisplayName(party: PartyName): string {
  const names: Record<PartyName, string> = {
    SPD: "SPD",
    CDU: "CDU/CSU",
    AFD: "AfD",
    GRUENE: "Bündnis 90/Die Grünen",
    FDP: "FDP",
    LINKE: "Die Linke",
    UNKNOWN: "Unbekannt",
  };
  return names[party];
}

// ─── Main Export: Filtergraph Generator ──────────────────────────────────────

/**
 * Generate FFmpeg filtergraph for applying party overlay.
 *
 * Returns a filtergraph string that can be used with FFmpeg's -filter_complex option.
 * The filtergraph includes:
 * - Colored bar at bottom (party primary color)
 * - Party logo overlay (if enabled and logo exists)
 * - Party name text (if enabled)
 *
 * @example
 * ```typescript
 * const filtergraph = generateOverlayFiltergraph({
 *   party: "SPD",
 *   outputFormat: "youtube",
 *   width: 1920,
 *   height: 1080,
 * });
 *
 * // Use with FFmpeg:
 * ffmpeg -i input.mp4 -filter_complex "${filtergraph}" output.mp4
 * ```
 */
export function generateOverlayFiltergraph(options: OverlayOptions): string {
  const {
    party,
    outputFormat,
    width,
    height,
    includePartyName = true,
    includeLogo = true,
    includeColorBar = true,
    assetsBasePath = process.env["OVERLAY_ASSETS_PATH"] ?? "/opt/content-forge/assets",
  } = options;

  const config = getPartyConfig(party);
  const filterParts: string[] = [];

  // Start with input video stream labeled [0:v]
  let currentLabel = "[0:v]";
  let nextLabel = "[base]";

  // ── Step 1: Color Bar ──────────────────────────────────────────────────────
  if (includeColorBar) {
    const barDims = getBarDimensions(outputFormat, height);
    const barColor = hexToFFmpegColor(config.primary_color);

    // drawbox filter: draws a filled rectangle
    filterParts.push(
      `${currentLabel}drawbox=x=0:y=${barDims.y}:w=${width}:h=${barDims.height}:color=${barColor}:t=fill${nextLabel}`,
    );

    currentLabel = nextLabel;
    nextLabel = "[withbar]";
  }

  // ── Step 2: Party Name Text ────────────────────────────────────────────────
  if (includePartyName) {
    const barDims = getBarDimensions(outputFormat, height);
    const textPos = getTextPosition(outputFormat, barDims.height);
    const displayName = escapeFFmpegText(getPartyDisplayName(party));
    const textColor = hexToFFmpegColor(config.font_color);

    // drawtext filter: renders text overlay
    // Note: font path can be customized via fontfile parameter if needed
    filterParts.push(
      `${currentLabel}drawtext=text='${displayName}':x=${textPos.x}:y=${textPos.y}:fontsize=${textPos.fontSize}:fontcolor=${textColor}:box=0${nextLabel}`,
    );

    currentLabel = nextLabel;
    nextLabel = "[withtext]";
  }

  // ── Step 3: Logo Overlay ───────────────────────────────────────────────────
  if (includeLogo && config.logo_path && party !== "UNKNOWN") {
    const logoPos = getLogoPosition(outputFormat);
    const logoPath = `${assetsBasePath}${config.logo_path}`;

    // Logo overlay requires two-input filter:
    // 1. Main video stream (current)
    // 2. Logo image (read as input [1:v])
    // This assumes logo is provided as second input: -i logo.png
    //
    // NOTE: For production, logo should be pre-scaled to appropriate size.
    // Recommended logo sizes:
    // - YouTube (16:9): 120x120 px
    // - Vertical (9:16): 100x100 px
    //
    // If logo needs scaling, add scale filter before overlay:
    // [1:v]scale=120:120[logo]; [base][logo]overlay=...

    // For now, assume logo is pre-scaled
    // Overlay syntax: overlay=x:y
    filterParts.push(
      `${currentLabel}[1:v]overlay=${logoPos.x}:${logoPos.y}${nextLabel}`,
    );

    currentLabel = nextLabel;
    nextLabel = "[withlogo]";
  }

  // ── Step 4: Final Output ───────────────────────────────────────────────────
  // Rename final label to [outv] for consistency with render-v3.ts
  const finalLabel = "[outv]";
  if (currentLabel !== finalLabel) {
    // Use null filter to rename label
    filterParts.push(`${currentLabel}null${finalLabel}`);
  }

  return filterParts.join(";");
}

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Get party configuration by name.
 * Throws error if party name is invalid.
 */
export function getPartyConfig(party: PartyName): PartyOverlayConfig {
  const config = PARTY_OVERLAYS[party];
  if (!config) {
    throw new Error(`Unknown party: ${party}`);
  }
  return config;
}

/**
 * Validate if logo file exists for a party.
 * Optional helper for runtime validation.
 *
 * @param party - Party name to check
 * @param assetsBasePath - Base path for overlay assets (default: OVERLAY_ASSETS_PATH env var)
 * @returns Object with validation result and logo path
 *
 * Note: Requires filesystem access (fs module). Not implemented in this version
 * to avoid Node.js dependencies. Can be added in integration layer if needed.
 */
export function getLogoPath(
  party: PartyName,
  assetsBasePath?: string,
): { exists: boolean; path: string } {
  const config = getPartyConfig(party);
  const basePath =
    assetsBasePath ?? process.env["OVERLAY_ASSETS_PATH"] ?? "/opt/content-forge/assets";
  const fullPath = `${basePath}${config.logo_path}`;

  return {
    exists: false, // TODO: Implement filesystem check if needed
    path: fullPath,
  };
}

/**
 * Get all party names (for iteration/validation).
 */
export function getAllPartyNames(): PartyName[] {
  return Object.keys(PARTY_OVERLAYS) as PartyName[];
}

/**
 * Check if a string is a valid party name.
 */
export function isValidPartyName(name: string): name is PartyName {
  return name in PARTY_OVERLAYS;
}
