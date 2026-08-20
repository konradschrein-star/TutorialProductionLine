/**
 * Render Engine Detection
 *
 * Pure functions to determine which render engine (FFmpeg or Remotion)
 * will be used for a given job configuration.
 *
 * Uses same logic as decideRenderEngine from render-routing.ts but
 * returns boolean for simpler UI usage.
 */

export interface RenderEngineInput {
  templateEngineOverride: "FFMPEG" | "REMOTION" | undefined;
  captionsEnabled: boolean;
  hasPictureInPicture: boolean;
  hasNewsTicker: boolean;
  hasAnimatedTransitions: boolean;
}

/**
 * Determine if a job will use Remotion renderer based on features and template config.
 *
 * Priority:
 * 1. Template override takes absolute precedence
 * 2. If any complex composition feature is enabled -> Remotion
 * 3. Default -> FFmpeg
 *
 * @param input - Job render configuration
 * @returns true if Remotion will be used, false if FFmpeg
 */
export function willUseRemotionRenderer(input: RenderEngineInput): boolean {
  // 1. Template override takes absolute precedence
  if (input.templateEngineOverride === "REMOTION") {
    return true;
  }
  if (input.templateEngineOverride === "FFMPEG") {
    return false;
  }

  // 2. Complex composition features require Remotion
  if (
    input.captionsEnabled ||
    input.hasPictureInPicture ||
    input.hasNewsTicker ||
    input.hasAnimatedTransitions
  ) {
    return true;
  }

  // 3. Default — FFmpeg path
  return false;
}
