/**
 * The persistent corner watermark, inlined.
 *
 * Geometry transcribed verbatim from
 * `media/style-assets/presenter/mark/watermark.svg` (read 2026-08-15): the
 * disc-less lockup, whose viewBox is the tight bounding box of the head mark's
 * glyphs translated to the origin. The source inherits `currentColor`; here the
 * colour is an explicit prop so the Scene Preview can put it on both grounds.
 *
 * Brief §6: the watermark sits bottom-right at all times. The Scene Preview
 * draws it on every layout for exactly that reason — a layout tuned without it
 * is a layout that will collide with it later.
 */

import type { CSSProperties } from "react";

interface WatermarkProps {
  /** Rendered width in CSS pixels. Height follows the 152:114 viewBox. */
  widthPx: number;
  colour: string;
  /** ~0.55 is the usual corner treatment, per the source file's comment. */
  opacity?: number;
  style?: CSSProperties;
}

/**
 * Render the watermark lockup.
 *
 * @throws Error if `widthPx` is not a positive finite number.
 */
export function Watermark({
  widthPx,
  colour,
  opacity = 0.55,
  style,
}: WatermarkProps) {
  if (!Number.isFinite(widthPx) || widthPx <= 0) {
    throw new Error(
      `[Watermark] widthPx must be finite and > 0, got ${widthPx}.`,
    );
  }
  const height = (widthPx * 114) / 152;

  return (
    <svg
      viewBox="0 0 152 114"
      width={widthPx}
      height={height}
      role="img"
      aria-label="Business Plan Hub watermark"
      style={{ display: "block", opacity, ...style }}
    >
      <g transform="translate(-30,-34)" fill={colour}>
        <rect x="38" y="112" width="16" height="28" rx="3" />
        <rect x="59" y="94" width="16" height="46" rx="3" />
        <rect x="80" y="76" width="16" height="64" rx="3" />
        <circle cx="142" cy="122" r="9" />
        <g
          transform="translate(92,36)"
          fill="none"
          stroke={colour}
          strokeWidth="16"
          strokeLinecap="round"
        >
          <path d="M 26,38 A 24,24 0 1 1 50,62 L 50,70" />
        </g>
      </g>
    </svg>
  );
}
