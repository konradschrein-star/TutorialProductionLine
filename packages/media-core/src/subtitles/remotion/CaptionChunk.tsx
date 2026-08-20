import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import type { RemotionSubtitleConfig } from "@repo/db";
import type { CaptionChunk as CaptionChunkType } from "../types.js";
import {
  computeBackgroundStyle,
  computeCanvasScale,
} from "./caption-styles.js";
import { activeWordIndex } from "../layout.js";
import { CaptionWord } from "./CaptionWord.js";
import { SpeakerHeading } from "./SpeakerHeading.js";

const CLAMP = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

interface CaptionChunkProps {
  chunk: CaptionChunkType;
  config: RemotionSubtitleConfig;
}

/**
 * One caption "screen": background pill + wrapped lines of words, with a
 * config-driven entrance animation and optional speaker heading. Word-level
 * animation lives in <CaptionWord>; deterministic style is in caption-styles.
 */
export const CaptionChunk: React.FC<CaptionChunkProps> = ({
  chunk,
  config,
}) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const scale = computeCanvasScale(config, height);

  const anim = config.animation;
  const duration = Math.max(1, Math.floor(anim.durationFrames));
  const since = frame - chunk.start * fps;

  // Which word is "currently spoken". Decided ONCE per chunk with the shared
  // rule the ASS engine also uses, so the highlight is continuous across the
  // silent gaps between Whisper words and identical in both engines.
  const activeIndex = activeWordIndex(chunk.words, frame / fps);

  // Caption (whole-screen) entrance animation.
  let opacity = 1;
  let translateY = 0;
  // Entrance-animation scale — distinct from the canvas `scale` above.
  let entranceScale = 1;

  if (anim.enabled && anim.caption !== "none") {
    const fade = interpolate(since, [0, duration], [0, 1], CLAMP);
    switch (anim.caption) {
      case "fade":
        opacity = fade;
        break;
      case "slideUp":
        opacity = fade;
        translateY = interpolate(since, [0, duration], [40 * scale, 0], CLAMP);
        break;
      case "slideDown":
        opacity = fade;
        translateY = interpolate(since, [0, duration], [-40 * scale, 0], CLAMP);
        break;
      case "pop": {
        const p = spring({
          frame: since,
          fps,
          config: { damping: 14, stiffness: 200 },
          durationInFrames: duration,
        });
        entranceScale = interpolate(p, [0, 1], [0.8, 1]);
        opacity = fade;
        break;
      }
      case "bounce": {
        const p = spring({
          frame: since,
          fps,
          config: { damping: 8, stiffness: 160, mass: 0.8 },
          durationInFrames: duration,
        });
        entranceScale = interpolate(p, [0, 1], [0.7, 1]);
        opacity = fade;
        break;
      }
      default:
        break;
    }
  }

  const lines = chunk.lines.length > 0 ? chunk.lines : [chunk.words];

  const justify =
    config.alignment === "left"
      ? "flex-start"
      : config.alignment === "right"
        ? "flex-end"
        : "center";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems:
          config.alignment === "left"
            ? "flex-start"
            : config.alignment === "right"
              ? "flex-end"
              : "center",
        opacity,
        transform: `translateY(${translateY}px) scale(${entranceScale})`,
        maxWidth: "100%",
        ...computeBackgroundStyle(config.background, scale),
      }}
    >
      {config.speakers?.enabled &&
      config.speakers.showHeading &&
      chunk.speakerId ? (
        <SpeakerHeading
          speakerId={chunk.speakerId}
          config={config}
          scale={scale}
        />
      ) : null}
      {lines.map((line, li) => {
        // Global word index across the whole chunk (not per-line) so the
        // deterministic variance decorrelates over the full caption.
        const lineOffset = lines.slice(0, li).reduce((n, l) => n + l.length, 0);
        return (
          <div
            key={li}
            style={{
              // Normal inline flow, NOT flex. Words are separated by real space
              // characters so the gap is the font's own space glyph — which is
              // exactly what libass renders in the ASS engine. A flex `gap` was
              // an invented number that could never match, and when it was
              // expressed in `em` it resolved against the unset 16px container
              // font-size and collapsed to ~4px on 60px text
              // ("Thisisa quickcaption").
              //
              // Inline flow also gives real word wrapping, so a line that
              // overruns the safe area folds instead of running off the frame.
              display: "block",
              textAlign: config.alignment,
              // The line box must carry the caption's font metrics, otherwise
              // the inter-word space and the line height come from the 16px
              // document default.
              fontFamily: config.fontFamily,
              fontSize: config.fontSize * scale,
              lineHeight: 1.2,
              maxWidth: "100%",
            }}
          >
            {line.map((word, wi) => (
              <React.Fragment key={wi}>
                {wi > 0 ? " " : null}
                <CaptionWord
                  word={word}
                  config={config}
                  wordIndex={lineOffset + wi}
                  isActive={lineOffset + wi === activeIndex}
                />
              </React.Fragment>
            ))}
          </div>
        );
      })}
    </div>
  );
};
