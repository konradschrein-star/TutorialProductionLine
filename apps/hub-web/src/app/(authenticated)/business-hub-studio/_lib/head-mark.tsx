/**
 * The presenter's head, inlined.
 *
 * Geometry transcribed verbatim from
 * `media/style-assets/presenter/mark/head-mark.svg` (read 2026-08-15, 1831
 * bytes, sha256 c75eeb1d…ff39). It is inlined rather than fetched so the live
 * preview repaints on every animation frame with no network round trip and no
 * `<img>` decode, and so the pump can drive `scale` on real vector geometry.
 *
 * The `var(--mark-bg)` / `var(--mark-fg)` custom properties of the source file
 * become explicit props here: the Studio previews the mark on both the near-black
 * and near-white grounds (design §6), and CSS variables that are never declared
 * would silently paint the fallback blue on both.
 *
 * DRIFT: an inlined copy can fall out of step with the asset. The Studio fetches
 * `GET /api/business-hub/studio/head-mark`, compares its sha256 against
 * {@link HEAD_MARK_SOURCE_SHA256}, and warns when they differ instead of
 * presenting a stale preview as authoritative.
 */

import type { CSSProperties } from "react";

/**
 * sha256 of the `head-mark.svg` this component was transcribed from. If the
 * asset is re-drawn, this file must be re-transcribed and this constant updated
 * in the same change.
 */
export const HEAD_MARK_SOURCE_SHA256 =
  "c75eeb1d029156d7ca05ab01c0ee16cd51a0f282ddf31bbf96eed75c89cbff39";

/** Fallback colours declared in the source SVG's `var()` calls. */
export const HEAD_MARK_DEFAULT_BG = "#1272b0";
export const HEAD_MARK_DEFAULT_FG = "#ffffff";

interface HeadMarkProps {
  /** Rendered diameter in CSS pixels. */
  sizePx: number;
  /** `--mark-bg`: the disc. */
  markBg?: string;
  /** `--mark-fg`: the bars, hook and dot. */
  markFg?: string;
  style?: CSSProperties;
}

/**
 * Render the head mark at `sizePx` diameter.
 *
 * @throws Error if `sizePx` is not a positive finite number — a zero-size head
 *         is an invisible presenter, which reads as "the pump is broken".
 */
export function HeadMark({
  sizePx,
  markBg = HEAD_MARK_DEFAULT_BG,
  markFg = HEAD_MARK_DEFAULT_FG,
  style,
}: HeadMarkProps) {
  if (!Number.isFinite(sizePx) || sizePx <= 0) {
    throw new Error(
      `[HeadMark] sizePx must be finite and > 0, got ${sizePx}. ` +
        "This usually means a head hitbox radius of 0 reached the preview.",
    );
  }

  return (
    <svg
      viewBox="0 0 200 200"
      width={sizePx}
      height={sizePx}
      role="img"
      aria-label="Business Plan Hub head mark"
      style={{ display: "block", ...style }}
    >
      <circle cx="100" cy="100" r="100" fill={markBg} />
      {/*
        The inner transform optically centres the lockup: its natural bounding
        box is x 38..174, y 42..140, whose centre (106,91) sits up and right of
        the circle's (100,100). Without it the bottom-right of the disc reads
        empty. Copied exactly from the source SVG.
      */}
      <g transform="translate(100,100) scale(1.05) translate(-106,-91)">
        <g fill={markFg}>
          <rect x="38" y="112" width="16" height="28" rx="3" />
          <rect x="59" y="94" width="16" height="46" rx="3" />
          <rect x="80" y="76" width="16" height="64" rx="3" />
        </g>
        <g
          transform="translate(92,36)"
          fill="none"
          stroke={markFg}
          strokeWidth="16"
          strokeLinecap="round"
        >
          <path d="M 26,38 A 24,24 0 1 1 50,62 L 50,70" />
        </g>
        <circle cx="142" cy="122" r="9" fill={markFg} />
      </g>
    </svg>
  );
}
