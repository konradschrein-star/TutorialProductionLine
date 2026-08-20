"use client";
// ---------------------------------------------------------------------------
// The one place hub-web mounts the real Remotion <CaptionOverlay> in a
// @remotion/player. Both the library-grid card preview and the editor live
// preview go through here so they can never drift.
//
// Wrapped in an error boundary that renders the ACTUAL error text. Previously a
// throw inside the composition (see the `remotion` duplicate-instance bug fixed
// by the resolve alias in next.config.js) unmounted the subtree and left a
// blank rectangle with no clue why — the project rule is an explicit error
// state, never a silent blank.
// ---------------------------------------------------------------------------

import React from "react";
import dynamic from "next/dynamic";
import { CaptionOverlay } from "@repo/media-core/subtitles/remotion";
import type { CaptionPlan } from "@repo/media-core/subtitles/remotion";

const Player = dynamic(() => import("@remotion/player").then((m) => m.Player), {
  ssr: false,
});

interface BoundaryProps {
  children: React.ReactNode;
  /** Rendered with the error message when the composition throws. */
  fallback: (message: string) => React.ReactNode;
}

class PreviewErrorBoundary extends React.Component<
  BoundaryProps,
  { message: string | null }
> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { message: null };
  }

  static getDerivedStateFromError(error: unknown) {
    return {
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidUpdate(prev: BoundaryProps) {
    // A config edit that fixes the problem should clear the error state.
    if (prev.children !== this.props.children && this.state.message) {
      this.setState({ message: null });
    }
  }

  render() {
    if (this.state.message !== null) {
      return this.props.fallback(this.state.message);
    }
    return this.props.children;
  }
}

export function PreviewError({
  message,
  compact,
}: {
  message: string;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: compact ? 10 : 24,
        textAlign: "center",
        width: "100%",
        height: "100%",
      }}
    >
      <span
        className="material-symbols-outlined"
        style={{ fontSize: compact ? 18 : 24, color: "#ff8a8a" }}
      >
        error
      </span>
      <span
        style={{
          fontSize: compact ? 10 : 12,
          color: "#ff8a8a",
          lineHeight: 1.35,
          wordBreak: "break-word",
        }}
      >
        {compact ? "Preview failed" : "Preview failed"}
      </span>
      <span
        style={{
          fontSize: compact ? 9 : 11,
          color: "#cdc3d7",
          lineHeight: 1.35,
          wordBreak: "break-word",
          maxWidth: 420,
        }}
      >
        {message}
      </span>
    </div>
  );
}

export function CaptionPlayer({
  plan,
  config,
  width,
  height,
  fps,
  durationInFrames,
  controls,
  compactError,
  style,
  initialFrame,
}: {
  plan: CaptionPlan;
  config: unknown;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  controls?: boolean;
  compactError?: boolean;
  style?: React.CSSProperties;
  /**
   * Starting frame for the loop. Used to de-synchronise a grid of cards so they
   * do not all animate (or, in a residual gap, blank) in lockstep.
   */
  initialFrame?: number;
}) {
  const inputProps = React.useMemo(
    () => ({ plan, config }) as unknown as Record<string, unknown>,
    [plan, config],
  );

  return (
    <PreviewErrorBoundary
      fallback={(message) => (
        <PreviewError message={message} compact={compactError} />
      )}
    >
      <Player
        // next/dynamic erases <Player>'s generic, so the component prop narrows
        // to Record<string, unknown>. The props are validated upstream by
        // buildCaptionPlan / the zod config schema.
        component={
          CaptionOverlay as unknown as React.ComponentType<
            Record<string, unknown>
          >
        }
        inputProps={inputProps}
        durationInFrames={durationInFrames}
        fps={fps}
        compositionWidth={width}
        compositionHeight={height}
        style={style}
        controls={controls}
        initialFrame={
          initialFrame && Number.isFinite(initialFrame)
            ? Math.max(0, Math.floor(initialFrame % durationInFrames))
            : undefined
        }
        // Clears the "remotion licence" console warning so the console stays
        // clean and the next real regression is visible. This is an internal
        // authoring tool, not a distributed product.
        acknowledgeRemotionLicense
        loop
        autoPlay
      />
    </PreviewErrorBoundary>
  );
}
