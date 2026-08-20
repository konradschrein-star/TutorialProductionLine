import { requestLLMText } from "../llm-client.js";
import {
  modeForMinutes,
  stepCountAdvice,
  type LengthAdvice,
  type TutorialLengthMode,
} from "@repo/domain";

/**
 * How long does THIS topic actually deserve?
 *
 * ## Why this exists
 *
 * The owner's framing: "keywords requiring 6 min (when stretching a bit) get 6
 * min videos but keywords requiring a 2-3 min solution get a 2-3, maybe 4 min
 * video so we don't waste the viewer's time."
 *
 * Both failure modes are real and they are opposites:
 *
 *   - Pick 6 minutes for a two-step task and the script pads, or the model
 *     obeys the floor by inventing filler nobody needed.
 *   - Pick 3 minutes for a twelve-step workflow with three gotchas and the
 *     script becomes a list of clicks — every step named, none explained.
 *     That is the "195-word script" this codebase has already shipped once.
 *
 * The length rule can only honour the number it is given. Choosing that number
 * well is a separate judgement, and until now it was made by a VA guessing from
 * a dropdown before they had written anything.
 *
 * ## Why it is ADVICE and not automation
 *
 * It returns a recommendation for a human to accept or ignore. The VA owns the
 * gate on this lane by design, they can see the steps and the keyword intent
 * better than a heuristic can, and a wrong auto-choice is expensive (a whole
 * script, TTS pass and screen recording). A recommendation they can overrule
 * costs nothing when it is wrong.
 *
 * ## Why it never guesses silently
 *
 * If the model cannot be reached, this returns `null` rather than a number
 * dressed up as a judgement. The UI then shows nothing instead of a confident
 * recommendation nobody made — the same rule the upload sheet follows.
 */

function buildPrompt(title: string, stepsInput: string): string {
  return [
    "You are deciding how long a screen-recorded software tutorial should be.",
    "",
    `Title: ${title}`,
    "",
    "Steps the operator listed:",
    stepsInput.slice(0, 3000),
    "",
    "Judge how many minutes of SPOKEN narration this topic genuinely supports if",
    "every step is performed on screen, each one explains what appears afterwards,",
    "and the one thing that commonly goes wrong at each step is named.",
    "",
    "Rules for your judgement:",
    "- Count only real information. Do not count an intro, an outro, a recap, or",
    "  general advice that is not performed on screen.",
    "- A task with few steps and no traps is genuinely short. Saying so is the",
    "  correct answer, not a failure — a padded six minutes wastes the viewer.",
    "- A task with many steps, or with settings that are easy to get wrong, needs",
    "  the longer runtime to be taught rather than merely listed.",
    "- Assume roughly 150 spoken words per minute.",
    "",
    'Answer with ONLY a JSON object: {"minutes": <number>, "reason": "<one sentence>"}',
  ].join("\n");
}

export function parseLengthAdvice(raw: string): {
  minutes: number;
  reason: string;
} | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      minutes?: unknown;
      reason?: unknown;
    };
    const minutes = Number(parsed.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 60) return null;
    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim() !== ""
        ? parsed.reason.trim()
        : "No reason given.";
    return { minutes, reason };
  } catch {
    return null;
  }
}

export async function adviseTutorialLength(args: {
  title: string;
  stepsInput: string;
}): Promise<LengthAdvice | null> {
  const { title, stepsInput } = args;
  if (!title.trim() && !stepsInput.trim()) return null;

  try {
    const raw = await requestLLMText(buildPrompt(title, stepsInput), {
      tier: "standard",
      maxTokens: 400,
      timeoutMs: 60_000,
      context: "tutorial:length-advice",
    });
    const parsed = parseLengthAdvice(raw);
    if (!parsed) return stepCountAdvice(stepsInput);
    return {
      mode: modeForMinutes(parsed.minutes),
      estimatedMinutes: Math.round(parsed.minutes * 10) / 10,
      reason: parsed.reason,
      source: "model",
    };
  } catch {
    // The step count is a real signal, not an invented one, and it is labelled
    // as such. Returning it beats returning nothing when the operator has
    // already told us how many actions there are.
    return stepsInput.trim() ? stepCountAdvice(stepsInput) : null;
  }
}
