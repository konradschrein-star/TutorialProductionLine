import React from "react";
import { useCurrentFrame, interpolate, spring } from "remotion";

export interface PopProps {
  text: string;
  frame: number;
  durationInFrames: number;
  fps?: number;
  style?: React.CSSProperties;
}

/**
 * Scale bounce effect - text "pops" in with spring animation
 * Scales from 0.3 to 1.1 then settles to 1.0 with spring physics
 */
export const Pop: React.FC<PopProps> = ({
  text,
  frame,
  durationInFrames,
  fps = 30,
  style,
}) => {
  const currentFrame = useCurrentFrame();

  // Use Remotion's spring function for bouncy effect
  const scale = spring({
    frame: currentFrame,
    fps,
    config: {
      damping: 0.7,
      mass: 0.8,
      overshootClamping: false,
    },
    from: 0.3,
    to: 1,
    durationInFrames: durationInFrames * 0.5,
  });

  // Fade in during pop
  const opacity = interpolate(
    currentFrame,
    [0, durationInFrames * 0.1],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  return (
    <div
      style={{
        transform: `scale(${scale})`,
        opacity: Math.max(0, Math.min(1, opacity)),
        ...style,
      }}
    >
      {text}
    </div>
  );
};
