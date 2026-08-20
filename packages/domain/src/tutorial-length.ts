/**
 * How long should a tutorial be?
 *
 * ## Why this is a domain rule and not a UI detail
 *
 * The owner: "in most cases the VAs have no idea how long a video should be."
 * That is not a training gap. It is a judgement that needs the topic in front
 * of you, and the VA is asked to make it from a dropdown BEFORE they have
 * written anything.
 *
 * Getting it wrong is expensive in both directions, and the two failures look
 * nothing alike:
 *
 *   - Six minutes for a two-step task pads, or strains to reach its floor. The
 *     viewer's time is spent on nothing.
 *   - Three minutes for a twelve-step workflow with three traps produces a list
 *     of clicks — every step named, none explained. This codebase has already
 *     shipped that once, at 195 words.
 *
 * The owner's target: "keywords requiring 6 min (when stretching a bit) get 6
 * min videos but keywords requiring a 2-3 min solution get a 2-3, maybe 4 min
 * video so we don't waste the viewer's time."
 *
 * ## Why it lives here
 *
 * Both the worker (which can afford an LLM judgement) and hub-web (which cannot
 * — it has no LLM client and must answer as the VA types) need the same rule.
 * Apps must not import from each other, so the shared, dependency-free part
 * lives in the domain and each side uses what it can reach.
 *
 * Everything in this file is pure.
 */

export type TutorialLengthMode = "THREE_MIN" | "SIX_MIN";

export interface LengthAdvice {
  mode: TutorialLengthMode;
  /** Minutes the topic appears to support, before snapping to a mode. */
  estimatedMinutes: number;
  /** One sentence a VA can agree or disagree with. */
  reason: string;
  /**
   * Where the number came from. Surfaced so the UI can say "counted your steps"
   * rather than passing a line count off as editorial judgement.
   */
  source: "model" | "step-count";
}

/**
 * Below this, six minutes would need roughly a quarter of its runtime padded to
 * reach its floor — which is the thing we are trying to avoid, so the shorter
 * mode wins.
 */
const SIX_MIN_THRESHOLD_MINUTES = 4.5;

/** Snap a free judgement onto the two modes the product actually offers. */
export function modeForMinutes(minutes: number): TutorialLengthMode {
  return minutes >= SIX_MIN_THRESHOLD_MINUTES ? "SIX_MIN" : "THREE_MIN";
}

/** Distinct actions the operator actually listed. Blank/stub lines do not count. */
export function countSteps(stepsInput: string): number {
  return stepsInput
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[-*\d.)\s]+/, ""))
    .filter((l) => l.length > 3).length;
}

/**
 * Advice from the step list alone — no network, no model, instant.
 *
 * This is a real signal, not a stand-in for a failed call: the operator has
 * literally told us how many on-screen actions there are. It is labelled
 * `step-count` so nothing downstream can present it as more than that.
 *
 * Eight is deliberately generous. A tutorial earns six minutes by having enough
 * distinct actions to explain without repeating, and most software tasks do not.
 */
export function stepCountAdvice(stepsInput: string): LengthAdvice {
  const steps = countSteps(stepsInput);
  if (steps >= 8) {
    return {
      mode: "SIX_MIN",
      estimatedMinutes: 6,
      reason: `${steps} distinct steps — enough on-screen actions to teach properly at six minutes.`,
      source: "step-count",
    };
  }
  return {
    mode: "THREE_MIN",
    estimatedMinutes: 3,
    reason:
      steps === 0
        ? "No steps listed yet — start with the shorter mode and lengthen if the topic earns it."
        : `${steps} step${steps === 1 ? "" : "s"} — a short, complete answer beats stretching it.`,
    source: "step-count",
  };
}

/** Human label for a mode, for UI that should not print an enum at a VA. */
export function labelForMode(mode: TutorialMode): string {
  switch (mode) {
    case "SIX_MIN":
      return "6-Minute Tutorial";
    case "SIX_MIN_STITCH":
      return "Long-Form Stitch (6-Min segments)";
    case "LONG_FORM":
      return "Long-form (40+ min, stitched)";
    case "THREE_MIN":
      return "3-Minute Tutorial";
    default: {
      const never: never = mode;
      return never;
    }
  }
}

/* ------------------------------------------------------------------------- */
/* The keyword already knows the length                                       */
/* ------------------------------------------------------------------------- */

/**
 * ## Why the step count is not allowed to be the only voice
 *
 * The owner, watching a VA pick a keyword: "the three minute tutorial is auto
 * selected even though we just selected a 10 to 20 minute video which if I
 * search this up on youtube has had the original length of 13 minutes. Knowing
 * that number in our keyword tool we should definitely not select for a three
 * minute video to be automatically generated."
 *
 * He is right, and the reason is that the two signals are not the same kind of
 * thing. `stepCountAdvice` reads lines out of a textarea the VA has often not
 * filled in yet. The Keyword Tool's `length_class` / `duration_sec` are measured
 * off the REFERENCE VIDEO that is already ranking for this search — the runtime
 * the market has already rewarded. That is evidence; a line count is a guess.
 *
 * So the keyword's bucket is a HARD BOUND, not a hint: whatever else we know,
 * the plan is clamped inside it. A `10-20min` keyword can no longer come out of
 * this function as a three-minute script no matter how few steps were typed.
 *
 * ## Why no new tutorial_mode enum values
 *
 * KT has nine buckets and the pipeline has four modes, so the obvious move is to
 * add enum values. It is the wrong move: `tutorial_mode` is a Postgres enum whose
 * values are ALSO `tutorial_prompt_category` values, and prod carries exactly one
 * prompt preset for each of SIX_MIN / SIX_MIN_STITCH / LONG_FORM. A new enum
 * value with no preset behind it makes the Create form's preset picker empty and
 * the worker throw "No prompt found" — and the worker's `targetMinutesForMode`
 * would still have no arm for it.
 *
 * The modes are not really "3 / 6 / stitch / long" anyway; they are FOUR SCRIPT
 * SHAPES (one short take, one long take, one script split at ~900 words, an
 * outline expanded chapter by chapter). Every KT bucket maps onto one of those
 * shapes plus a number, and `target_minutes` is that number — already in the
 * schema, already honoured by SIX_MIN_STITCH and LONG_FORM. So the buckets are
 * served by shape + minutes, with no migration and no unwritten prompts.
 */

/** Every mode the tutorial pipeline can actually run. */
export type TutorialMode =
  | "THREE_MIN"
  | "SIX_MIN"
  | "SIX_MIN_STITCH"
  | "LONG_FORM";

export interface LengthBucket {
  /** The Keyword Tool's own label, e.g. "10-20min". */
  label: string;
  minMinutes: number;
  /** null for the open-ended top bucket. */
  maxMinutes: number | null;
}

/**
 * KT's buckets, copied from `length_class()` in the Keyword Tool's
 * `backend/sniper/logic/production_filter.py`. Verified against prod: every
 * bucket's observed `duration_sec` range sits exactly inside these bounds.
 */
const KT_BUCKETS: Record<string, { min: number; max: number | null }> = {
  SHORT: { min: 0, max: 1 },
  "<3MIN": { min: 1, max: 3 },
  "3-6MIN": { min: 3, max: 6 },
  "6-10MIN": { min: 6, max: 10 },
  "10-20MIN": { min: 10, max: 20 },
  "20-40MIN": { min: 20, max: 40 },
  "40-60MIN": { min: 40, max: 60 },
  "1-2HR": { min: 60, max: 120 },
  "2HR+": { min: 120, max: null },
};

/** Spoken narration rate the whole tutorial pipeline assumes. */
export const SPOKEN_WORDS_PER_MINUTE = 150;

/** LONG_FORM's per-chapter length. Matches the worker's own default. */
export const LONG_FORM_PART_MINUTES = 8;

/**
 * A VA records the screen for every minute of this. Two hours is already an
 * extraordinary ask; past that the number stops meaning anything, so it is
 * capped — and the cap is SAID, in `reason`, never applied quietly.
 */
export const MAX_TARGET_MINUTES = 120;

/** Below this the shorter fixed mode wins — see SIX_MIN_THRESHOLD_MINUTES. */
const SIX_MIN_FLOOR = SIX_MIN_THRESHOLD_MINUTES;

/**
 * Above this a single take stops being credible: 6.5 minutes is the point where
 * SIX_MIN would have to overrun its own fixed length rather than hit it.
 */
const STITCH_FLOOR = 6.5;

/** Where the chapter-by-chapter shape starts beating one long script. */
const LONG_FORM_FLOOR = 20;

/** The minimum transcript worth reading a length off. Matches the worker. */
const MIN_TRANSCRIPT_WORDS = 80;

/** Parse a KT `length_class` label. Returns null for an unknown/empty label. */
export function parseLengthBucket(
  lengthClass: string | null | undefined,
): LengthBucket | null {
  const key = (lengthClass ?? "").trim().toUpperCase();
  if (!key) return null;
  const found = KT_BUCKETS[key];
  if (!found) return null;
  return {
    label: (lengthClass ?? "").trim(),
    minMinutes: found.min,
    maxMinutes: found.max,
  };
}

export interface TutorialLengthPlan {
  mode: TutorialMode;
  /**
   * What to send as `target_minutes`. null for THREE_MIN and SIX_MIN, whose
   * length is fixed in the worker and which IGNORE the field — see
   * `targetMinutesForMode` in the orchestrator's `script-prompt.ts`.
   */
  targetMinutes: number | null;
  /** What to send as `part_length_minutes`. LONG_FORM only. */
  partLengthMinutes: number | null;
  /** Minutes the evidence points at, before snapping to a mode. */
  estimatedMinutes: number;
  /** Which evidence won. */
  source: "keyword" | "transcript" | "step-count";
  /** The keyword bucket the plan is pinned inside, when one is known. */
  bucket: LengthBucket | null;
  /** One sentence a VA can agree or disagree with. */
  reason: string;
}

/** Snap a number of minutes onto a script SHAPE plus its explicit length. */
export function planForMinutes(
  minutes: number,
): Pick<
  TutorialLengthPlan,
  "mode" | "targetMinutes" | "partLengthMinutes" | "estimatedMinutes"
> {
  const m = Math.min(Math.max(minutes, 0), MAX_TARGET_MINUTES);
  if (m < SIX_MIN_FLOOR) {
    return {
      mode: "THREE_MIN",
      targetMinutes: null,
      partLengthMinutes: null,
      estimatedMinutes: m,
    };
  }
  if (m < STITCH_FLOOR) {
    return {
      mode: "SIX_MIN",
      targetMinutes: null,
      partLengthMinutes: null,
      estimatedMinutes: m,
    };
  }
  if (m < LONG_FORM_FLOOR) {
    return {
      mode: "SIX_MIN_STITCH",
      targetMinutes: Math.round(m),
      partLengthMinutes: null,
      estimatedMinutes: m,
    };
  }
  return {
    mode: "LONG_FORM",
    targetMinutes: Math.round(m),
    partLengthMinutes: LONG_FORM_PART_MINUTES,
    estimatedMinutes: m,
  };
}

function formatMinutes(m: number): string {
  const rounded = Math.round(m * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} min`;
}

export interface LengthEvidence {
  /** KT `length_class` for the claimed keyword. */
  lengthClass?: string | null;
  /** KT `duration_sec` — the reference video's exact runtime. */
  durationSec?: number | null;
  /** Word count of a transcript that has actually been fetched. */
  transcriptWordCount?: number | null;
  /** The steps textarea, as typed. */
  stepsInput?: string | null;
}

/**
 * The one length judgement the Create form makes, from whatever is known.
 *
 * Priority is by how directly the evidence measures the thing:
 *   1. the reference video's exact runtime (`duration_sec`)
 *   2. a transcript that has really been fetched, at 150 wpm
 *   3. the keyword's bucket alone, when KT stored no exact duration
 *   4. the steps the VA typed
 *
 * and whichever wins is then CLAMPED into the keyword's bucket, so the result
 * can never contradict it. Returns null when nothing is known — the UI then
 * shows no advice rather than a recommendation nobody made.
 */
export function tutorialLengthPlan(
  evidence: LengthEvidence,
): TutorialLengthPlan | null {
  const bucket = parseLengthBucket(evidence.lengthClass);
  const durationSec = evidence.durationSec ?? 0;
  const words = evidence.transcriptWordCount ?? 0;
  const steps = (evidence.stepsInput ?? "").trim();

  let minutes: number;
  let source: TutorialLengthPlan["source"];
  let basis: string;

  if (durationSec > 0) {
    minutes = durationSec / 60;
    source = "keyword";
    basis = `the reference video runs ${formatMinutes(minutes)}`;
  } else if (words >= MIN_TRANSCRIPT_WORDS) {
    minutes = words / SPOKEN_WORDS_PER_MINUTE;
    source = "transcript";
    basis = `the fetched transcript is ${words} words (~${formatMinutes(minutes)} spoken)`;
  } else if (bucket) {
    minutes =
      bucket.maxMinutes === null
        ? bucket.minMinutes
        : (bucket.minMinutes + bucket.maxMinutes) / 2;
    source = "keyword";
    basis = `the keyword is a ${bucket.label} video`;
  } else if (steps) {
    const advice = stepCountAdvice(steps);
    minutes = advice.estimatedMinutes;
    source = "step-count";
    basis = advice.reason.replace(/\.$/, "");
  } else {
    return null;
  }

  const clampedRaw = bucket
    ? Math.min(
        Math.max(minutes, bucket.minMinutes),
        bucket.maxMinutes ?? Number.POSITIVE_INFINITY,
      )
    : minutes;
  const wasClamped = bucket !== null && Math.abs(clampedRaw - minutes) > 0.05;

  const snapped = planForMinutes(clampedRaw);
  const capped = clampedRaw > MAX_TARGET_MINUTES;

  const parts = [basis];
  if (wasClamped) {
    parts.push(
      `held to the keyword's ${bucket!.label} bucket — a ${bucket!.label} keyword does not get a shorter script`,
    );
  }
  if (capped) {
    parts.push(
      `capped at ${MAX_TARGET_MINUTES} min, the longest a VA is asked to record`,
    );
  }

  return {
    ...snapped,
    source,
    bucket,
    reason: `${parts.join("; ")}.`,
  };
}
