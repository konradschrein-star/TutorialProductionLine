import { callGeminiPool } from "../../utils/gemini-pool-client.js";

/**
 * Heuristic match for "your prompt tripped a safety/content filter" type
 * errors from the lab clone. The lab clone surfaces the underlying Google
 * Veo / Imagen / Nano Banana rejection codes, and the most common ones are:
 *
 *   - RAI_FILTER / rai_filtered          (Google Responsible AI filter)
 *   - SAFETY_BLOCKED / safety_filter      (Imagen safety classifier)
 *   - BLOCKED_BY_CONTENT_POLICY / policy_violation
 *   - INPUT_BLOCKED                       (prompt itself flagged before gen)
 *
 * UNUSUAL_ACTIVITY is NOT a content-policy error (that's IP / session
 * detection) — must not get caught here, the rewriter can't help.
 */
export function isContentPolicyError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  if (msg.includes("unusual_activity")) return false;
  return (
    msg.includes("rai_filter") ||
    msg.includes("rai filter") ||
    msg.includes("safety_block") ||
    msg.includes("safety_filter") ||
    msg.includes("content_policy") ||
    msg.includes("policy_violation") ||
    msg.includes("input_blocked") ||
    msg.includes("blocked_by_") ||
    /\bsafety\b/.test(msg) ||
    /\bfiltered\b/.test(msg) ||
    /\bblocked\b/.test(msg)
  );
}

/**
 * Rewrite an image prompt so it stops tripping the safety/content filter
 * but still captures the same scene, emotion, and composition. Returns
 * the new prompt — caller should retry the image generation with it.
 *
 * Strategy: feed Gemini the original prompt + the error message and ask
 * it to identify which element was flagged and produce a cleaner version
 * that preserves narrative intent.
 */
export async function rewriteImagePromptForPolicy(
  originalPrompt: string,
  errorMessage: string,
): Promise<string> {
  const instruction = `You are rewriting a cinematic image-generation prompt that was REJECTED by an AI image generator's safety filter. Your job is to identify the most likely flagged element and produce a NEW prompt that:

1. Preserves the dramatic intent (emotion, scene, character framing, lighting, composition).
2. Removes the specific element that tripped the filter.
3. Stays cinematic and emotionally loaded — DO NOT genericize it.

Common flag causes (in order of frequency):
- Real-world weapons drawn or used
- Explicit blood / gore / wounds
- Sexual content or suggestive nudity
- Real public figures by name
- Children in distress
- Religious or hate-symbol imagery
- Anything that reads as graphic abuse / self-harm

Rewriting tactics that usually work:
- Replace "gun pointed at her head" with "an unseen threat just out of frame, her terrified face fills the shot"
- Replace blood with sweat, tears, or a dark stain implied off-camera
- Replace explicit injury with shadowed posture / hand pressed to side
- Replace named real people with role descriptions ("the senator", "the news anchor")
- Replace nudity / suggestive framing with covered, emotionally-loaded body language

ORIGINAL PROMPT:
${originalPrompt}

REJECTION ERROR:
${errorMessage}

Output ONLY the rewritten prompt as a single block of text. No preamble, no quotes, no markdown.`;

  const rewritten = (await callGeminiPool(instruction)).trim();
  // Strip the kind of leading "Rewritten prompt:" preamble Gemini sometimes
  // adds despite the instructions.
  return rewritten.replace(/^[A-Za-z ]{0,30}prompt:\s*/i, "").trim();
}
