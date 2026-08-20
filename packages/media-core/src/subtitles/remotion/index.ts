// ===========================================================================
// @repo/media-core/subtitles/remotion — the shared Remotion <Captions> renderer
// for the Global Subtitle System. Exported ONLY from this dedicated subpath so
// the main media-core entry stays React-free (non-React consumers never pull in
// react/remotion). Import via "@repo/media-core/subtitles/remotion".
//
// Spec: docs/superpowers/specs/2026-07-26-global-subtitle-system-design.md §4.1
// ===========================================================================

// Segmentation brain + types — pure (chunker/keyword-selector), browser-safe,
// and re-exported here so browser clients (the live editor preview) can build a
// CaptionPlan WITHOUT importing the node-heavy main "@repo/media-core" barrel.
export { buildCaptionPlan } from "../plan.js";
export type { WordTimestamp, CaptionPlan } from "../types.js";

// Components
export { Captions } from "./Captions.js";
export { CaptionOverlay } from "./CaptionOverlay.js";
export { CaptionChunk } from "./CaptionChunk.js";
export { CaptionWord } from "./CaptionWord.js";
export { SpeakerHeading } from "./SpeakerHeading.js";
export { SubtitleFontFaces } from "./SubtitleFontFaces.js";
export type { SubtitleFontFace } from "./SubtitleFontFaces.js";

// Pure, framework-free style helpers (unit-tested; safe for non-React callers).
export {
  computeShadowLayers,
  computeWordStyle,
  computeWordVariance,
  computeContainerPosition,
  computeSafeMaxWidthPercent,
  computeBackgroundStyle,
  computeCanvasScale,
  pickActiveChunkIndex,
  SHADOW_LAYER_COUNT,
  DESIGN_HEIGHT,
} from "./caption-styles.js";

// The documented, exhaustive list of ways the ASS engine cannot match this one.
// Surfaced in the preset editor so a difference is never silent.
export { ENGINE_PARITY_NOTES } from "../ass/ass-builder.js";

// Shared geometry/timing rules — identical numbers drive the ASS engine.
export {
  computeVerticalPlacement,
  activeWordIndex,
  activeWordRanges,
  MIN_CUE_SECONDS,
  MAX_CHARS_PER_LINE,
} from "../layout.js";
