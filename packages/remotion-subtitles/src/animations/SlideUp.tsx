import React from "react";
import { useCurrentFrame, interpolate } from "remotion";

export interface SlideUpProps {
  text: string;
  frame: number;
  durationInFrames: number;
  style?: React.CSSProperties;
}

/**
 * Slides up from bottom with fade in animation
 * Text starts 40px below and transparent, slides up and fades in over first 30% of duration
 */
export const SlideUp: React.FC<SlideUpProps> = ({
  text,
  frame,
  durationInFrames,
  style,
}) => {
  const currentFrame = useCurrentFrame();
  const slideProgress = Math.min(currentFrame / (durationInFrames * 0.3), 1);

  // Interpolate position from 40px down to 0px
  const translateY = interpolate(slideProgress, [0, 1], [40, 0]);

  // Fade in parallel with slide
  const opacity = interpolate(slideProgress, [0, 1], [0, 1]);

  return (
    <div
      style={{
        transform: `translateY(${translateY}px)`,
        opacity: Math.max(0, Math.min(1, opacity)),
        ...style,
      }}
    >
      {text}
    </div>
  );
};
