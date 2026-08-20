import React from "react";
import type { RemotionSubtitleConfig } from "@repo/db";

interface SpeakerHeadingProps {
  speakerId: string;
  config: RemotionSubtitleConfig;
  /**
   * Canvas scale from computeCanvasScale(), passed down by <CaptionChunk>
   * rather than read from useVideoConfig() here so this stays a pure component
   * that can be rendered (and unit-tested) outside a Remotion composition.
   */
  scale?: number;
}

/**
 * "Cop:" style heading above a chunk, rendered in the speaker's registry color.
 * Renders nothing if the speaker id isn't found in the registry.
 */
export const SpeakerHeading: React.FC<SpeakerHeadingProps> = ({
  speakerId,
  config,
  scale = 1,
}) => {
  const speaker = config.speakers?.registry.find((s) => s.id === speakerId);
  if (!speaker) return null;

  return (
    <span
      style={{
        fontFamily: config.fontFamily,
        fontWeight: 700,
        fontSize: Math.round(config.fontSize * 0.6 * scale),
        color: speaker.color,
        lineHeight: 1.1,
        marginBottom: 4 * scale,
        whiteSpace: "pre",
      }}
    >
      {`${speaker.label}:`}
    </span>
  );
};
