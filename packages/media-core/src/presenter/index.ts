/**
 * BUSINESS_PLAN_HUB presenter compositor — browserless alpha overlay track.
 *
 * Sub-barrel for `packages/media-core/src/presenter/**`. The package barrel
 * (`src/index.ts`) is owned by task R4; re-export from here rather than
 * duplicating the export list.
 */

export {
  requireCalibratedPose,
  computePoseScale,
  resolvePresenterLayout,
} from "./pose-normalise.js";
export type {
  PresenterSide,
  PresenterPlacement,
  PoseScale,
  PresenterLayout,
} from "./pose-normalise.js";

export { themeHeadMarkSvg } from "./head-mark-theme.js";
export type { HeadMarkTheme } from "./head-mark-theme.js";

export {
  buildPresenterTrack,
  buildHeadScaleSteps,
  quantiseEnvelopeToSteps,
  headStepFileName,
  buildHeadStepArgs,
  buildConcatListText,
  buildPresenterTrackArgs,
  DEFAULT_HEAD_SCALE_RANGE,
  DEFAULT_HEAD_SCALE_STEPS,
} from "./presenter-track.js";
export type {
  HeadScaleRange,
  HeadMarkSource,
  SvgRasteriser,
  PresenterTrackParams,
  PresenterTrackResult,
} from "./presenter-track.js";
