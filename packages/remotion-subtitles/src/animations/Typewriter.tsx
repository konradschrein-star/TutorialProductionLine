import React from "react";
import { useCurrentFrame, interpolate } from "remotion";

export interface TypewriterProps {
  text: string;
  frame: number;
  durationInFrames: number;
  style?: React.CSSProperties;
}

/**
 * Characters appear one by one in typewriter effect
 * Each character appears sequentially across the duration
 */
export const Typewriter: React.FC<TypewriterProps> = ({
  text,
  frame,
  durationInFrames,
  style,
}) => {
  const currentFrame = useCurrentFrame();

  // Calculate how many characters should be visible
  // Distribute character reveals evenly across duration
  const charProgress = interpolate(
    currentFrame,
    [0, durationInFrames],
    [0, text.length],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  // Round down to get whole number of characters to show
  const visibleCharCount = Math.floor(charProgress);

  return (
    <div style={style}>
      {text.substring(0, visibleCharCount)}
      {visibleCharCount < text.length && (
        <span style={{ opacity: 0.5, marginLeft: "2px" }}>|</span>
      )}
    </div>
  );
};
