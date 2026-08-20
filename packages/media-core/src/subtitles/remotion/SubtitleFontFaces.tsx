/// <reference lib="dom" />
import React, { useEffect, useState } from "react";
import { delayRender, continueRender } from "remotion";

/**
 * One @font-face to register for the caption render. `family` is the CSS family
 * string the caption CSS actually requests (i.e. `config.fontFamily` or
 * `config.secondaryFont.fontFamily`); `url` is an absolute URL to the font file
 * (a `file://` path on the worker, resolvable because all render paths run
 * Chromium with `disableWebSecurity: true`).
 */
export interface SubtitleFontFace {
  family: string;
  url: string;
  weight: number;
}

/**
 * Registers the resolved subtitle fonts into the Remotion render (spec §7d).
 *
 * Injects an `@font-face` per weight, then blocks the frame (delayRender) until
 * the browser has loaded them so text never rasterises in a fallback font on the
 * first frames. A hard timeout + swallow-on-error guarantees a missing/broken
 * font degrades to the fallback family instead of hanging the render forever.
 *
 * Mount this UNCONDITIONALLY (not gated on whether a caption is visible) so the
 * delayRender fires exactly once at composition mount.
 */
export const SubtitleFontFaces: React.FC<{ faces: SubtitleFontFace[] }> = ({
  faces,
}) => {
  const [handle] = useState(() =>
    faces.length > 0 ? delayRender(`subtitle-fonts(${faces.length})`) : null,
  );

  useEffect(() => {
    if (handle === null) return;
    let cancelled = false;
    // Build the load promise defensively: document.fonts.load is called
    // synchronously in the map, so a synchronous throw here (however unlikely)
    // must not escape before .finally() and leave the frame hung forever.
    let loadAll: Promise<unknown>;
    try {
      loadAll = Promise.all(
        faces.map((f) =>
          // document.fonts.load triggers the actual fetch of the @font-face src.
          document.fonts.load(`${f.weight} 1em ${JSON.stringify(f.family)}`),
        ),
      );
    } catch {
      loadAll = Promise.resolve();
    }
    // Continue no matter what — a font that fails to load must never hang render.
    Promise.race([loadAll, new Promise((resolve) => setTimeout(resolve, 8000))])
      .catch(() => {})
      .finally(() => {
        if (!cancelled) continueRender(handle);
      });
    return () => {
      cancelled = true;
    };
    // handle is stable for this mount; faces is fixed per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  if (faces.length === 0) return null;

  const css = faces
    .map(
      (f) =>
        `@font-face{font-family:${JSON.stringify(f.family)};` +
        `src:url(${JSON.stringify(f.url)});` +
        `font-weight:${f.weight};font-style:normal;font-display:block;}`,
    )
    .join("\n");

  return <style dangerouslySetInnerHTML={{ __html: css }} />;
};
