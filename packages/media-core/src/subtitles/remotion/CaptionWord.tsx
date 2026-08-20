import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import type { RemotionSubtitleConfig } from "@repo/db";
import type { CaptionWord as CaptionWordType } from "../types.js";
import {
  computeCanvasScale,
  computeWordStyle,
  computeWordVariance,
} from "./caption-styles.js";

const CLAMP = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

interface CaptionWordProps {
  word: CaptionWordType;
  config: RemotionSubtitleConfig;
  /** Position of this word within its chunk — keys the deterministic variance. */
  wordIndex: number;
  /**
   * Whether this word is the currently-spoken one. Decided by the PARENT via
   * the shared `activeWordIndex` helper, not per-word here.
   *
   * This used to be computed locally as `time >= word.start && time < word.end`,
   * which meant that during the silent gaps Whisper leaves between words NO word
   * was active and the highlight blinked off several times a second. The shared
   * rule keeps a word active until the next one starts.
   */
  isActive: boolean;
}

/**
 * A single caption word. Deterministic styling comes from computeWordStyle; the
 * Remotion-timed parts (per-word entrance + active-word scale spring) live here
 * because they depend on frame context and are impractical to unit-test.
 */
export const CaptionWord: React.FC<CaptionWordProps> = ({
  word,
  config,
  wordIndex,
  isActive,
}) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();

  // Px in the config are authored against a 1080-tall reference frame; scale
  // them to the real canvas so one preset reads the same at 16:9 and 9:16.
  const canvasScale = computeCanvasScale(config, height);
  const baseStyle = computeWordStyle(word, config, isActive, canvasScale);

  const anim = config.animation;
  const duration = Math.max(1, Math.floor(anim.durationFrames));

  // Deterministic per-word variance (spec §4.1 "+ variants"). No-op unless both
  // animation.enabled and animation.variants are on.
  const { delayFrames, scaleJitter } = computeWordVariance(
    wordIndex,
    anim.enabled && anim.variants,
  );

  const startFrame = word.start * fps;
  // Entrance timing is offset later by the variance delay; active-word timing is
  // NOT delayed (it must track the spoken word).
  const since = frame - startFrame - delayFrames;

  let opacity = 1;
  let scale = 1;
  let translateY = 0;

  if (anim.enabled) {
    switch (anim.word) {
      case "fadeInFast":
        opacity = interpolate(since, [0, Math.min(duration, 4)], [0, 1], CLAMP);
        break;
      case "pop": {
        const p = spring({
          frame: since,
          fps,
          config: { damping: 12, stiffness: 220 },
          durationInFrames: duration,
        });
        scale = interpolate(p, [0, 1], [0.6, 1]);
        opacity = interpolate(since, [0, duration], [0, 1], CLAMP);
        break;
      }
      case "scale": {
        const p = spring({
          frame: since,
          fps,
          config: { damping: 18, stiffness: 140 },
          durationInFrames: duration,
        });
        scale = interpolate(p, [0, 1], [0.85, 1]);
        opacity = interpolate(since, [0, duration], [0, 1], CLAMP);
        break;
      }
      case "colorReveal":
        // Reveal via opacity; the active-word color override handles the pop.
        opacity = interpolate(since, [0, duration], [0, 1], CLAMP);
        break;
      case "none":
      default:
        break;
    }
  }

  // Active-word emphasis scale (pure color handled by computeWordStyle). Uses
  // un-delayed timing so emphasis tracks the actually-spoken word.
  if (isActive && anim.activeWordScale && anim.activeWordScale !== 1) {
    const activeSpring = spring({
      frame: frame - startFrame,
      fps,
      config: { damping: 14, stiffness: 180 },
      durationInFrames: Math.max(1, Math.floor(duration / 2) || 1),
    });
    scale *= interpolate(activeSpring, [0, 1], [1, anim.activeWordScale]);
  }

  // Subtle deterministic scale jitter (0 when variants off).
  scale += scaleJitter;

  const transform =
    scale !== 1 || translateY !== 0
      ? `translateY(${translateY}px) scale(${scale})`
      : undefined;

  return (
    <span
      style={{
        ...baseStyle,
        opacity:
          (baseStyle.opacity != null ? Number(baseStyle.opacity) : 1) * opacity,
        transform,
        // Scale the ACTIVE word about its own centre so a highlight cannot push
        // neighbouring words sideways.
        transformOrigin: "center center",
      }}
    >
      {word.word}
    </span>
  );
};
