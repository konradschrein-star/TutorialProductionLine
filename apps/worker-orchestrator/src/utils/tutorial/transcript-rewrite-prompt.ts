import {
  buildSharedRuleStack,
  buildLengthLine,
  buildVaInstructionsBlock,
  tierForMinutes,
  TTS_OUTPUT_RULE,
  type ScriptTier,
} from "./script-prompt.js";

/**
 * What "better than the source" actually MEANS.
 *
 * The old rewrite instructions said "IMPROVE on it, don't just paraphrase" and
 * left the model to decide what improvement was — so it improved the prose and
 * kept the substance, which is a paraphrase with a new voice. That is the worst
 * possible outcome: it inherits the source's gaps AND risks reading as derived.
 *
 * These five axes are deliberately CHECKABLE against the transcript we now fetch
 * automatically (step count, presence of verification lines, presence of
 * failure-mode coverage, ordering, and n-gram overlap), so "better" stops being
 * a vibe and starts being something a reviewer — or a later QA pass — can score.
 */
export const SOURCE_UPGRADE_RULE = [
  "WHAT 'BETTER THAN THE SOURCE' MEANS — you must beat the source transcript on all five of",
  "these. They are specific and checkable; do not settle for nicer wording.",
  "  1. COMPLETENESS. Every step the source actually performs must appear in yours — plus the",
  "     ones it skipped or assumed: where the setting lives, what has to be true before you",
  "     start (account, plan, permission, version), and any step it jumped over. If the source",
  "     goes straight from one action to a screen the viewer cannot have reached yet, fill the",
  "     gap in.",
  "  2. CURRENT UI. The source may be old. Use the CURRENT names of buttons, menus, tabs and",
  "     settings. Where a name has changed, use the new one and mention the old one once so",
  "     someone on an older version can still follow along.",
  "  3. VERIFICATION. After each step, say what the viewer should SEE if it worked. The source",
  "     almost certainly never does this, and it is the single biggest reason people give up.",
  "  4. TROUBLESHOOTING. Cover the two or three places this genuinely goes wrong and what to do",
  "     about each — attached to the step where it bites, not collected at the end.",
  "  5. ORDERING. Prerequisites first, then the shortest correct path, then the variants and",
  "     the alternative route. Never inherit an order that makes the viewer backtrack.",
  "If you cannot beat the source on an axis because the source already did it well, go further",
  "on that axis rather than matching it.",
  "DO NOT INHERIT THE SOURCE'S FORMAT. The source almost certainly has a presenter, a talky",
  "intro, a channel plug and an outro. Ours has none of those — see THE FORMAT below. Take the",
  "PROCEDURE from the source and throw its intro, its outro, its greetings, its promises and",
  "every second of its non-screen talk straight in the bin.",
].join("\n");

/**
 * Legal + ranking distinctness. The output has to be OUR work, not a laundered
 * copy: the whole reason for rewriting a competitor's video is to outrank it,
 * and a near-duplicate hands the ranking straight back.
 */
export const NOT_A_PARAPHRASE_RULE = [
  "NOT A PARAPHRASE — this is a hard requirement, not a style note. The finished script must",
  "be your own work and must read as a clearly different video from the source.",
  "- Never reuse a run of more than four consecutive words from the transcript. The ONLY",
  "  exceptions are things that must stay exact to be usable: product names, button and menu",
  "  labels, file names, and settings paths.",
  "- Do not mirror its sentence shapes, its transitions, its jokes, or its analogies. Write",
  "  every explanation from scratch as if you had never seen it.",
  "- Use your own examples and your own numbers. If the source demonstrates on one file, name,",
  "  or scenario, use a different one.",
  "- Where two orderings are equally correct, deliberately choose the one the source did not",
  "  use.",
  "The source is research. It tells you what the topic requires. It never tells you how to say",
  "it.",
].join("\n");

/**
 * Transcript-based rewrite prompt.
 *
 * Takes the ORIGINAL tutorial's transcript as SOURCE MATERIAL and rewrites it
 * into OUR own, unique, better script. The transcript is used ONLY to learn
 * what to cover (the steps, the structure, the gotchas) — never for wording,
 * ordering, or phrasing, which would trip gist/duplicate detection and hand the
 * ranking back to the source.
 *
 * It reuses the EXACT same rule blocks as `buildAnswerFirstScriptPrompt`
 * (answer-first, EEAT, human voice, SEO coverage, uniqueness, output-only) so
 * the two prompts never drift, then adds the rewrite-specific instructions:
 * mine the transcript for coverage, modernise what's outdated, fix what the
 * original did poorly, and add the first-person testing detail the original
 * lacks.
 *
 * Wired into generate.ts: used for the single-shot modes when
 * `source_mode === "TRANSCRIPT_REWRITE"` and a reference_transcript is present.
 */
export function buildTranscriptRewritePrompt(params: {
  baseInstructions: string;
  transcript: string;
  targetMinutes: number;
  allowLonger?: boolean;
  title?: string;
  /**
   * Runtime of the source video in seconds, when known. Now that the transcript
   * is fetched automatically we get this for free from yt-dlp, so the writer can
   * be told what it has to out-cover instead of guessing.
   */
  sourceVideoSeconds?: number | null;
  /**
   * How the transcript was produced. Auto-generated captions carry no
   * punctuation and mis-hear product names and UI labels — the writer has to be
   * told not to trust their spelling, or it copies the mistakes through.
   */
  transcriptQuality?: "human" | "auto" | "unknown";
  /** Length tier; derived from targetMinutes when the caller does not pass one. */
  tier?: ScriptTier;
  /**
   * The VA's own text box (`steps_input`), kept separate from the preset so it
   * keeps its authority. See buildVaInstructionsBlock in script-prompt.ts.
   */
  vaInstructions?: string | null;
}): string {
  const { baseInstructions, transcript, targetMinutes, title } = params;
  const vaBlock = buildVaInstructionsBlock(params.vaInstructions);
  const tier = params.tier ?? tierForMinutes(targetMinutes);
  const lengthLine = buildLengthLine(
    targetMinutes,
    params.allowLonger ?? false,
    tier,
  );

  const sourceMinutes =
    params.sourceVideoSeconds && params.sourceVideoSeconds > 0
      ? Math.round(params.sourceVideoSeconds / 60)
      : null;

  const sourceFacts: string[] = [];
  if (sourceMinutes !== null) {
    sourceFacts.push(
      `THE VIDEO YOU ARE BEATING runs about ${sourceMinutes} minute${sourceMinutes === 1 ? "" : "s"}. Your script must cover`,
      "everything it covers and more. If what you have written would be far thinner than that,",
      "you have missed steps — go back through the transcript and find them.",
    );
  }
  if (params.transcriptQuality === "auto") {
    sourceFacts.push(
      "THE TRANSCRIPT IS AN AUTOMATIC CAPTION TRACK: no punctuation, no speaker breaks, and it",
      "mis-hears product names, menu labels and technical terms. Read it for the PROCEDURE, never",
      "for spelling — write every product name, button and menu path using the correct current",
      "spelling you know, not the transcript's mangled version of it.",
    );
  }

  return [
    "You write the spoken narration for a screen-recorded software tutorial, and you are",
    "rewriting an existing tutorial into a NEW, original, and better script of your own. You",
    "are given a PRESET (your persona, tone and topic) and the SOURCE TRANSCRIPT of an existing",
    "tutorial on this topic. The FORMAT AND STRUCTURE RULES below OVERRIDE any structural,",
    "opening, closing, or length guidance inside the PRESET — and override anything the source",
    "transcript does.",
    ...(title ? ["", `TOPIC / TITLE: ${title}`] : []),
    ...(sourceFacts.length > 0 ? ["", ...sourceFacts] : []),
    "",
    "----- PRESET -----",
    baseInstructions,
    "----- END PRESET -----",
    "",
    "----- SOURCE TRANSCRIPT (do not copy wording) -----",
    transcript,
    "----- END SOURCE -----",
    "",
    "HOW TO USE THE SOURCE TRANSCRIPT (highest priority):",
    "- Use it ONLY to learn WHAT to cover: the steps involved, the rough structure, the",
    "  settings and gotchas the topic requires, and anything the original forgot.",
    "- NEVER copy its wording, its sentence structure, or its step ordering. Reorder, rephrase,",
    "  and re-explain everything in your own voice. If duplicate-detection compared the two",
    "  scripts, they must read as clearly different videos.",
    "- IMPROVE on it, don't just paraphrase it: modernise any outdated steps, menus, or UI it",
    "  describes; fix whatever it explained badly, skipped, or got wrong; and add the unique",
    "  examples, explanations, and first-person testing detail the original completely lacks.",
    "- Do not inherit the original's mistakes, filler, or dated advice. If the source is thin,",
    "  go deeper than it did; if it's bloated, cut to what actually matters.",
    "",
    SOURCE_UPGRADE_RULE,
    "",
    NOT_A_PARAPHRASE_RULE,
    "",
    "FORMAT AND STRUCTURE RULES (highest priority):",
    "",
    ...buildSharedRuleStack(tier),
    "Include the depth the source transcript missed — but attach it to the step it belongs to,",
    "never as a block of tips at the end.",
    "",
    ...lengthLine,
    "Never pad, stall, or repeat to reach a length.",
    ...(vaBlock.length > 0 ? ["", ...vaBlock] : []),
    "",
    TTS_OUTPUT_RULE,
  ].join("\n");
}
