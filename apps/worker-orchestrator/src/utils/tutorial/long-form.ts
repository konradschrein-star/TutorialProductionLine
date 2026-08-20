import { z } from "zod";
// NOTE: script-prompt.ts imports WORDS_PER_MINUTE from this module, so this is a
// deliberate import cycle. Everything imported here is referenced ONLY inside
// function bodies (never at module top level), which is what keeps it safe under
// ESM's live-binding semantics regardless of which module loads first.
import {
  buildSharedRuleStack,
  TTS_OUTPUT_RULE,
  tierForMinutes,
} from "./script-prompt.js";

/** Average spoken words per minute used for length estimates. */
export const WORDS_PER_MINUTE = 150;

/** How far over the target a part may run before we sub-split it. */
const OVERFLOW_FACTOR = 1.3;

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function estimateMinutes(text: string): number {
  return countWords(text) / WORDS_PER_MINUTE;
}

/**
 * Split text into sentences, keeping trailing punctuation. A "sentence"
 * ends at . ! ? optionally followed by closing quotes/brackets.
 */
function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+[.!?]+["')\]]*\s*/g);
  if (!matches) return [text.trim()].filter(Boolean);
  return matches.map((s) => s.trim()).filter(Boolean);
}

/**
 * If `text` estimates well over `targetMinutes` (> OVERFLOW_FACTOR×), split it
 * into chunks at SENTENCE BOUNDARIES near the target. Never splits mid-sentence.
 * Returns [text] unchanged when within budget.
 */
export function splitPartIfTooLong(
  text: string,
  targetMinutes: number,
): string[] {
  const trimmed = text.trim();
  if (estimateMinutes(trimmed) <= targetMinutes * OVERFLOW_FACTOR)
    return [trimmed];

  const targetWords = targetMinutes * WORDS_PER_MINUTE;
  const sentences = splitSentences(trimmed);
  const chunks: string[] = [];
  let current: string[] = [];
  let words = 0;

  for (const s of sentences) {
    const w = countWords(s);
    if (words > 0 && words + w > targetWords) {
      chunks.push(current.join(" ").trim());
      current = [s];
      words = w;
    } else {
      current.push(s);
      words += w;
    }
  }
  if (current.length > 0) chunks.push(current.join(" ").trim());
  return chunks.length > 0 ? chunks : [trimmed];
}

export const OutlineSchema = z.object({
  parts: z
    .array(z.object({ title: z.string().min(1), summary: z.string().min(1) }))
    .min(1),
});
export type Outline = z.infer<typeof OutlineSchema>;
export type OutlinePart = Outline["parts"][number];

/**
 * Repair an imperfect LLM outline before strict validation. Models occasionally
 * emit valid JSON with a part missing its title or summary, or an empty/extra
 * object. Rather than failing the whole long-form job, drop parts with no usable
 * content and backfill a missing title (from the summary, or "Chapter N") or a
 * missing summary (from the title).
 */
function repairOutline(json: unknown): unknown {
  if (!json || typeof json !== "object" || Array.isArray(json)) return json;
  const obj = json as { parts?: unknown };
  if (!Array.isArray(obj.parts)) return json;
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const parts = obj.parts
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map((p) => ({ title: str(p["title"]), summary: str(p["summary"]) }))
    .filter((p) => p.title || p.summary)
    .map((p, i) => ({
      title: p.title || `Chapter ${i + 1}`,
      summary: p.summary || p.title,
    }));
  return { parts };
}

/** Parse the LLM's outline JSON, tolerating ```json fences and prose around it. */
export function parseOutline(raw: string): Outline {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) text = fence[1].trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  const json = JSON.parse(text) as unknown;
  return OutlineSchema.parse(repairOutline(json));
}

/**
 * Chapter flow — the rule that stops each chapter being its own little video.
 *
 * Straight out of our own failed 45-minute Google Slides video, which opened
 * seven separate segments with a variant of "In this walkthrough, you'll learn…"
 * and closed each one by re-listing the clicks it had just performed. Gemini's
 * review called the result "sterile, robotic… reads exactly like a software
 * instruction manual", and it was right.
 *
 * The structural cause is fixed by making the rule stack position-aware (see
 * buildSharedRuleStack). This block is the belt to that braces: it names the
 * exact sentence shapes so the model cannot drift back into them.
 */
export const CHAPTER_FLOW_RULE = [
  "ONE CONTINUOUS VIDEO — not a stack of little videos.",
  "The viewer is watching one long recording straight through. Chapters are where the CHAPTER",
  "MARKERS go; they are not episodes, and the viewer never hears one begin or end.",
  "NEVER open a chapter by announcing what it will teach. Banned openings, all of them:",
  '  "In this walkthrough, you\'ll learn…", "In this segment we\'ll cover…", "In this part,',
  '  I\'ll show you…", "By the end of this section you\'ll be able to…".',
  "Our own worst-performing video opened seven segments that way and it is the single most",
  "robotic thing in it.",
  "NEVER close one by re-listing what you just did. Banned: \"So, by inserting your video,",
  'opening format options, and setting the start time…", "To recap:", "That\'s how you…",',
  '"With these steps and considerations…". Say it once, while doing it. Never twice.',
  "INSTEAD, move between areas the way a person showing you their screen does: finish the",
  "thing, let the result sit on screen for a beat, and go straight into the next piece of",
  "work with a real transition — the reason you are going there. \"That covers the layout.",
  "Now the part everyone gets wrong…\" is a transition. \"In this section, we will discuss",
  'layouts" is a table of contents.',
].join("\n");

/**
 * Anti-over-explaining.
 *
 * Gemini on our video: "You spend precious time explaining what a PDF is instead
 * of just showing the export process. This destroys your pacing and bores
 * viewers." The script really did spend ~40 seconds defining PDF and PPTX.
 *
 * This is the counterweight to TEACHING SUBSTANCE, and the line between them is
 * sharp: explain the DECISION (which one to pick, and why), never the NOUN.
 */
export const NO_OVER_EXPLAINING_RULE = [
  "DO NOT EXPLAIN WHAT THINGS ARE. Explain what to DO and WHY THIS ONE.",
  "The viewer already knows what a PDF is, what a folder is, what a font is, what an image",
  "is, what the internet is. Defining them insults them and kills the pace. Our own video",
  "spent nearly a minute explaining what a PDF is and what a PowerPoint file is before",
  "showing a two-click export, and that passage is where people leave.",
  "The test: would a competent adult who uses a computer already know this sentence? Then cut",
  "it and perform the action instead.",
  "This does NOT conflict with teaching substance. The difference is sharp:",
  '  BANNED (defining a noun): "A PDF preserves the layout, fonts and spacing exactly as you',
  '    see them on screen, which makes it ideal for printing."',
  '  REQUIRED (deciding between options): "Export PDF if anyone is printing this — PowerPoint',
  '    if they need to edit it. And if you used a custom font, PowerPoint will substitute it,',
  '    so check the title slide before you send it."',
  "Same subject. The first is a dictionary. The second is worth watching.",
].join("\n");

export function buildOutlinePrompt(
  baseInstructions: string,
  context: string,
  nParts: number,
  partMinutes: number,
  opts: { title?: string; totalMinutes?: number } = {},
): string {
  const title = opts.title?.trim();
  return [
    baseInstructions,
    "",
    // The outline decides what each chapter contains, so the no-presenter
    // constraint has to reach it: an outline with a "Welcome and introduction"
    // chapter guarantees a presenter-led chapter one no matter what the
    // expansion prompt says afterwards.
    "THE FORMAT — this video is a SCREEN RECORDING with no presenter, no face on camera and no",
    "b-roll. Every chapter must consist of things that are DONE on screen in the software. Do",
    'not plan a chapter (or any part of one) that is greeting, channel talk, "what this video',
    'covers" as a standalone segment, theory with nothing to show, or a summary/outro. Chapter',
    "one opens by confirming what the viewer searched for while the finished result is on",
    "screen; every chapter after it is work being performed.",
    "",
    "TASK: Plan this long-form spoken tutorial as a structured chapter outline.",
    `Produce EXACTLY ${nParts} chapters. Each chapter is a coherent section that will`,
    `be spoken for about ${partMinutes} minutes (~${partMinutes * WORDS_PER_MINUTE} words).`,
    "",
    ...(title
      ? [
          `THE VIDEO IS TITLED: ${title}`,
          "That title is a promise, and the outline is where we keep it or break it. If it",
          "promises ADVANCED material, chapter one teaches something an experienced user does",
          "not already know — do not spend the first quarter of the video on basics and leave",
          "the real material until the end. If it promises a COMPLETE course, it genuinely",
          "starts from the beginning and that is fine. Read the title, then plan honestly",
          "against it. We shipped a 45-minute video titled Advanced whose only advanced topic",
          "started at minute 44; that video failed, and this is where it failed.",
          "",
        ]
      : []),
    "ONE REAL PROJECT — this is the spine of the whole video.",
    "Do NOT plan a tour of features in a vacuum. Pick one concrete, realistic thing a viewer",
    "would actually make, name it, and build it across the chapters so that every feature is",
    "taught because the project needs it right then. The viewer should be able to follow along",
    "and finish with the same thing built.",
    "A feature demonstrated on an empty document teaches nothing about when to use it. A",
    "feature used to solve a real problem in a real project is the entire reason someone",
    "watches a person instead of reading the documentation.",
    "State the project in chapter one's summary so every later chapter can build on it.",
    "",
    "VALUE ORDER — put the payoff early, not last.",
    "Order chapters by how much the viewer gains, not by how basic they are. The single most",
    "valuable thing this video teaches belongs in the FIRST THIRD, while people are still",
    "watching. Prerequisites come first only when something genuinely cannot be done without",
    "them, and then they are as short as possible.",
    "Never save the best material for the end to hold people — they do not stay, they leave",
    "and the material is never seen.",
    "",
    "Chapters must follow a logical order, must not overlap, and together must cover the",
    "steps and source material thoroughly.",
    "- Chapter 1 opens the video: it confirms what the viewer searched for while the finished",
    "  project is on screen, names the project, and then starts real work.",
    "- Every chapter after it is a distinct area of work that moves the project forward.",
    `- The final chapter (chapter ${nParts}) teaches its own real material like any other, and`,
    "  only then closes the video. It is NOT a summary chapter and it must never be planned as",
    "  a recap — a chapter whose content is 'review of what we covered' is a wasted chapter.",
    "- Plan a natural hand-off at the end of each chapter: the work reaches a finished, visible",
    "  state that the next chapter picks up from. That beat is what makes a long video",
    "  survivable, and it is where the chapter marker goes.",
    "Each chapter's summary must be SPECIFIC: list the concrete points, steps, or ideas",
    "that chapter will teach, so it can be written well without seeing the other chapters.",
    "Every chapter MUST have both a non-empty title and a non-empty summary.",
    "",
    "Respond with ONLY JSON in this exact shape (no prose, no markdown fences):",
    '{"parts":[{"title":"...","summary":"..."}]}',
    "",
    "REFERENCE CONTEXT (the steps and/or source material — e.g. a transcript or guide — to base the tutorial on):",
    context,
  ].join("\n");
}

/** Where a chapter sits in the overall video, so the script can open / flow / close. */
export interface PartPosition {
  /** 0-based index of this chapter among the outline chapters. */
  index: number;
  /** total number of outline chapters. */
  total: number;
}

/**
 * Position-specific narration instructions.
 *
 * 2026-08-03: these used to demand a presenter-led opener ("In this complete
 * guide, you'll learn how to…"), a like-and-subscribe nudge in chapter one, and
 * a recap-plus-sign-off at the end. LONG_FORM is a screen recording like every
 * other tutorial mode — there is no presenter and nothing to show during any of
 * that. The opening chapter now carries the LONG-tier introduction (which is
 * delivered over the finished result on screen), the final chapter carries the
 * ask, and the middle chapters stay mid-flow.
 */
function positionGuidance(position: PartPosition): string[] {
  const isFirst = position.index === 0;
  const isLast = position.index === position.total - 1;

  if (position.total <= 1) {
    return [
      "This chapter is the WHOLE video, so open it and close it properly, exactly as the",
      "OPENING and CLOSE rules above describe. Nothing else is added here.",
    ];
  }
  if (isFirst) {
    return [
      "This is the OPENING chapter of the video, so it carries the introduction described",
      "in the OPENING rule above — the click-confirm, the finished result shown on screen,",
      'and what we cover and why in that order. No greeting, no channel talk, no "in this',
      'video", no promise of what they will know by the end, and NO like-and-subscribe ask',
      "here — that belongs at the very end of the last chapter.",
      "Then begin teaching, and end mid-flow so the next chapter continues seamlessly — do",
      "NOT recap or sign off; the video is just getting started.",
    ];
  }
  if (isLast) {
    return [
      "This is the FINAL chapter of the video.",
      "Begin mid-flow, continuing naturally from the previous chapter — do not greet the",
      "viewer or re-introduce the video.",
      "Teach this last section, then close out the whole video exactly as the CLOSE AND THE",
      "ASK rule above describes: at most three sentences of close over the finished result",
      'on screen, then the like, subscribe and "this was helpful" comment ask. The ask is',
      "the last thing in the video.",
    ];
  }
  return [
    "This is a MIDDLE chapter of the video.",
    "Begin mid-flow, continuing naturally from the previous chapter — do not greet the",
    "viewer, re-introduce the video, or recap from the very beginning.",
    "If it helps the transition, acknowledge in a sentence what was just covered, then",
    "teach this chapter thoroughly.",
    "End mid-flow so the next chapter continues seamlessly — do NOT sign off, wrap up, or",
    "ask for likes; there is more to come.",
  ];
}

export function buildExpansionPrompt(
  baseInstructions: string,
  part: OutlinePart,
  partMinutes: number,
  position?: PartPosition,
  priorParts: OutlinePart[] = [],
): string {
  const pos = position ?? { index: 0, total: 1 };
  const isOnly = pos.total <= 1;
  const isFirst = pos.index === 0;
  const isLast = pos.index === pos.total - 1;
  // A LONG_FORM video is long even though one chapter is ~8 minutes, so the
  // chapters are written with the LONG tier's rules (real introduction in
  // chapter one, close + ask in the last one). Section markers are asked for by
  // that stack and stripped before TTS.
  const lines: string[] = [
    "You write the spoken narration for a screen-recorded software tutorial. The PRESET below",
    "is your persona, tone and topic; the FORMAT AND STRUCTURE RULES after it override any",
    "structural, opening, closing or length guidance inside it.",
    "",
    "----- PRESET -----",
    baseInstructions,
    "----- END PRESET -----",
    "",
    "FORMAT AND STRUCTURE RULES (highest priority):",
    "",
    // Position-aware on purpose. Handing every chapter the OPENING and CLOSING
    // rules is what turned our 45-minute video into seven mini-tutorials, each
    // introducing and then recapping itself.
    ...buildSharedRuleStack(tierForMinutes(Math.max(11, partMinutes)), {
      markers: false,
      opening: isOnly || isFirst,
      closing: isOnly || isLast,
    }),
    "",
    CHAPTER_FLOW_RULE,
    "",
    NO_OVER_EXPLAINING_RULE,
    "",
    `Write the spoken narration for ONE chapter of a longer tutorial: "${part.title}".`,
    `Cover exactly this section: ${part.summary}`,
    `Target about ${partMinutes} minutes of speech (~${partMinutes * WORDS_PER_MINUTE} words).`,
    // Measured 2026-08-05: chapters targeted at 8 minutes came back at 9.4-12.9,
    // so a 40-minute video became 54. splitPartIfTooLong then re-splits anything
    // over 1.3x, which silently turns the planned chapter count into a different
    // one. Give the chapter a number it can actually hold to.
    `HARD CEILING: ${Math.round(partMinutes * WORDS_PER_MINUTE * 1.1)} words. Going over does not`,
    "make the video better — it makes this chapter get split in half later, which breaks the",
    "hand-off you wrote. If you are running long, cut the least valuable step, not the depth on",
    "the steps that matter.",
    "Teach it thoroughly enough to fill the time; never pad with empty filler.",
    "",
    ...positionGuidance(pos),
    "",
    TTS_OUTPUT_RULE,
    'Also: no chapter titles, no part numbers, and no meta phrases like "in this chapter" or',
    '"in this part".',
  ];
  if (priorParts.length > 0) {
    lines.push(
      "",
      "CHAPTERS ALREADY COVERED EARLIER IN THIS VIDEO (for continuity — build on these, do NOT repeat them):",
      priorParts
        .map((p, i) => `${i + 1}. ${p.title} — ${p.summary}`)
        .join("\n"),
    );
  }
  return lines.join("\n");
}
