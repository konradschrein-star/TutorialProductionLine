// Pure mapping helpers for the live @remotion/player preview. Kept framework-free
// and unit-tested so the LivePreview client component stays a thin shell.

import type { CaptionPlan } from "@repo/media-core/subtitles/remotion";

export type PreviewAspect = "9:16" | "16:9" | "1:1";

export interface Dimensions {
  width: number;
  height: number;
}

/** Composition pixel dimensions for a given aspect ratio (1080-based). */
export function aspectToDimensions(aspect: PreviewAspect): Dimensions {
  switch (aspect) {
    case "9:16":
      return { width: 1080, height: 1920 };
    case "16:9":
      return { width: 1920, height: 1080 };
    case "1:1":
      return { width: 1080, height: 1080 };
    default: {
      const _exhaustive: never = aspect;
      return { width: 1080, height: 1920 };
    }
  }
}

/**
 * durationInFrames for a NON-looping preview composition — the last chunk's end
 * time (seconds) rounded up to a whole frame, plus a 0.5s tail so the final
 * caption lingers. Always >= 1 (Remotion requires a positive duration).
 *
 * Do NOT use this for a looping @remotion/player: the 0.5s tail is dead air with
 * no caption on screen, and because every card mounts in lockstep the whole grid
 * blinks black together at the end of every loop. Use loopDurationInFrames.
 */
export function planDurationInFrames(plan: CaptionPlan, fps: number): number {
  if (!plan.length) return Math.max(1, Math.round(fps));
  const lastEnd = plan[plan.length - 1].end;
  const tailSeconds = 0.5;
  return Math.max(1, Math.ceil((lastEnd + tailSeconds) * fps));
}

/**
 * durationInFrames for a LOOPING preview composition: exactly the caption span,
 * with NO trailing tail. A tail and a loop are incompatible — the tail is a gap
 * with nothing on screen, which reads as "the preview died" (the reported bug).
 *
 * Pair with shiftPlanToStart() so the plan also has no LEADING gap; together
 * they remove the ~0.7s of dead air per loop that made every card blank.
 *
 * Throws on an empty plan: a caption card with no captions is a real defect, not
 * a 1-frame composition to be silently clamped.
 */
export function loopDurationInFrames(plan: CaptionPlan, fps: number): number {
  if (!plan.length) {
    throw new Error(
      "loopDurationInFrames: empty caption plan — a looping preview with no captions is a defect (check buildCaptionPlan / the sample phrase).",
    );
  }
  const lastEnd = plan[plan.length - 1].end;
  return Math.max(1, Math.ceil(lastEnd * fps));
}

/**
 * Shift every timing in the plan so the first chunk starts at t=0, removing the
 * leading pre-roll gap (the sample phrases start their first word at 0.2s). New
 * objects are returned; the input is not mutated. chunk/word start+end and the
 * per-line word copies are all shifted by the same delta so active-word and
 * entrance-animation timing stay consistent with the chunk timing.
 */
export function shiftPlanToStart(plan: CaptionPlan): CaptionPlan {
  if (!plan.length) return plan;
  const delta = plan[0].start;
  if (delta <= 0) return plan;
  const shiftWord = <W extends { start: number; end: number }>(w: W): W => ({
    ...w,
    start: w.start - delta,
    end: w.end - delta,
  });
  return plan.map((chunk) => ({
    ...chunk,
    start: chunk.start - delta,
    end: chunk.end - delta,
    words: chunk.words.map(shiftWord),
    lines: chunk.lines.map((line) => line.map(shiftWord)),
  }));
}
