"use client";
import React from "react";
import { ENGINE_PARITY_NOTES } from "@repo/media-core/subtitles/remotion";
import { FontControls } from "./FontControls";
import { CaptionControls } from "./CaptionControls";
import { BackgroundControls } from "./BackgroundControls";
import { AnimationControls } from "./AnimationControls";
import type { RemotionControlProps } from "./types";

/**
 * Controls for an `engine: "ffmpeg"` (libass) preset.
 *
 * Both engines now share ONE canonical config, so this is deliberately the same
 * control stack the Remotion editor shows — an operator authors one look and
 * picks a renderer, rather than authoring two unrelated looks that happened to
 * be called the same thing.
 *
 * Only the genuinely Remotion-only sections (secondary font, speaker headings)
 * are absent, and the handful of properties libass approximates or ignores are
 * spelled out below instead of silently differing.
 */
export function FfmpegControls({
  config,
  onChange,
  disabled,
  fonts = [],
}: RemotionControlProps) {
  return (
    <>
      <div
        style={{
          fontSize: 12,
          lineHeight: 1.5,
          color: "#cdc3d7",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8,
          padding: "10px 12px",
          marginBottom: 14,
        }}
      >
        <strong style={{ color: "#e9e2f0" }}>
          Rendered by libass (fast path).
        </strong>{" "}
        Type size, colours, outline weight, safe area, line breaks and the
        spoken-word highlight match the Remotion engine exactly. These do not:
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          {ENGINE_PARITY_NOTES.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>

      <FontControls
        config={config}
        onChange={onChange}
        disabled={disabled}
        fonts={fonts}
      />
      <CaptionControls
        config={config}
        onChange={onChange}
        disabled={disabled}
      />
      <BackgroundControls
        config={config}
        onChange={onChange}
        disabled={disabled}
      />
      <AnimationControls
        config={config}
        onChange={onChange}
        disabled={disabled}
      />
    </>
  );
}
