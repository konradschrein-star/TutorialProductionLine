import React from "react";
import { useCurrentFrame, interpolate } from "remotion";

export interface SmoothHighlightProps {
  text: string;
  frame: number;
  durationInFrames: number;
  highlightColor?: string;
  style?: React.CSSProperties;
}

/**
 * Word-by-word highlight animation with smooth transitions
 * Each word is highlighted sequentially across the duration
 * Highlighted words appear with background color, others fade in normally
 */
export const SmoothHighlight: React.FC<SmoothHighlightProps> = ({
  text,
  frame,
  durationInFrames,
  highlightColor = "rgba(255, 255, 0, 0.3)",
  style,
}) => {
  const currentFrame = useCurrentFrame();

  // Split text into words
  const words = text.split(" ");

  // Calculate which word should be highlighted
  const wordProgress = interpolate(
    currentFrame,
    [0, durationInFrames],
    [0, words.length],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const highlightedWordIndex = Math.floor(wordProgress);
  const highlightTransition = wordProgress - highlightedWordIndex;

  // Render words with smooth highlighting
  const renderedWords = words.map((word, index) => {
    let bgColor = "transparent";
    let opacity = 1;

    if (index < highlightedWordIndex) {
      // Already passed - fully visible, no highlight
      bgColor = "transparent";
      opacity = 1;
    } else if (index === highlightedWordIndex) {
      // Currently highlighting - smooth transition
      bgColor = `rgba(255, 255, 0, ${0.3 * highlightTransition})`;
      opacity = Math.min(1, 0.5 + highlightTransition * 0.5);
    } else if (index === highlightedWordIndex + 1) {
      // Next word - fade in gently
      opacity = Math.max(0, highlightTransition);
    } else {
      // Future words - not visible yet
      opacity = 0;
    }

    return (
      <span
        key={index}
        style={{
          backgroundColor: bgColor,
          opacity,
          paddingLeft: "2px",
          paddingRight: "2px",
          transition: "background-color 0.1s ease",
        }}
      >
        {word}
      </span>
    );
  });

  return (
    <div style={style}>
      {renderedWords.map((word, index) => (
        <React.Fragment key={index}>
          {word}
          {index < renderedWords.length - 1 && " "}
        </React.Fragment>
      ))}
    </div>
  );
};
