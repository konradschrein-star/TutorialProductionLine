import React from "react";
import { useCurrentFrame, interpolate } from "remotion";

export interface FadeProps {
  text: string;
  frame: number;
  durationInFrames: number;
  style?: React.CSSProperties;
}

/**
 * Simple opacity fade in/out animation
 * Text fades in from 0% to 50% of duration, stays visible until 80%, then fades out
 */
export const Fade: React.FC<FadeProps> = ({
  text,
  frame,
  durationInFrames,
  style,
}) => {
  const currentFrame = useCurrentFrame();
  const frameProgress = currentFrame / durationInFrames;

  // Fade in: 0% to 50% of duration
  // Hold: 50% to 80% of duration
  // Fade out: 80% to 100% of duration
  let opacity = 0;

  if (frameProgress < 0.5) {
    // Fade in
    opacity = interpolate(frameProgress, [0, 0.5], [0, 1]);
  } else if (frameProgress < 0.8) {
    // Hold visible
    opacity = 1;
  } else {
    // Fade out
    opacity = interpolate(frameProgress, [0.8, 1], [1, 0]);
  }

  return (
    <div
      style={{
        opacity: Math.max(0, Math.min(1, opacity)),
        ...style,
      }}
    >
      {text}
    </div>
  );
};
