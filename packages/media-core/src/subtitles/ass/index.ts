// ===========================================================================
// @repo/media-core/subtitles/ass — the minimal "fast/ugly" ASS caption engine.
// Node-side only (writes plain strings). Pairs with the segmentation brain
// (chunkWords / buildCaptionPlan) and a v2 FFmpegSubtitleConfig.
//
// Spec: docs/superpowers/specs/2026-07-26-global-subtitle-system-design.md §6
// ===========================================================================

export {
  buildAssFromPlan,
  hexToAss,
  assAlignment,
  escapeAssText,
  formatTime,
  ENGINE_PARITY_NOTES,
} from "./ass-builder.js";
export type { BuildAssOptions } from "./ass-builder.js";
