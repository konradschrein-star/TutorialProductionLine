import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { RemotionSubtitleConfig } from "@repo/db";
import type { CaptionPlan } from "../types.js";
import {
  computeContainerPosition,
  pickActiveChunkIndex,
} from "./caption-styles.js";
import { CaptionChunk } from "./CaptionChunk.js";
import {
  SubtitleFontFaces,
  type SubtitleFontFace,
} from "./SubtitleFontFaces.js";

interface CaptionsProps {
  plan: CaptionPlan;
  config: RemotionSubtitleConfig;
  /**
   * Resolved custom/uploaded fonts to register for this render (spec §7d). When
   * present, an @font-face per weight is injected so `config.fontFamily` resolves
   * to the actual font file. Omit for system fonts.
   */
  fonts?: SubtitleFontFace[];
}

/**
 * The config-driven, SubMagic-style caption renderer. Picks the chunk visible
 * at the current frame and positions it per the config. This is the single
 * source of truth for the caption look — the live editor preview (@remotion/
 * player) and the video render both mount this exact component.
 *
 * Spec: docs/superpowers/specs/2026-07-26-global-subtitle-system-design.md §4.1
 *
 * Note on `config.videoBackgroundColor` (Task 9c): this component intentionally
 * does NOT paint that fill itself. <Captions> is always mounted as the LAST
 * sibling in every bake-in composition (after the video/scene layers), so it
 * can sit visually on top of the video for the caption text — but that same
 * ordering means anything this component painted full-frame would also sit on
 * top of, and hide, the video for the whole render. The fill is a
 * letterbox/pillarbox background (the color that shows through wherever the
 * video doesn't cover the canvas), which is only ever correct painted BEHIND
 * the video, i.e. at the root of the consuming composition. See
 * apps/worker-render/src/remotion/V2Composition.tsx (and the other
 * `subtitleConfig`-consuming compositions) for the actual wiring.
 */
export const Captions: React.FC<CaptionsProps> = ({ plan, config, fonts }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const time = frame / fps;

  const idx = pickActiveChunkIndex(plan, time);

  return (
    <>
      {/* Register resolved fonts unconditionally so the delayRender fires once at
          mount, independent of whether a caption is on-screen this frame. */}
      {fonts && fonts.length > 0 && <SubtitleFontFaces faces={fonts} />}
      {idx !== -1 && (
        <AbsoluteFill>
          <div style={computeContainerPosition(config)}>
            {/* key on idx restarts entrance animations cleanly per chunk change */}
            <CaptionChunk key={idx} chunk={plan[idx]} config={config} />
          </div>
        </AbsoluteFill>
      )}
    </>
  );
};
