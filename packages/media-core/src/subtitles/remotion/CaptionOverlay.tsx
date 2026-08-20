import React from "react";
import { AbsoluteFill } from "remotion";
import type { RemotionSubtitleConfig } from "@repo/db";
import type { CaptionPlan } from "../types.js";
import { Captions } from "./Captions.js";
import type { SubtitleFontFace } from "./SubtitleFontFaces.js";

interface CaptionOverlayProps {
  plan: CaptionPlan;
  config: RemotionSubtitleConfig;
  /** Resolved custom fonts to register for the overlay render (spec §7d). */
  fonts?: SubtitleFontFace[];
}

/**
 * A caption-only composition over a FULLY TRANSPARENT background — used by the
 * transparent overlay render pass (spec §4.3) for FFmpeg-base formats assigned
 * a Remotion preset. Composition duration is set by the caller via
 * durationInFrames; this component just renders <Captions>.
 *
 * `config.videoBackgroundColor` (Task 9c letterbox/pillarbox fill) is
 * DELIBERATELY NOT rendered here. This composition is rendered standalone to a
 * VP9-alpha webm (see apps/worker-render/src/workflows/caption-overlay-pass.ts)
 * and then ffmpeg-composited on top of the ALREADY-RENDERED base video via
 * `overlay=0:0`. ffmpeg's overlay filter has no concept of "only paint where
 * the base video doesn't already have content" — any opaque pixel painted here
 * unconditionally replaces the base video's pixel underneath, for the entire
 * clip duration. A full-frame fill in this composition would therefore hide
 * 100% of the base video, not just its letterboxed margins. The base video fed
 * into this pass is also already rendered at the target canvas size, so there
 * is no letterbox gap for this composition to fill in the first place. The
 * correct (and actually safe) insertion point is the root AbsoluteFill of each
 * bake-in Remotion composition (e.g. V2Composition, ExplainerComposition),
 * which already paints its own background BEFORE the video layers — see the
 * `backgroundColor: subtitleConfig?.videoBackgroundColor ?? <default>` wiring
 * there.
 */
export const CaptionOverlay: React.FC<CaptionOverlayProps> = ({
  plan,
  config,
  fonts,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      <Captions plan={plan} config={config} fonts={fonts} />
    </AbsoluteFill>
  );
};
