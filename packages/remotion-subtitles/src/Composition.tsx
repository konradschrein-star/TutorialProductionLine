import React from "react";
import { useCurrentFrame } from "remotion";
import {
  Fade,
  SlideUp,
  Pop,
  Typewriter,
  SmoothHighlight,
  type FadeProps,
  type SlideUpProps,
  type PopProps,
  type TypewriterProps,
  type SmoothHighlightProps,
} from "./animations";

/**
 * Caption data structure with timing information
 */
export interface CaptionData {
  text: string;
  startFrame: number;
  endFrame: number;
}

/**
 * Animation type selection
 */
export type AnimationType =
  | "fade"
  | "slideUp"
  | "pop"
  | "typewriter"
  | "smoothHighlight";

/**
 * Styling configuration for captions
 */
export interface CaptionStyle {
  fontFamily?: string;
  fontSize?: number;
  primaryColor?: string;
  highlightColor?: string;
  position?: "top" | "center" | "bottom";
  textShadow?: string;
  padding?: number;
}

/**
 * Main composition props for animated captions
 */
export interface CompositionProps {
  captions: CaptionData[];
  animationType: AnimationType;
  style?: CaptionStyle;
}

/**
 * Type guard to extract animation props based on animation type
 */
type AnimationComponentProps =
  | FadeProps
  | SlideUpProps
  | PopProps
  | TypewriterProps
  | SmoothHighlightProps;

/**
 * Get the appropriate animation component for the selected animation type
 */
function getAnimationComponent(
  animationType: AnimationType,
): React.FC<AnimationComponentProps> {
  const componentMap: Record<AnimationType, React.FC<any>> = {
    fade: Fade,
    slideUp: SlideUp,
    pop: Pop,
    typewriter: Typewriter,
    smoothHighlight: SmoothHighlight,
  };

  const component = componentMap[animationType];
  if (!component) {
    throw new Error(`Unknown animation type: ${animationType}`);
  }

  return component;
}

/**
 * Build the CSS style object for the caption container
 */
function buildStyle(
  caption: CaptionData,
  style?: CaptionStyle,
): React.CSSProperties {
  const {
    fontFamily = "Arial, sans-serif",
    fontSize = 48,
    primaryColor = "white",
    position = "center",
    textShadow = "2px 2px 4px rgba(0, 0, 0, 0.5)",
    padding = 16,
  } = style || {};

  const baseStyle: React.CSSProperties = {
    fontFamily,
    fontSize,
    color: primaryColor,
    textAlign: "center",
    textShadow,
    padding,
    fontWeight: "bold",
    letterSpacing: "0.5px",
  };

  // Position the caption based on the position prop
  const positionStyles: Record<string, React.CSSProperties> = {
    top: {
      position: "absolute",
      top: "10%",
      left: 0,
      right: 0,
    },
    center: {
      position: "absolute",
      top: "50%",
      left: 0,
      right: 0,
      transform: "translateY(-50%)",
    },
    bottom: {
      position: "absolute",
      bottom: "10%",
      left: 0,
      right: 0,
    },
  };

  return {
    ...baseStyle,
    ...positionStyles[position],
  };
}

/**
 * Main Composition component for rendering animated captions
 *
 * - Accepts caption data with timing information
 * - Dynamically selects animation preset based on animationType prop
 * - Applies custom styling (font, colors, position)
 * - Renders the active caption at correct timestamps
 */
export const Composition: React.FC<CompositionProps> = ({
  captions,
  animationType,
  style,
}) => {
  const frame = useCurrentFrame();

  // Find the currently active caption based on frame number
  const currentCaption = captions.find(
    (caption) => frame >= caption.startFrame && frame < caption.endFrame,
  );

  // Get the animation component for the selected animation type
  const AnimationComponent = getAnimationComponent(animationType);

  // If no caption is active, render nothing
  if (!currentCaption) {
    return null;
  }

  // Calculate the frame position within the current caption
  const captionLocalFrame = frame - currentCaption.startFrame;
  const captionDurationInFrames =
    currentCaption.endFrame - currentCaption.startFrame;

  // Build the styled container
  const containerStyle = buildStyle(currentCaption, style);

  // Build animation-specific props
  const animationProps = {
    text: currentCaption.text,
    frame: captionLocalFrame,
    durationInFrames: captionDurationInFrames,
    style: containerStyle,
    ...(animationType === "smoothHighlight" && {
      highlightColor: style?.highlightColor,
    }),
  };

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        backgroundColor: "transparent",
      }}
    >
      <AnimationComponent {...(animationProps as AnimationComponentProps)} />
    </div>
  );
};
