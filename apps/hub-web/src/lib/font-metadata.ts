import fontkit from "fontkit";
import type { SubtitleFontWeight } from "@repo/db";

/**
 * The minimal, engine-agnostic view of a parsed font that the weight/family
 * derivation logic needs. Keeping the pure logic separate from fontkit parsing
 * makes `deriveFontWeights`/`resolveFontFamily` unit-testable without real font
 * binaries.
 */
export interface ParsedFontInfo {
  /** OpenType family name (name ID 1 / typographic family). */
  familyName: string;
  /** Sub-family / style name ("Regular", "Bold", "Bold Italic", …). */
  subfamilyName?: string | null;
  /** OS/2 usWeightClass (100..900). Absent/0 → treated as 400 (Regular). */
  usWeightClass?: number;
  /** Variable-font design axes keyed by 4-letter tag (e.g. "wght"). */
  variationAxes?: Partial<
    Record<string, { name?: string; min: number; default: number; max: number }>
  >;
}

/** Standard CSS weight → human label map (nearest match used for arbitrary values). */
const WEIGHT_LABELS: Array<{ weight: number; label: string }> = [
  { weight: 100, label: "Thin" },
  { weight: 200, label: "ExtraLight" },
  { weight: 300, label: "Light" },
  { weight: 400, label: "Regular" },
  { weight: 500, label: "Medium" },
  { weight: 600, label: "SemiBold" },
  { weight: 700, label: "Bold" },
  { weight: 800, label: "ExtraBold" },
  { weight: 900, label: "Black" },
];

/** Human label for a numeric weight — nearest standard stop. */
export function weightLabel(weight: number): string {
  let best = WEIGHT_LABELS[0]!;
  let bestDist = Math.abs(weight - best.weight);
  for (const entry of WEIGHT_LABELS) {
    const d = Math.abs(weight - entry.weight);
    if (d < bestDist) {
      best = entry;
      bestDist = d;
    }
  }
  return best.label;
}

/**
 * Derive the available weights for a font. A variable font with a `wght` axis
 * "collapses to one file with a weight range": we emit one entry per standard
 * stop (100..900) that falls inside the axis range, all pointing at the single
 * file. A static font emits exactly one entry from its OS/2 weight (default 400).
 */
export function deriveFontWeights(
  info: ParsedFontInfo,
  filePath: string,
): SubtitleFontWeight[] {
  const wght = info.variationAxes?.["wght"];
  if (wght && wght.max > wght.min) {
    const lo = Math.round(wght.min);
    const hi = Math.round(wght.max);
    const inRange = WEIGHT_LABELS.filter(
      (w) => w.weight >= lo && w.weight <= hi,
    );
    const stops =
      inRange.length > 0
        ? inRange
        : [
            {
              weight: Math.round(wght.default),
              label: weightLabel(wght.default),
            },
          ];
    return stops.map((s) => ({
      weight: s.weight,
      label: s.label,
      file_path: filePath,
    }));
  }

  const weight =
    info.usWeightClass && info.usWeightClass > 0 ? info.usWeightClass : 400;
  return [{ weight, label: weightLabel(weight), file_path: filePath }];
}

/** Family name for storage — falls back to a caller-supplied name when absent. */
export function resolveFontFamily(
  info: ParsedFontInfo,
  fallback: string,
): string {
  const fam = info.familyName?.trim();
  return fam && fam.length > 0 ? fam : fallback;
}

/**
 * Parse a TTF/OTF/WOFF2 buffer with fontkit and extract the family name plus
 * available weights. `filePath` is the stored absolute path recorded on each
 * weight entry. Throws if the buffer is not a parseable single font.
 */
export function extractFontMetadata(
  buffer: Buffer,
  filePath: string,
  fallbackName: string,
): { family: string; weights: SubtitleFontWeight[] } {
  const parsed = fontkit.create(buffer);
  // Collection files (TTC/DFont) expose `.fonts`; take the first face.
  const font =
    "fonts" in parsed && Array.isArray(parsed.fonts) ? parsed.fonts[0] : parsed;
  if (!font || !("familyName" in font)) {
    throw new Error("Unparseable font: no font face found in file");
  }

  const info: ParsedFontInfo = {
    familyName: font.familyName,
    subfamilyName: font.subfamilyName,
    usWeightClass: font["OS/2"]?.usWeightClass,
    variationAxes: font.variationAxes,
  };

  return {
    family: resolveFontFamily(info, fallbackName),
    weights: deriveFontWeights(info, filePath),
  };
}
