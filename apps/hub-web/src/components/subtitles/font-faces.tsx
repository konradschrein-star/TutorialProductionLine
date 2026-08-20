"use client";
// ---------------------------------------------------------------------------
// Browser-side @font-face registration for every subtitle preview.
//
// Presets store `fontFamily` as the font's DISPLAY name ("Komika Axis",
// "Anton", "Arial"). Nothing in the browser knows what that means unless an
// @font-face has been declared for it — so before this existed, every preview
// silently rendered in the system fallback and all presets looked identical.
// (Fonts ARE registered at render time via <SubtitleFontFaces> in media-core;
// the previews just never had an equivalent.)
//
// One module-level fetch + one injected <style> element is shared by the whole
// page, so a grid of 20 preset cards does not fire 20 requests.
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from "react";

export interface SubtitleFontWeightRow {
  weight: number;
  label: string;
  file_path: string;
}

export interface SubtitleFontRow {
  id: string;
  name: string;
  file_name: string;
  family: string;
  format: string;
  weights: SubtitleFontWeightRow[];
  is_builtin: boolean;
  source: string;
  preview_text: string | null;
  created_at?: string;
}

export type FontsState =
  | { status: "loading"; fonts: SubtitleFontRow[]; error: null }
  | { status: "ready"; fonts: SubtitleFontRow[]; error: null }
  | { status: "error"; fonts: SubtitleFontRow[]; error: string };

/** URL of the binary for one weight of a font row. */
export function fontFileUrl(fontId: string, weight?: number): string {
  return weight == null
    ? `/api/v1/subtitle-fonts/${fontId}/file`
    : `/api/v1/subtitle-fonts/${fontId}/file?weight=${weight}`;
}

function cssFormat(format: string): string | null {
  switch (format.toLowerCase()) {
    case "ttf":
      return "truetype";
    case "otf":
      return "opentype";
    case "woff":
      return "woff";
    case "woff2":
      return "woff2";
    default:
      return null;
  }
}

/**
 * Build the @font-face CSS for a set of font rows. Each family is declared
 * under BOTH its display name (what presets put in `config.fontFamily`) and its
 * real embedded family name (what the ASS renderer keys off), so a preview
 * resolves whichever the config happens to carry.
 *
 * Exported for unit testing — pure string in / string out.
 */
export function buildFontFaceCss(fonts: SubtitleFontRow[]): string {
  const rules: string[] = [];
  for (const font of fonts) {
    const aliases = Array.from(
      new Set([font.name, font.family].filter(Boolean)),
    );
    const weights =
      Array.isArray(font.weights) && font.weights.length > 0
        ? font.weights
        : [{ weight: 400, label: "Regular", file_path: "" }];
    for (const alias of aliases) {
      for (const w of weights) {
        const fmt = cssFormat(font.format);
        const src =
          `url(${JSON.stringify(fontFileUrl(font.id, w.weight))})` +
          (fmt ? ` format(${JSON.stringify(fmt)})` : "");
        rules.push(
          `@font-face{font-family:${JSON.stringify(alias)};` +
            `src:${src};font-weight:${w.weight};font-style:normal;` +
            `font-display:swap;}`,
        );
      }
    }
  }
  return rules.join("\n");
}

// --- module-level cache so every card/page shares one fetch ----------------

let cache: SubtitleFontRow[] | null = null;
let inflight: Promise<SubtitleFontRow[]> | null = null;

async function fetchFonts(): Promise<SubtitleFontRow[]> {
  if (cache) return cache;
  if (!inflight) {
    inflight = fetch("/api/v1/subtitle-fonts")
      .then(async (r) => {
        if (!r.ok) throw new Error(`subtitle-fonts responded ${r.status}`);
        const rows = await r.json();
        if (!Array.isArray(rows))
          throw new Error("subtitle-fonts: bad payload");
        cache = rows as SubtitleFontRow[];
        return cache;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Drop the shared cache — call after uploading/deleting a font. */
export function invalidateSubtitleFontCache(): void {
  cache = null;
}

/**
 * Loads the font registry. Never swallows a failure into an empty list: the
 * caller gets an explicit `status: "error"` so the UI can say so instead of
 * silently previewing in the wrong typeface.
 */
export function useSubtitleFonts(): FontsState {
  const [state, setState] = useState<FontsState>(() =>
    cache
      ? { status: "ready", fonts: cache, error: null }
      : { status: "loading", fonts: [], error: null },
  );

  useEffect(() => {
    let alive = true;
    fetchFonts()
      .then((fonts) => {
        if (alive) setState({ status: "ready", fonts, error: null });
      })
      .catch((e: unknown) => {
        if (alive)
          setState({
            status: "error",
            fonts: [],
            error: e instanceof Error ? e.message : String(e),
          });
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}

/**
 * Injects the @font-face block for the whole subtitle font registry. Mount once
 * near the top of any page that previews captions.
 */
export function SubtitleFontFaceStyles({
  fonts,
}: {
  fonts: SubtitleFontRow[];
}) {
  const css = React.useMemo(() => buildFontFaceCss(fonts), [fonts]);
  if (!css) return null;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
