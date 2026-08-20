/**
 * Pure render routing decision engine.
 *
 * Decides whether a job should be rendered via the lightweight FFmpeg path
 * or the heavyweight Remotion path based on composition features and
 * optional template-level overrides.
 *
 * ZERO IO — pure function only.
 */

export interface RenderRoutingInput {
  captionsEnabled: boolean;
  hasAvatarFootage: boolean;
  hasPictureInPicture: boolean;
  hasNewsTicker: boolean;
  hasAnimatedTransitions: boolean;
  sceneCount: number;
  templateEngineOverride: "FFMPEG" | "REMOTION" | undefined;
}

export type RenderEngine = "FFMPEG" | "REMOTION";

/**
 * Decide which render engine to use for a given job.
 *
 * Priority:
 * 1. Template override takes absolute precedence.
 * 2. If any complex composition feature is enabled -> REMOTION.
 * 3. Default -> FFMPEG (lightweight path).
 */
export function decideRenderEngine(input: RenderRoutingInput): RenderEngine {
  // 1. Template override takes absolute precedence
  if (input.templateEngineOverride !== undefined) {
    return input.templateEngineOverride;
  }

  // 2. Complex composition features require Remotion
  if (
    input.captionsEnabled ||
    input.hasPictureInPicture ||
    input.hasNewsTicker ||
    input.hasAnimatedTransitions
  ) {
    return "REMOTION";
  }

  // 3. Default — lightweight FFmpeg path
  return "FFMPEG";
}
