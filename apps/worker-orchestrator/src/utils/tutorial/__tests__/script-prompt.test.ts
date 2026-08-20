import { describe, it, expect } from "vitest";
import {
  buildAnswerFirstScriptPrompt,
  buildLengthLine,
  targetMinutesForMode,
  tierForMinutes,
  tierExpectsMarkers,
} from "../script-prompt.js";
import { buildTranscriptRewritePrompt } from "../transcript-rewrite-prompt.js";
import { buildExpansionPrompt, buildOutlinePrompt } from "../long-form.js";

/**
 * THE defect these prompts exist to prevent (2026-08-03, owner):
 *
 *   "there's an intro and weird stuff, blah blah blah, where the virtual
 *    assistant is just swirling his mouse pointer around and our visualization
 *    looks like shit."
 *
 * A tutorial is a SCREEN RECORDING with TTS over it. There is no presenter, no
 * face on camera and no b-roll, so a talky intro is 20-30 seconds with literally
 * nothing to show. Every prompt must state that and forbid any words that have
 * no on-screen counterpart.
 */
describe("no-presenter format rule (all tiers, all prompts)", () => {
  const prompts = [
    buildAnswerFirstScriptPrompt("PRESET TEXT", 3),
    buildAnswerFirstScriptPrompt("PRESET TEXT", 6),
    buildAnswerFirstScriptPrompt("PRESET TEXT", 8),
    buildAnswerFirstScriptPrompt("PRESET TEXT", 14),
    buildTranscriptRewritePrompt({
      baseInstructions: "PRESET TEXT",
      transcript: "T",
      targetMinutes: 6,
    }),
    buildExpansionPrompt("PRESET TEXT", { title: "t", summary: "s" }, 8, {
      index: 0,
      total: 5,
    }),
  ];

  it("states the screen-recording format with no presenter", () => {
    for (const p of prompts) {
      expect(p).toMatch(/SCREEN RECORDING/);
      expect(p).toMatch(/NO presenter/);
      expect(p).toMatch(/no b-roll|NO b-roll/i);
    }
  });

  it("requires every sentence to have something on screen", () => {
    for (const p of prompts) {
      expect(p).toMatch(/DELETE THE SENTENCE/);
    }
  });

  it("forbids greetings and the 'in today's video' preamble", () => {
    for (const p of prompts) {
      expect(p).toMatch(/welcome back/i);
      expect(p).toMatch(/in today's video/i);
    }
  });

  it("paces for a human operator so the VA can keep up", () => {
    for (const p of prompts) {
      expect(p).toMatch(/One action per sentence/i);
    }
  });
});

/**
 * The output goes STRAIGHT into TTS, so every character is spoken. The
 * sanitiser (sanitize-script.ts) is defence in depth and deliberately cannot
 * remove things like "Step 1:" or "(clicks Save)" without rewriting the spoken
 * words — so the prompt has to be wider than the sanitiser.
 */
describe("TTS-clean output rule", () => {
  const prompt = buildAnswerFirstScriptPrompt("PRESET TEXT", 6);

  it("bans markdown, headings, lists and step labels", () => {
    expect(prompt).toMatch(/markdown/i);
    expect(prompt).toMatch(/headings/i);
    expect(prompt).toMatch(/numbered or bulleted lists/i);
    expect(prompt).toMatch(/Step 1:/);
  });

  it("bans stage directions and speaker labels", () => {
    expect(prompt).toMatch(/stage directions/i);
    expect(prompt).toMatch(/\(clicks the button\)/);
    expect(prompt).toMatch(/\[pause\]/);
    expect(prompt).toMatch(/Narrator:/);
  });

  it("bans raw URLs being read out character by character", () => {
    expect(prompt).toMatch(/raw URLs/i);
    expect(prompt).toMatch(/zapier dot/i);
  });

  it("says the text is fed directly to a text-to-speech voice", () => {
    expect(prompt).toMatch(/text-to-speech voice/i);
  });
});

/**
 * SHORT (3-6 min) is the main output right now: confirm the click fast, do it,
 * ask for like + subscribe + a "this was helpful" comment, then STOP.
 */
describe("SHORT tier (3-6 minutes)", () => {
  const prompt = buildAnswerFirstScriptPrompt("PRESET TEXT", 3);

  it("caps the opening with a word budget and gets to an action fast", () => {
    expect(prompt).toMatch(/15 TO 40 WORDS/);
    expect(prompt).toMatch(/THIRD sentence at the latest/);
  });

  it("forbids the channel-talk opening and the end-state promise", () => {
    expect(prompt).toMatch(/no promise of what they will know by the end/);
    expect(prompt).toMatch(/welcome back/i);
  });

  /**
   * Owner-reported twice, and I got it wrong in between.
   *
   * First report: "in most cases the intro is the same, which is something like
   * 'Today we're gonna do X' and X is in most cases the video title." I read
   * that as "stop restating the title" and banned it outright.
   *
   * Then he sent four transcripts of tutorials that actually perform — and
   * every one of them states the task plainly in sentence one. Kevin literally
   * opens with "Today, we are going to learn how to use Microsoft Excel." The
   * SEO rule in this same prompt had been saying so all along, so my ban put
   * two rules in direct conflict.
   *
   * What actually reads as AI is the REGISTER, not the restatement: mind-reading
   * the viewer, a dash used as a dramatic pause, and ad-copy adjectives. So the
   * rule now demands the plain statement and polices how it is phrased.
   */
  it("states the task plainly rather than avoiding it", () => {
    expect(prompt).toMatch(/Sentence one states the task plainly/);
    expect(prompt).toMatch(/do not avoid it/);
    // The ban I wrongly introduced must be gone.
    expect(prompt).not.toMatch(/Do NOT restate the title/);
  });

  it("carries the real reference openings, not invented ones", () => {
    // Copying register beats describing it, so the actual transcripts ship.
    expect(prompt).toMatch(
      /Today I'm going to show you exactly how to use Gmail/,
    );
    expect(prompt).toMatch(
      /how to fix Wi-Fi connected but no internet on Android/,
    );
    expect(prompt).toMatch(/how to use Microsoft Excel in just 15 minutes/);
  });

  it("names our own two failed openings as the bad examples", () => {
    expect(prompt).toMatch(/You looked up how to track mileage in Expensify/);
    expect(prompt).toMatch(/Mileage lives on the Expenses page/);
  });

  it("asks for like, subscribe AND a 'this was helpful' comment", () => {
    expect(prompt).toMatch(/a like,/);
    expect(prompt).toMatch(/a subscribe,/);
    expect(prompt).toMatch(/COMMENT saying it was helpful/);
  });

  it("ends on the ask — no recap, no outro", () => {
    expect(prompt).toMatch(/THEN STOP/);
    expect(prompt).toMatch(/There is no outro/);
    expect(prompt).toMatch(/in\s+this video we learned/);
  });

  it("does not demand section markers (chapters are useless this short)", () => {
    expect(tierExpectsMarkers("SHORT")).toBe(false);
    expect(prompt).not.toContain("[[SUBTOPIC:");
  });

  /**
   * First live run of the rewritten SHORT prompt produced a 195-word script —
   * a bare list of clicks with no "what you'll see" and no gotchas, about 78
   * seconds long. A ceiling alone is not enough; the floor has to be stated and
   * has to say HOW to reach it (explain the screen, never add an intro).
   */
  it("states both a ceiling and a floor, and how to reach the floor", () => {
    expect(prompt).toMatch(/CEILING, not a goal/);
    expect(prompt).toMatch(/Under about 450 words/);
    expect(prompt).toMatch(/NEVER by adding an intro/);
  });

  /**
   * VA-reported, 2026-08-04: "6-Minute Tutorial only generates 2-3 minutes".
   *
   * They were right, and the prompt was the cause. THREE_MIN and SIX_MIN both
   * resolve to the SHORT tier, and the floor was a hardcoded "about 3 minutes /
   * 450 words" for both — with a line stating outright that "a simple task
   * answered in three minutes is the CORRECT outcome". A VA who picked six
   * minutes got a prompt whose floor AND stated ideal were three. The model
   * obeyed.
   *
   * The floor is now proportional to the chosen length. These pin both ends so
   * the two modes can never collapse into each other again.
   */
  it("scales the floor to the chosen length — 6 minutes is not 3", () => {
    const sixMin = buildAnswerFirstScriptPrompt("PRESET TEXT", 6);
    expect(sixMin).toMatch(/between about 5 and 6 minutes/);
    expect(sixMin).toMatch(/750 to 900 words/);
    expect(sixMin).toMatch(/Under about 750 words/);
    // The old text told the model three minutes was the right answer.
    expect(sixMin).not.toMatch(/answered\s+in three minutes is the CORRECT/);
  });

  it("leaves the 3-minute mode exactly where it was", () => {
    expect(prompt).toMatch(/between about 3 and 4 minutes/);
    expect(prompt).toMatch(/Under about 450 words/);
  });

  it("states a word range whose two ends agree with the minute range", () => {
    // "between about 3 and 4 minutes (roughly 450 to 450 words)" shipped: the
    // minute ceiling was max(4, target) while the word ceiling used target.
    for (const [minutes, lo, hi] of [
      [3, 450, 600],
      [6, 750, 900],
    ] as const) {
      const p = buildAnswerFirstScriptPrompt("PRESET TEXT", minutes);
      expect(p, `target=${minutes}`).toMatch(
        new RegExp(`roughly ${lo} to ${hi} words`),
      );
    }
  });

  it("bans the one-action-per-line checklist layout", () => {
    expect(prompt).toMatch(/flowing PARAGRAPHS/);
    expect(prompt).toMatch(/numbered list with the/);
  });

  it("does not ask for SEO breadth, which is just padding at this length", () => {
    expect(prompt).toMatch(/Do NOT add extra subtopics/);
  });
});

describe("MEDIUM tier (~8 minutes)", () => {
  const prompt = buildAnswerFirstScriptPrompt("PRESET TEXT", 8);

  it("allows a slightly longer click-confirm but still no preamble", () => {
    expect(prompt).toMatch(/TWO OR THREE SENTENCES, 40 TO 60 WORDS/);
  });

  it("permits genuinely useful extras before the ask, never after", () => {
    expect(prompt).toMatch(/extras go BEFORE the ask, never after/);
  });

  it("still ends on the like/subscribe/comment ask", () => {
    expect(prompt).toMatch(/COMMENT saying it was helpful/);
    expect(prompt).toMatch(/THEN STOP/);
  });

  it("asks for section markers", () => {
    expect(tierExpectsMarkers("MEDIUM")).toBe(true);
    expect(prompt).toContain("[[SUBTOPIC:");
  });
});

describe("LONG tier (~14 minutes)", () => {
  const prompt = buildAnswerFirstScriptPrompt("PRESET TEXT", 14);

  it("justifies a real introduction", () => {
    expect(prompt).toMatch(/A REAL INTRODUCTION/);
    expect(prompt).toMatch(/WHAT WE COVER AND WHY IN THIS ORDER/);
  });

  it("keeps the introduction anchored to something on screen", () => {
    expect(prompt).toMatch(/SHOW THE DESTINATION/);
    expect(prompt).toMatch(/finished result/i);
  });

  it("bans reading a table of contents aloud", () => {
    expect(prompt).toMatch(/table of contents/i);
  });

  it("still ends on the ask", () => {
    expect(prompt).toMatch(/COMMENT saying it was helpful/);
  });
});

/**
 * VA-reported defect (2026-07-30): scripts rushed the steps in the first
 * ~10-20% then filled the rest with tips. The walkthrough must stay the spine.
 */
describe("walkthrough pacing (retained from the 2026-07-30 fix)", () => {
  const prompt = buildAnswerFirstScriptPrompt("PRESET TEXT", 8);

  it("does not order the model to finish the whole solution in ~30 seconds", () => {
    expect(prompt).not.toMatch(/COMPLETE working solution within the first/i);
  });

  it("makes the step-by-step walkthrough the spine of the video", () => {
    expect(prompt).toMatch(/WALKTHROUGH/);
    expect(prompt).toMatch(/one at a time/i);
  });

  it("bans finishing the steps early and padding with general tips", () => {
    expect(prompt).toMatch(/general tips/i);
  });

  it("gives the walkthrough an explicit majority share of the runtime", () => {
    expect(prompt).toMatch(/PACING/);
    expect(prompt).toMatch(/%/);
  });

  it("still requires depth, attached to the step it belongs to", () => {
    expect(prompt).toMatch(/mistake people make right here/i);
  });

  it("keeps the preset framed as tone/expertise reference only", () => {
    expect(prompt).toContain("PRESET TEXT");
    expect(prompt).toMatch(/FORMAT AND STRUCTURE RULES/);
  });
});

describe("transcript-rewrite prompt stays in sync", () => {
  const prompt = buildTranscriptRewritePrompt({
    baseInstructions: "PRESET TEXT",
    transcript: "SOURCE TRANSCRIPT TEXT",
    targetMinutes: 6,
    title: "How to do X",
  });

  it("uses the identical shared rule stack", () => {
    expect(prompt).toMatch(/WALKTHROUGH/);
    expect(prompt).toMatch(/PACING/);
    expect(prompt).toMatch(/THE FORMAT/);
    expect(prompt).toMatch(/COMMENT saying it was helpful/);
  });

  it("still carries the rewrite-specific source rules", () => {
    expect(prompt).toContain("SOURCE TRANSCRIPT TEXT");
    expect(prompt).toMatch(/NEVER copy its wording/);
  });

  it("explicitly refuses to inherit the source's presenter format", () => {
    expect(prompt).toMatch(/DO NOT INHERIT THE SOURCE'S FORMAT/);
  });
});

describe("transcript-rewrite prompt: what 'better' means", () => {
  const prompt = buildTranscriptRewritePrompt({
    baseInstructions: "PRESET TEXT",
    transcript: "SOURCE TRANSCRIPT TEXT",
    targetMinutes: 6,
  });

  it("defines improvement operationally, on all five axes", () => {
    expect(prompt).toMatch(/COMPLETENESS/);
    expect(prompt).toMatch(/CURRENT UI/);
    expect(prompt).toMatch(/VERIFICATION/);
    expect(prompt).toMatch(/TROUBLESHOOTING/);
    expect(prompt).toMatch(/ORDERING/);
  });

  it("sets a concrete, checkable distinctness bar", () => {
    expect(prompt).toMatch(/NOT A PARAPHRASE/);
    expect(prompt).toMatch(/more than four consecutive words/i);
    expect(prompt).toMatch(/button and menu\s+labels/i);
  });

  it("tells the writer what runtime it has to out-cover, when known", () => {
    const withLength = buildTranscriptRewritePrompt({
      baseInstructions: "P",
      transcript: "T",
      targetMinutes: 6,
      sourceVideoSeconds: 1080,
    });
    expect(withLength).toMatch(/runs about 18 minutes/);
    expect(prompt).not.toMatch(/runs about/);
  });

  it("warns that auto-captions mangle UI labels, only for auto sources", () => {
    const auto = buildTranscriptRewritePrompt({
      baseInstructions: "P",
      transcript: "T",
      targetMinutes: 6,
      transcriptQuality: "auto",
    });
    expect(auto).toMatch(/AUTOMATIC CAPTION TRACK/);
    const human = buildTranscriptRewritePrompt({
      baseInstructions: "P",
      transcript: "T",
      targetMinutes: 6,
      transcriptQuality: "human",
    });
    expect(human).not.toMatch(/AUTOMATIC CAPTION TRACK/);
  });
});

/**
 * LONG_FORM writes each chapter straight into a child job's script_text and
 * feeds it to TTS WITHOUT passing it through extractScriptStructure — so a
 * section marker emitted there would be spoken aloud.
 */
describe("LONG_FORM chapter prompts", () => {
  const first = buildExpansionPrompt(
    "PRESET TEXT",
    { title: "Connect the account", summary: "s" },
    8,
    { index: 0, total: 4 },
  );
  const middle = buildExpansionPrompt(
    "PRESET TEXT",
    { title: "Map the fields", summary: "s" },
    8,
    { index: 1, total: 4 },
  );
  const last = buildExpansionPrompt(
    "PRESET TEXT",
    { title: "Test it", summary: "s" },
    8,
    { index: 3, total: 4 },
  );

  it("never asks a chapter for section markers (they would reach TTS)", () => {
    for (const p of [first, middle, last]) {
      expect(p).not.toContain("[[SUBTOPIC:");
      expect(p).not.toContain("[[INTRO]]");
    }
  });

  it("no longer asks chapter one for a presenter-style SEO opener or a CTA", () => {
    expect(first).not.toMatch(/In this complete\s*\n?guide/);
    expect(first).toMatch(/NO like-and-subscribe ask/);
  });

  it("puts the ask at the very end of the final chapter only", () => {
    expect(last).toMatch(/the ask is|The ask is/);
    expect(middle).toMatch(/do NOT sign off, wrap up, or/);
  });

  it("keeps the outline free of greeting/summary chapters", () => {
    const outline = buildOutlinePrompt("PRESET TEXT", "steps", 5, 8);
    expect(outline).toMatch(/SCREEN RECORDING/);
    expect(outline).toMatch(/summary\/outro/);
  });
});

/**
 * THE LONG-FORM REWRITE (2026-08-05).
 *
 * Konrad sent a transcript of our own 45-minute "Google Slides Advanced" video
 * that performed terribly, plus Gemini's review of it. The review's four
 * content findings each trace to a specific line in these prompts — this is not
 * a style problem, it is a structural one.
 *
 * 1. "Sterile, robotic tone… every segment opens 'In this walkthrough, you'll
 *    learn…'" and every segment ends by re-listing the steps.
 *    CAUSE: buildExpansionPrompt gave EVERY chapter the full LONG rule stack,
 *    which contains buildOpeningRule (a 60-90 second "REAL INTRODUCTION") and
 *    buildAskAndEndingRule (a close). positionGuidance told middle chapters not
 *    to do that, but it is three lines against two detailed blocks and it lost.
 *    So each chapter was written as a standalone mini-tutorial with its own
 *    intro and its own recap. FIX: the stack is now position-aware.
 *
 * 2. "False advertising — the actual advanced tool is buried at the 44-minute
 *    mark." CAUSE: the outline prompt literally said chapters move "from
 *    fundamentals toward the more advanced details". For a video titled
 *    "Advanced" that guarantees ten minutes of 101 content first.
 *
 * 3. "No real-world stakes — you teach features in a vacuum." CAUSE: nothing
 *    asked for a project; the outline was a list of feature areas.
 *
 * 4. "Over-explaining — you explain what a PDF is." CAUSE: nothing forbade it.
 */
describe("long-form: chapters stop being standalone mini-tutorials", () => {
  const mk = (index: number, total: number) =>
    buildExpansionPrompt("PRESET TEXT", { title: "t", summary: "s" }, 8, {
      index,
      total,
    });

  it("gives the real introduction to chapter one ONLY", () => {
    expect(mk(0, 5)).toMatch(/A REAL INTRODUCTION/);
    expect(mk(1, 5)).not.toMatch(/A REAL INTRODUCTION/);
    expect(mk(4, 5)).not.toMatch(/A REAL INTRODUCTION/);
  });

  it("gives the close and the ask to the final chapter ONLY", () => {
    expect(mk(4, 5)).toMatch(/COMMENT saying it was helpful/);
    expect(mk(0, 5)).not.toMatch(/COMMENT saying it was helpful/);
    expect(mk(2, 5)).not.toMatch(/COMMENT saying it was helpful/);
  });

  it("gives the closing value segment to the final chapter ONLY", () => {
    expect(mk(4, 5)).toMatch(/CLOSE THE LOOP/);
    expect(mk(1, 5)).not.toMatch(/CLOSE THE LOOP/);
  });

  it("bans the per-chapter opener and the per-chapter recap outright", () => {
    for (const p of [mk(0, 5), mk(2, 5), mk(4, 5)]) {
      expect(p).toMatch(/In this walkthrough/);
      expect(p).toMatch(/NEVER open a chapter by announcing/i);
      expect(p).toMatch(/never close one by re-listing/i);
    }
  });

  it("still gives a single-chapter video both ends", () => {
    const only = buildExpansionPrompt(
      "PRESET TEXT",
      { title: "t", summary: "s" },
      8,
      { index: 0, total: 1 },
    );
    expect(only).toMatch(/A REAL INTRODUCTION/);
    expect(only).toMatch(/COMMENT saying it was helpful/);
  });
});

describe("long-form: teach a real project, not features in a vacuum", () => {
  const outline = buildOutlinePrompt("PRESET TEXT", "steps", 5, 8, {
    title: "Google Slides Advanced — Complete Course",
    totalMinutes: 40,
  });

  it("requires one real thing built across the whole video", () => {
    expect(outline).toMatch(/ONE REAL PROJECT/);
    expect(outline).toMatch(/features in a vacuum/i);
  });

  it("orders by value and refuses to bury the payoff", () => {
    expect(outline).toMatch(/VALUE ORDER/);
    // The line that buried Apps Script at minute 44 must be gone.
    expect(outline).not.toMatch(/fundamentals toward the more advanced details/);
  });

  it("holds the outline to the promise in the title", () => {
    expect(outline).toContain("Google Slides Advanced — Complete Course");
    expect(outline).toMatch(/promises/i);
  });

  it("no longer plans a recap chapter at the end", () => {
    expect(outline).not.toMatch(/WRAPS UP: it covers the last material and recaps/);
  });

  it("asks for a hand-off beat between segments", () => {
    expect(outline).toMatch(/hand-off/i);
  });
});

describe("long-form: stop over-explaining", () => {
  it("forbids defining things the viewer already knows", () => {
    const p = buildExpansionPrompt("PRESET TEXT", { title: "t", summary: "s" }, 8, {
      index: 1,
      total: 4,
    });
    expect(p).toMatch(/DO NOT EXPLAIN WHAT THINGS ARE/);
    expect(p).toMatch(/what a PDF is/i);
  });
});

describe("length line", () => {
  it("treats the target as a hard ceiling for the short tier", () => {
    const line = buildLengthLine(6, false).join("\n");
    expect(line).toMatch(/900/); // 6 min * 150 wpm
    expect(line).toMatch(/CEILING/);
  });

  /**
   * Measured on the first real generation run (2026-08-05, deepseek-v4-pro):
   *   3 min  →   517 words (3.4 min)  ok
   *   10 min →  1298 words (8.7 min)  ok
   *   20 min →  4366 words (29.1 min) 46% OVER
   *   40 min →  8059 words (53.7 min) 34% OVER
   *
   * MEDIUM/LONG got a single soft line ("up to about N minutes MAX… only
   * approach it if the topic honestly has that much") while SHORT got an
   * explicit floor, ceiling, word range and instructions. Adding the teaching
   * substance and closing value blocks pushed hard against that weak ceiling
   * and it gave way. A VA who picks 20 minutes must not get 29.
   */
  it("gives MEDIUM and LONG a hard, numeric ceiling like SHORT has", () => {
    for (const [minutes, words] of [
      [10, 1500],
      [20, 3000],
    ] as const) {
      const line = buildLengthLine(minutes, false).join("\n");
      expect(line, `target=${minutes}`).toMatch(new RegExp(`${words} words`));
      expect(line, `target=${minutes}`).toMatch(/HARD CEILING/);
      expect(line, `target=${minutes}`).toMatch(/CUT the least valuable/i);
    }
  });

  it("leaves the allowLonger (stitch) path alone — it may legitimately run over", () => {
    const line = buildLengthLine(20, true).join("\n");
    expect(line).toMatch(/AT LEAST/);
    expect(line).not.toMatch(/HARD CEILING/);
  });

  it("allows overrun for stitched modes", () => {
    const line = buildLengthLine(20, true).join("\n");
    expect(line).toMatch(/AT LEAST/);
  });
});

describe("tier mapping", () => {
  it("maps minutes to tiers at the documented boundaries", () => {
    expect(tierForMinutes(3)).toBe("SHORT");
    expect(tierForMinutes(6)).toBe("SHORT");
    expect(tierForMinutes(7)).toBe("MEDIUM");
    expect(tierForMinutes(10)).toBe("MEDIUM");
    expect(tierForMinutes(11)).toBe("LONG");
    expect(tierForMinutes(40)).toBe("LONG");
  });
});

describe("targetMinutesForMode", () => {
  it("maps the single-shot modes to the SHORT tier", () => {
    expect(targetMinutesForMode("THREE_MIN", null)).toEqual({
      targetMinutes: 3,
      allowLonger: false,
      tier: "SHORT",
    });
    expect(targetMinutesForMode("SIX_MIN", null)).toEqual({
      targetMinutes: 6,
      allowLonger: false,
      tier: "SHORT",
    });
  });

  it("seeds the stitch master from the VA's total target", () => {
    expect(targetMinutesForMode("SIX_MIN_STITCH", 24)).toEqual({
      targetMinutes: 24,
      allowLonger: true,
      tier: "LONG",
    });
  });

  /**
   * `tutorial_jobs.ref_video_seconds` is the reference video's runtime — the
   * right fallback length target when rewriting. An 18-minute source used to
   * silently produce a 6-minute script.
   */
  it("falls back to the reference video's runtime when no target is set", () => {
    expect(targetMinutesForMode("SIX_MIN_STITCH", null, 1080)).toEqual({
      targetMinutes: 18,
      allowLonger: true,
      tier: "LONG",
    });
  });

  it("lets an explicit target beat the reference runtime", () => {
    expect(targetMinutesForMode("SIX_MIN_STITCH", 24, 1080).targetMinutes).toBe(
      24,
    );
  });

  it("never drops the stitch master below the 6-minute floor", () => {
    expect(targetMinutesForMode("SIX_MIN_STITCH", null, 90).targetMinutes).toBe(
      6,
    );
    expect(
      targetMinutesForMode("SIX_MIN_STITCH", null, null).targetMinutes,
    ).toBe(6);
  });

  it("ignores it for fixed-length modes — THREE_MIN means three minutes", () => {
    expect(targetMinutesForMode("THREE_MIN", null, 3600).targetMinutes).toBe(3);
    expect(targetMinutesForMode("SIX_MIN", null, 3600).targetMinutes).toBe(6);
  });
});

/**
 * VA-reported, 2026-08-05, via Konrad:
 *
 *   "The scripts being generated are removing the tips and tricks, things to be
 *    aware of etc. Those kinds of extra details. This happens even if they
 *    specifically add it in the text box before generating."
 *
 * Two separate causes, both pinned here.
 *
 * CAUSE 1 — the VA's text box had no authority. `steps_input` was concatenated
 * onto the preset and handed over as `baseInstructions`, which the prompt then
 * framed as "follow it for TONE, EXPERTISE and TOPIC only" and declared
 * overridden "without exception". So a VA typing "include tips and things to
 * watch out for" was asking for structure — the exact category the prompt threw
 * away. It now travels as its own block that outranks the preset and the
 * defaults, while still losing to THE FORMAT (no presenter / TTS-clean).
 *
 * CAUSE 2 — nothing required the teaching substance. Depth was mentioned inside
 * the walkthrough rule, but it was surrounded by prohibitions ("no theory",
 * "never invent extra tips", "there is no extras section") written to kill the
 * old padding. The model resolved the conflict the safe way and stripped the
 * explanations. Konrad: "this goes for all lengths of videos."
 */
describe("teaching substance — tips, warnings and explanations (all tiers)", () => {
  const tiers = [3, 6, 8, 14] as const;

  it("requires substance on every step, at every length", () => {
    for (const m of tiers) {
      const p = buildAnswerFirstScriptPrompt("PRESET TEXT", m);
      expect(p, `target=${m}`).toMatch(/TEACHING SUBSTANCE/);
      expect(p, `target=${m}`).toMatch(/every step carries at least one/i);
    }
  });

  it("names the kinds of substance so the model cannot skip them", () => {
    const p = buildAnswerFirstScriptPrompt("PRESET TEXT", 6);
    expect(p).toMatch(/WHY this choice matters/i);
    expect(p).toMatch(/WATCH OUT FOR/i);
    expect(p).toMatch(/CONCRETE EXAMPLE/i);
    expect(p).toMatch(/FASTER WAY/i);
  });

  it("separates substance from padding rather than banning both", () => {
    const p = buildAnswerFirstScriptPrompt("PRESET TEXT", 3);
    expect(p).toMatch(/is NOT padding/i);
    // The blanket prohibition that caused the strip must be gone.
    expect(p).not.toMatch(/no paragraph per click, no theory/);
    expect(p).not.toMatch(/extra sections or extra tips to fill time/);
  });

  it("still refuses a saved-up tips section at the end", () => {
    const p = buildAnswerFirstScriptPrompt("PRESET TEXT", 6);
    expect(p).toMatch(/never saved up and dumped at the end/i);
  });
});

/**
 * Konrad, 2026-08-05, correcting me: the VAs are not asking to be GIVEN tips —
 * he wants tips and tricks in EVERY generated script automatically. And he wants
 * a block of them near the end, for a specific reason:
 *
 *   "I just have to prevent the user from being unsatisfied and watching another
 *    video on the same topic after watching our video. It's basic SEO."
 *
 * That is search satisfaction / anti-pogo-sticking. Woven per-step depth alone
 * does not do it: the viewer finishes the task, still has the obvious follow-up
 * question, and goes back to YouTube to ask it. So the residual intent gets
 * answered before the ask.
 *
 * This is NOT the old padding defect coming back. That one was "rush the steps,
 * then fill the runtime with general tips". This segment only exists AFTER the
 * walkthrough is complete, carries NEW material, and is still performed on
 * screen.
 */
describe("closing value segment — answer the next question before they leave", () => {
  it("appears at every tier, positioned before the ask", () => {
    for (const m of [3, 6, 8, 14] as const) {
      const p = buildAnswerFirstScriptPrompt("PRESET TEXT", m);
      expect(p, `target=${m}`).toMatch(/CLOSE THE LOOP/);
      expect(p, `target=${m}`).toMatch(/another video on the same topic/i);
    }
  });

  it("demands new material, not a recap of what was just done", () => {
    const p = buildAnswerFirstScriptPrompt("PRESET TEXT", 6);
    expect(p).toMatch(/NEW information/);
    expect(p).toMatch(/not a recap/i);
  });

  it("keeps it performed on screen like everything else", () => {
    const p = buildAnswerFirstScriptPrompt("PRESET TEXT", 6);
    expect(p).toMatch(/still performed on screen/i);
  });

  it("no longer forbids tips after the walkthrough on SHORT", () => {
    const short = buildAnswerFirstScriptPrompt("PRESET TEXT", 3);
    // The old SHORT ending banned "further tips" outright, which is exactly
    // the segment Konrad now wants.
    expect(short).not.toMatch(/next steps, further tips, other/);
    // ...but the recap/sign-off ban must survive.
    expect(short).toMatch(/in\s+this video we learned/);
    expect(short).toMatch(/thanks for watching/i);
  });

  it("still refuses to let it replace teaching the steps", () => {
    const p = buildAnswerFirstScriptPrompt("PRESET TEXT", 6);
    expect(p).toMatch(/never instead of teaching a step properly/i);
  });

  it("gives it a runtime share so it cannot swallow the walkthrough", () => {
    const short = buildAnswerFirstScriptPrompt("PRESET TEXT", 3);
    expect(short).toMatch(/Closing value segment/i);
  });
});

describe("the VA's own instructions are honoured", () => {
  const VA = "Please add tips and tricks and things to be aware of.";
  const prompt = buildAnswerFirstScriptPrompt("PRESET TEXT", 6, {
    vaInstructions: VA,
  });

  it("carries the VA's text in its own labelled block", () => {
    expect(prompt).toContain(VA);
    expect(prompt).toMatch(/WHAT THE PERSON PRODUCING THIS VIDEO ASKED FOR/);
  });

  it("ranks the VA above the preset and above the default structure", () => {
    expect(prompt).toMatch(/outrank(s)? the PRESET/i);
    expect(prompt).toMatch(/asks for tips, warnings, examples/i);
  });

  it("still does not let the VA reinstate a presenter intro", () => {
    expect(prompt).toMatch(/cannot override THE FORMAT/i);
    expect(prompt).toMatch(/SCREEN RECORDING/);
  });

  it("emits no empty block when the VA typed nothing", () => {
    const bare = buildAnswerFirstScriptPrompt("PRESET TEXT", 6);
    expect(bare).not.toMatch(/WHAT THE PERSON PRODUCING THIS VIDEO ASKED FOR/);
    const blank = buildAnswerFirstScriptPrompt("PRESET TEXT", 6, {
      vaInstructions: "   ",
    });
    expect(blank).not.toMatch(/WHAT THE PERSON PRODUCING THIS VIDEO ASKED FOR/);
  });

  it("reaches the transcript-rewrite path too", () => {
    const rewrite = buildTranscriptRewritePrompt({
      baseInstructions: "PRESET TEXT",
      transcript: "T",
      targetMinutes: 6,
      vaInstructions: VA,
    });
    expect(rewrite).toContain(VA);
    expect(rewrite).toMatch(/WHAT THE PERSON PRODUCING THIS VIDEO ASKED FOR/);
  });
});

/**
 * The owner's verdict on two successive intros: "They both really do seem like
 * AI." He then supplied six concrete rules and four reference transcripts.
 * These pin the ones a future edit is most likely to soften.
 */
describe("anti-AI voice rule", () => {
  const prompt = buildAnswerFirstScriptPrompt("PRESET TEXT", 6);

  it("bans the giveaway vocabulary", () => {
    for (const w of [
      "delve",
      "unlock",
      "harness",
      "seamless",
      "crucial",
      "robust",
      "Furthermore",
      "in conclusion",
    ]) {
      expect(prompt, `should ban "${w}"`).toContain(w);
    }
  });

  it("bans 'dive in' while allowing 'jump in'", () => {
    // The distinction is real: the owner's own reference transcript says
    // "Let's jump in". Only the AI-flavoured cousin is banned.
    expect(prompt).toMatch(/dive in.{0,20}is banned/);
    expect(prompt).toMatch(/jump in.{0,30}is fine/);
  });

  it("bans the dash used as a dramatic pause", () => {
    expect(prompt).toMatch(/Never use a dash as a dramatic pause/);
  });

  it("demands an opinion, which is the main tell", () => {
    expect(prompt).toMatch(/HAVE AN OPINION/);
    expect(prompt).toMatch(/I never use the first one/);
  });

  it("demands friction — where the reader will get it wrong", () => {
    expect(prompt).toMatch(/SHOW THE FRICTION/);
    expect(prompt).toMatch(/Name the actual error text/);
  });

  it("allows fragments and conjunction openers", () => {
    expect(prompt).toMatch(/Fragments are good/);
    expect(prompt).toMatch(/Start sentences with And, But, So, Now, Okay/);
  });

  it("asks for uneven rhythm rather than uniform sentences", () => {
    expect(prompt).toMatch(/VARY THE RHYTHM/);
  });
});

/**
 * Owner, after reading two generated scripts: "I do want it to be told from the
 * perspective of I and calling the viewer you to humanize it even more because
 * for some reason YouTube tends to push these videos more that are more sort of
 * authentic. I don't want weird jokes or something like that to end up in the
 * script. We're still somewhat staying authentic but professional."
 *
 * Both halves matter and they pull against each other, which is why they are
 * pinned together: an "I" that exists only to be charming is exactly the thing
 * he ruled out.
 */
describe("first-person voice, without becoming a personality showcase", () => {
  const prompt = buildAnswerFirstScriptPrompt("PRESET TEXT", 6);

  it("requires I and you, and says it is not optional", () => {
    expect(prompt).toMatch(/SPEAK AS 'I', TO 'YOU'/);
    expect(prompt).toMatch(/required, not decorative/);
  });

  it("bans the impersonal alternatives a model reaches for", () => {
    expect(prompt).toMatch(/never 'users' or 'we' or 'one'/);
  });

  it("rules out jokes and invented backstory", () => {
    expect(prompt).toMatch(/NO jokes, no puns, no quips/);
    expect(prompt).toMatch(/NO invented backstory/);
  });

  it("makes the I earn its place rather than just exist", () => {
    // The failure mode is an "I" that is charming and teaches nothing.
    expect(prompt).toMatch(/earns its place by being USEFUL/);
    expect(prompt).toMatch(/teaches the viewer nothing, cut it/);
  });
});
