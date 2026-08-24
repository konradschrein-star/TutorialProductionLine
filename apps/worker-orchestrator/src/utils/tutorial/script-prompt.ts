import { WORDS_PER_MINUTE } from "./long-form.js";

/**
 * Shared rule blocks for the tutorial script prompts.
 *
 * These are exported so the transcript-rewrite prompt
 * (`transcript-rewrite-prompt.ts`) and the LONG_FORM outline/expansion prompts
 * (`long-form.ts`) can reuse the EXACT same rules and stay in sync with the
 * from-scratch prompt. Each block is a self-contained, clearly-labeled section
 * the owner can edit in one place. Keep them imperative and tight — DeepSeek
 * follows short, decisive rules far better than long prose.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE FACT EVERYTHING HERE IS BUILT ON (2026-08-03)
 * ─────────────────────────────────────────────────────────────────────────────
 * A tutorial video is a SCREEN RECORDING. Nothing else. There is no presenter,
 * no host, no face on camera, no b-roll, no stock footage, no graphics. A VA
 * records their screen while the TTS audio plays and performs what the script
 * describes.
 *
 * Every previous version of these prompts (and every seeded DB preset) was
 * written as though a presenter existed: a talky intro, channel positioning,
 * "in today's video we're going to explore…". During those 20-30 seconds there
 * is LITERALLY NOTHING TO SHOW, so the VA swirls the mouse pointer around an
 * idle screen and the finished video looks broken. Owner's words: "there's an
 * intro and weird stuff, blah blah blah, where the virtual assistant is just
 * swirling his mouse pointer around and our visualization looks like shit."
 *
 * So the governing rule, above all others, is: every second of script must
 * correspond to something that can be shown on screen. NO_PRESENTER_RULE states
 * it, and every other block is written to be consistent with it.
 *
 * There is no AI-narrator / avatar intro pipeline. Do not write for one.
 */

/* ────────────────────────────────────────────────────────────────────────── */
/* Length tiers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The three genuinely different kinds of tutorial script. They are NOT the same
 * template scaled — the shape changes.
 *
 *   SHORT  — 3 to 6 minutes. "How to do one simple thing on a computer."
 *            Confirm the click in a sentence or two, do it, ask for the like /
 *            subscribe / "this was helpful" comment the moment the question is
 *            answered, and STOP. No outro, no recap.
 *   MEDIUM — around 8 minutes. Same no-presenter constraint, allowed to go
 *            deeper and carry genuinely useful extras. Still no padding.
 *   LONG    — around 14 minutes and up. A real introduction is justified here:
 *            what we'll cover, a longer click-confirm, and WHY the tutorial is
 *            ordered the way it is. Must stay watchable, never a list of steps
 *            read aloud.
 *
 * TIER → MODE MAPPING (documented per the owner's ask).
 * The tier is chosen from the EFFECTIVE TARGET DURATION, not from the mode
 * name, because several modes carry an explicit target:
 *
 *   THREE_MIN       → target 3  → SHORT
 *   SIX_MIN         → target 6  → SHORT
 *   SIX_MIN_STITCH  → target = target_minutes, else ref_video_seconds, else 6
 *                     → SHORT (<=6) / MEDIUM (7-10) / LONG (>=11)
 *   LONG_FORM       → target = target_minutes (default 40) → LONG
 *                     (its per-chapter expansion prompts also run as LONG: the
 *                     video is long even though one chapter is ~8 minutes, and
 *                     only chapter 1 carries the introduction.)
 *
 * Boundaries: <= 6 SHORT, 7-10 MEDIUM, >= 11 LONG. 6 is the top of the owner's
 * stated SHORT band ("3-6 minutes") and 11 is the first minute that is clearly
 * past "around 8".
 */
export type ScriptTier = "SHORT" | "MEDIUM" | "LONG";

/** Tier for an effective target duration in minutes. See ScriptTier docs. */
export function tierForMinutes(targetMinutes: number): ScriptTier {
  if (targetMinutes <= 6) return "SHORT";
  if (targetMinutes <= 10) return "MEDIUM";
  return "LONG";
}

/**
 * Section markers are only asked for on MEDIUM and LONG.
 *
 * On a 3-6 minute script, demanding "3 to 8 subtopic sections" actively fights
 * the SHORT shape: the model manufactures sections to fill the quota, which is
 * the padding the owner is trying to remove. Short videos also cannot carry
 * YouTube chapters usefully. Callers use this to decide whether a missing
 * structure is worth warning about.
 */
export function tierExpectsMarkers(tier: ScriptTier): boolean {
  return tier !== "SHORT";
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Rule blocks                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * THE format rule. Highest priority, stated first in every prompt.
 * See the module header for why this exists.
 */
export const NO_PRESENTER_RULE = [
  "THE FORMAT — READ THIS FIRST. IT OVERRIDES EVERY OTHER INSTRUCTION, INCLUDING THE PRESET.",
  "This video is a SCREEN RECORDING and nothing else. There is NO presenter, NO host, NO face",
  "on camera, NO talking head, NO studio, NO b-roll, NO stock footage, NO graphics, NO",
  "animation and NO cutaways. One person records their computer screen while your words are",
  "spoken over the top. The only thing the viewer ever sees is the software you are describing,",
  "live, being operated.",
  "THEREFORE: every single sentence you write must have something happening on screen while it",
  "is spoken — a click, a menu opening, a field being typed into, a toggle flipping, a page",
  "loading, a result appearing, a screen being read. Before you keep a sentence, ask: what is",
  "on screen while this is said? If you cannot answer, DELETE THE SENTENCE.",
  "Absolutely forbidden, because there is nothing to show while they are spoken:",
  '  - greetings and welcomes of any kind: "hey guys", "hi everyone", "welcome back",',
  '    "what\'s up", "hope you\'re doing well".',
  "  - anything about the channel, the creator, the series, or other videos.",
  '  - "in today\'s video", "in this video", "in this tutorial", "by the end of this video",',
  '    "we\'re going to explore", "let\'s dive in", "stick around", "before we start".',
  '  - rhetorical warm-ups: "have you ever", "if you\'ve ever", "we\'ve all been there",',
  '    "let\'s face it", "picture this".',
  "  - general theory, industry context, opinions, or benefits that are not attached to",
  "    something visible on the screen at that exact moment.",
  "  - anything that implies a camera, a person, a set, an edit, a cut, or a graphic:",
  '    "as you can see behind me", "let me show you a diagram", "here\'s a quick animation".',
  "  - telling the viewer to pause, rewind, or check the description or a pinned comment.",
  "You are narrating a live screen. Talk about the screen, and only about the screen.",
  "PACE FOR A HUMAN OPERATOR: the person recording has to actually perform each action while",
  "your words play. Never stack three or four clicks into one sentence — they will fall",
  "behind. One action per sentence, and give the slow ones (a page loading, a sync running, a",
  "file exporting) a sentence of their own so the recording has something to sit on.",
].join("\n");

/**
 * Output-only-spoken-words guard, shared by every prompt.
 *
 * `script_text` goes STRAIGHT into a TTS voice with no human in between, so
 * every character survives into the audio. `sanitizeScriptText` strips markdown
 * as defence-in-depth (and is deliberately NOT weakened), but the fix belongs
 * here: the model should never emit the junk in the first place. This list is
 * intentionally wider than the sanitiser — the sanitiser cannot remove "Step 1:"
 * or "(clicks Save)" without rewriting the spoken words, which it must never do.
 */
export const TTS_OUTPUT_RULE = [
  "OUTPUT — the text you produce is fed DIRECTLY into a text-to-speech voice. No human edits",
  "it first. EVERY character you type gets spoken out loud. Output the spoken words and",
  "nothing else.",
  "NEVER emit any of these:",
  "  - markdown of any kind: **bold**, *italics*, _underscores_, `backticks`, code fences,",
  "    # headings, > quotes, --- rules, or [text](links).",
  "  - headings, titles, section names, or a title line at the top of the script.",
  '  - numbered or bulleted lists. No "1." or "2)", no dashes, no bullets. Write a sequence',
  "    as ordinary sentences.",
  '  - step labels of any kind: never "Step 1:", "Step one:", "First step:", "Part 2",',
  '    "Chapter 3", "Section:", "Intro:", "Outro:".',
  "  - stage directions, cues or parenthetical actions: no (clicks the button), no (pause),",
  "    no [pause], no [music], no (screen shows the dialog), no editing or camera notes.",
  '  - speaker labels: no "Narrator:", no "Voiceover:", no name before a line.',
  "  - timestamps, word counts, emoji, ASCII art, or any note addressed to the editor,",
  "    the recorder, or the reader.",
  "  - raw URLs, file paths or anything with slashes, dots or colons that would be read out",
  '    character by character. Say it the way a person says it out loud: "go to zapier dot',
  '    com" — never "https://zapier.com/apps/new".',
  "  - numbers, dates, money and symbols written the way they look on screen rather than the",
  '    way they are said. Write "the fifteenth of May", not "2025-05-15". Write "fifteen',
  '    hundred dollars", not "$1,500". Write "ninety percent", not "90%". Anything a voice',
  "    would stumble over gets spelled out in words.",
  "  - talk ABOUT the script itself. Never mention the ask, the like or the subscribe before",
  '    you get there, never say "at the end of this video", "as I mentioned earlier", "in this',
  '    section", "first let\'s", or anything else that describes the structure instead of doing',
  "    it. The viewer is watching a screen, not reading an agenda.",
  "Write button, menu, tab and setting names as plain words inside the sentence: click",
  "Automations in the left sidebar — NOT click **Automations**, NOT click [Automations].",
  "LAYOUT: write in flowing PARAGRAPHS of continuous prose, several sentences each. Never put",
  "each action on its own line. A stack of one-line instructions is a numbered list with the",
  "numbers taken off — it reads as a checklist being recited and it is exactly what we are not",
  "making. Use blank lines only to separate paragraphs.",
  "Do not write a preamble, an acknowledgement, or a note about what you are about to write.",
  "Your first character is the first spoken word and your last character is the last spoken",
  "word.",
].join("\n");

/**
 * OPENING — tier-dependent.
 *
 * The whole defect the owner reported lives here. SHORT gets a hard one-or-two
 * sentence ceiling with an explicit word budget, because "keep it short" alone
 * reliably produces four sentences of throat-clearing.
 */
export function buildOpeningRule(tier: ScriptTier): string {
  if (tier === "SHORT") {
    return [
      "OPENING — SAY WHAT THE VIDEO IS, THEN GO. 15 TO 40 WORDS.",
      "",
      "Sentence one states the task plainly, in the words the viewer searched for. Do not be",
      "clever about it and do not avoid it — every professional tutorial opens this way, and",
      "the viewer needs one beat of confirmation that they clicked the right thing.",
      "Then move. By your THIRD sentence at the latest they are performing a real action.",
      "",
      "Copy the register of these. They are transcripts of tutorials that actually work:",
      "  \"Today I'm going to show you exactly how to use Gmail even if you're a complete",
      "   beginner. Let's jump in. So first we're going to just head over to mail.google.com.\"",
      "  \"We'll guide you through how to fix Wi-Fi connected but no internet on Android. This",
      "   can be frustrating because you want to use your phone properly. So to get started,",
      '   you want to swipe up on your device."',
      '  "Today we are going to learn how to use Microsoft Excel in just 15 minutes. Excel is',
      "   the perfect tool to get insights from your data, but there are so many menus and",
      "   buttons. What do they all do? Let's start with how you can even get Excel.\"",
      "",
      "Notice what those do: plain spoken sentence, no flourish, no metaphor, no dash used as",
      "a dramatic pause, and the screen is moving within a couple of lines. Optionally ONE",
      'short line naming why the viewer cares ("this can be frustrating because...").',
      "",
      'BAD, and both of these are ours: "You looked up how to track mileage in Expensify — and',
      'this is the exact walkthrough." (mind-reads the viewer, dash-as-pause, "exact',
      'walkthrough" is ad copy) and "Mileage lives on the Expenses page." ("lives on" is',
      'written English; a person says "mileage is on the Expenses page").',
      "BAD: \"Hey everyone and welcome back to the channel, in today's video we're going to be",
      "taking a look at... and by the end you'll know exactly how to do it. Let's dive in.\"",
      "",
      'No channel talk, no "welcome back", no promise of what they will know by the end, no',
      "warm-up question, no listing what the video will cover. Say the thing, then do it.",
    ].join("\n");
  }
  if (tier === "MEDIUM") {
    return [
      "OPENING — CONFIRM THE CLICK. TWO OR THREE SENTENCES, 40 TO 60 WORDS.",
      "Restate the exact thing the viewer searched for so they know they are in the right",
      "place, name where in the tool it happens, and — only if it genuinely changes what they",
      "do — name which route you are taking and why it is the right one. Then start.",
      'Still no greeting, no channel talk, no "in this video", no promise of what they\'ll know',
      "by the end, no warm-up question. There is nothing on screen during any of that.",
      "By your fourth sentence at the latest, the viewer is performing the first real action.",
    ].join("\n");
  }
  return [
    "OPENING — A REAL INTRODUCTION, EARNED BY THE LENGTH. Roughly 60 to 90 seconds.",
    "A long tutorial justifies a proper introduction. It is still spoken over a screen",
    "recording, so every part of it must be delivered while something real is on screen. Write",
    "it in this order and make what is on screen obvious from your words:",
    "  1. CONFIRM THE CLICK, properly. Restate exactly what the viewer searched for, and what",
    "     they will be able to do by the end. Screen: the finished result, already built,",
    "     being looked at.",
    "  2. SHOW THE DESTINATION. Walk through the finished thing while it is on screen — the",
    "     working automation firing, the completed board, the exported file opening. Point out",
    "     the two or three parts of it that matter.",
    "  3. WHAT WE COVER AND WHY IN THIS ORDER. Name the main stages in one flowing passage and",
    "     say WHY the tutorial is built that way: what has to exist before what, which stage",
    "     people get wrong, what can be skipped by someone who already has one piece in place.",
    "     Screen: the app's main view, or each area being briefly opened as you name it.",
    "This is the part long tutorials get wrong: they read a table of contents aloud. Do not.",
    "It must be prose someone actually wants to keep watching, and every sentence of it must",
    "have the screen doing something. Never greet the viewer, never mention the channel, never",
    'say "in this video".',
  ].join("\n");
}

/**
 * The walkthrough IS the video. Steps in real time, in performance order, depth
 * attached to the step it belongs to — otherwise the recorder runs out of things
 * to demonstrate while the audio keeps talking.
 */
export function buildWalkthroughRule(tier: ScriptTier): string {
  const base = [
    "WALKTHROUGH — this is the BODY of the video and the reason it exists. After the opening,",
    "walk the viewer through the whole task in real time, taking the steps ONE AT A TIME in",
    "the exact order they perform them. Someone following along on their own screen must be",
    "able to keep up without pausing.",
    "For EACH step, in this order:",
    "  1. Say exactly what to do — the real button, menu path, field, tab or setting name, and",
    "     where on screen it is (left sidebar, top right, under the three-dot menu).",
    "  2. Say what they should SEE happen once they do it, so they can confirm they are on",
    "     track: the panel that opens, the toggle that turns green, the row that appears, the",
    "     spinner that finishes.",
    "  3. THEN, still on that same step, give the depth that belongs to it: why it works this",
    "     way, the mistake people make right here and how to avoid it, the default worth",
    "     changing, the faster alternative, the edge case that bites.",
    "Then move to the next step and do the same. Depth is woven INTO the walkthrough, step by",
    "step — it is never saved up and dumped at the end.",
    "NEVER merge several steps into one summary sentence, and NEVER skip ahead. If a step has",
    "a sub-step or a choice to make, cover it where it happens.",
    "Everything you say here is anchored to the screen. If a piece of depth has nothing",
    "visible attached to it, cut it — there is no b-roll to cover it.",
  ];
  if (tier === "SHORT") {
    base.push(
      "SHORT VIDEO: show what to do, explain a little, get to the point. Every step still gets",
      "all three parts above — the action, what appears on screen, and one short piece of why",
      "or what goes wrong here. That is what makes it a tutorial instead of a list of clicks",
      "read out loud, and it is the difference between a usable video and a 60-second recital.",
      "Keep each of those tight — a sentence or so, woven into the step rather than a paragraph",
      "per click.",
      "If you genuinely run out of steps, go to the ask and end the script. Never invent extra",
      "material or extra sections to fill time. Explaining a step you are actually performing is",
      "not filler, though — that is the job, and it is the last thing to cut.",
    );
  } else {
    base.push(
      "If you are running out of steps before you are near the length target, go DEEPER on the",
      "steps you already have — a concrete worked example performed on screen, the gotcha, the",
      "alternative route clicked through. Do NOT switch into a stream of general tips,",
      "background theory, or advice that is not tied to a step the viewer is performing: there",
      "is nothing to show while you say it.",
    );
  }
  return base.join("\n");
}

/**
 * TEACHING SUBSTANCE — the tips, warnings and explanations.
 *
 * VA-reported 2026-08-05: "the scripts being generated are removing the tips and
 * tricks, things to be aware of etc." Konrad: "even though our new intro sounds
 * better, the overall script is missing the explanations and tips, which add
 * length and additional information and make the video more fluent and personal.
 * I say this goes for all lengths of videos."
 *
 * Why it disappeared: the depth requirement existed only as step 3 of
 * buildWalkthroughRule, and it was surrounded by prohibitions written to kill the
 * OLD padding defect — "no theory", "never invent extra tips", "there is no
 * extras section". Faced with "give depth" next to four bans, the model took the
 * safe route and stripped it. The two things were never the same: a saved-up tips
 * section at the end is padding; a warning spoken while the field it concerns is
 * on screen is the tutorial.
 *
 * So substance gets its own named, non-negotiable block, and the SHORT-tier bans
 * that fought it were narrowed to what they actually meant (no separate section,
 * no filler) instead of forbidding explanation outright.
 */
export function buildTeachingSubstanceRule(tier: ScriptTier): string {
  const base = [
    "TEACHING SUBSTANCE — this is what makes the video a tutorial instead of a list of clicks",
    "read aloud, and it is the reason someone subscribes instead of closing the tab.",
    "It is NOT padding and it is NOT an extras section. It lives INSIDE the step, spoken while",
    "that step is on screen.",
    "Every step carries at least one of the following, and the steps that matter carry two:",
    "  - WHY this choice matters. What the setting actually does and which option you would",
    "    pick. A viewer who performs a step without knowing why cannot adapt it to their own",
    "    situation, and that is the whole value of watching a person instead of reading docs.",
    "  - WATCH OUT FOR. The thing that goes wrong right here — the field people miss, the",
    "    default that breaks something later, the button that looks right and is not. Say it",
    "    BEFORE they perform the step, not after they have got it wrong.",
    "  - CONCRETE EXAMPLE. Real values entered on screen: a real file name, a real number, a",
    '    real date. Never "fill in your details" — show what a good entry actually looks like.',
    "  - FASTER WAY. The keyboard shortcut, the second route to the same command, the bulk",
    "    version. Name it where it applies and perform it.",
    "  - WHAT IF IT LOOKS DIFFERENT. Where this lives on an older version or a different plan,",
    "    when there genuinely is a difference worth naming.",
    "This is also where the video becomes personal: these are YOUR warnings and YOUR",
    "preferences, in the first person. It is the part a help page cannot copy.",
    "The only hard limit is the screen. If a piece of substance has nothing visible attached to",
    "it, it is talk over a frozen picture — attach it to the step it belongs to, or cut it.",
  ];
  if (tier === "SHORT") {
    base.push(
      "AT THIS LENGTH: keep each piece to a sentence or two, woven into the step — not a",
      "paragraph per click. Short does NOT mean stripped. A three-minute video with no reasons",
      "and no warnings is exactly the one a viewer closes, and it is the defect being fixed",
      "here. Tight, not absent.",
    );
  } else {
    base.push(
      "AT THIS LENGTH: give the steps that matter a real explanation — several sentences and a",
      "worked example performed on screen. This is where the extra runtime legitimately comes",
      "from, and it is the FIRST thing to reach for when a script is running short. Going",
      "deeper on a real step always beats adding another section.",
    );
  }
  return base.join("\n");
}

/**
 * CLOSING VALUE — the tips segment near the end, and why it is not padding.
 *
 * Konrad, 2026-08-05: "We can put the tips and tricks more towards the end. I
 * just have to prevent the user from being unsatisfied and watching another
 * video on the same topic after watching our video. It's basic SEO."
 *
 * That is search satisfaction. A viewer who finishes our video, still has the
 * obvious follow-up question and goes back to YouTube to ask it tells the
 * platform our video did not answer the query — and the video that answers the
 * follow-up outranks us. Per-step depth alone does not prevent that, because it
 * only covers the steps we chose to perform.
 *
 * This is deliberately NOT the 2026-07-30 padding defect. That one was "rush the
 * steps in the first 20%, then fill the runtime with general tips". The
 * difference is enforced here: this segment exists only AFTER the walkthrough is
 * complete, must carry NEW material, and is still performed on screen.
 */
export function buildClosingValueRule(tier: ScriptTier): string {
  const base = [
    "BEFORE THE ASK — CLOSE THE LOOP SO THEY DO NOT GO AND WATCH SOMEBODY ELSE.",
    "Once the task is done and visibly working, cover the things this viewer predictably wants",
    "NEXT. This is a ranking requirement, not a nicety: if they finish our video and",
    "immediately open another video on the same topic, the platform reads that as our video",
    "not having answered the question, and the one that did answer it takes the position.",
    "Answer the follow-up before they leave to go looking for it.",
    "Choose the ones that genuinely apply to this topic:",
    "  - The obvious next question — the thing they will hit five minutes from now.",
    "  - The variation they will need: in bulk, on mobile, on the free plan, for a whole team,",
    "    or on the version where this lives somewhere else.",
    "  - The most common way people break this afterwards, and how to undo or fix it.",
    "  - The setting worth changing now that they know where it lives.",
    "  - The genuinely faster route, now that they have done it the clear way once.",
    "HOW IT MUST BE WRITTEN:",
    "  - Every item is NEW information. This is not a recap and not a summary — never restate",
    "    a step you already performed, and never say what the video covered.",
    "  - Every item is still performed on screen, exactly like a step. If you cannot show it,",
    "    it does not go in.",
    "  - Concrete and specific: the real menu, the real value, the real error. A vague tip",
    '    ("remember to stay organised") is worse than no tip at all.',
    "  - It comes AFTER the walkthrough is complete, never instead of teaching a step properly.",
    "    If the steps were rushed to make room for this, you have written the wrong video.",
  ];
  if (tier === "SHORT") {
    base.push(
      "AT THIS LENGTH: two or three items, a sentence or two each. Tight and fast — it should",
      "feel like a bonus, not a second video bolted on.",
    );
  } else {
    base.push(
      "AT THIS LENGTH: three to five items, each properly shown. This is a real segment of the",
      "video and it is often the most shared part of it.",
    );
  }
  return base.join("\n");
}

/**
 * The VA's own instructions for this specific video (`tutorial_jobs.steps_input`
 * — the text box on the Create form).
 *
 * These used to be concatenated onto the preset and passed in as
 * `baseInstructions`, which the prompt then framed as "follow it for TONE,
 * EXPERTISE and TOPIC only" and declared overridden "without exception". A VA
 * asking for tips and things to watch out for was making a STRUCTURAL request —
 * precisely the category that framing discards. They reported it as "it ignores
 * what I type in the box", and they were right.
 *
 * Now it is its own block with a stated rank: above the preset and above the
 * defaults, below THE FORMAT. The format exception is not negotiable — a VA
 * cannot ask for a presenter intro into a video that has no presenter.
 */
export function buildVaInstructionsBlock(
  vaInstructions?: string | null,
): string[] {
  const text = vaInstructions?.trim();
  if (!text) return [];
  return [
    "----- WHAT THE PERSON PRODUCING THIS VIDEO ASKED FOR -----",
    text,
    "----- END -----",
    "That block was written by the person who commissioned this video, for this exact topic.",
    "It OUTRANKS the PRESET and it outranks the default structure, pacing and length guidance",
    "above. If the VA asks for tips, warnings, examples, extra explanation or more detail, you",
    "MUST include them — even where a rule above tells you to keep things lean. Treat it as the",
    "brief, not as a suggestion. Where they name steps, follow their order and use their",
    "wording for button, menu and setting names.",
    "They cannot override THE FORMAT rules at the top: this is still a screen recording with no",
    "presenter, so anything they ask for still has to be delivered while something real is",
    "happening on screen, and the output is still nothing but spoken words.",
  ];
}

/**
 * Explicit runtime budget. Without a stated share the model front-loads the
 * procedure and pads the remainder; naming the percentages is what actually
 * holds the shape.
 */
export function buildPacingRule(tier: ScriptTier): string {
  if (tier === "SHORT") {
    return [
      "PACING — this script is almost entirely walkthrough. Budget:",
      "  - Opening / click-confirm: 5% at most.",
      "  - Step-by-step walkthrough on screen, INCLUDING the teaching substance woven into each",
      "    step (the why, the warning, the example): 75 to 85%.",
      "  - Closing value segment — the next questions, answered: about 10%.",
      "  - The like / subscribe / comment ask at the end: about 5%.",
      "The per-step explanations are NOT a separate section; they live inside the steps. The",
      "closing value segment IS a short separate segment, and it is the only one.",
      "If every step has been taught properly and the obvious follow-ups are answered and you",
      "still have runtime left, the video is simply shorter. That is the right outcome. A thin",
      "walkthrough is not.",
    ].join("\n");
  }
  if (tier === "MEDIUM") {
    return [
      "PACING — spread the material across the WHOLE runtime. Budget:",
      "  - Opening / click-confirm: about 5%.",
      "  - Step-by-step walkthrough: 75 to 80% — the clear majority of the video.",
      "  - Closing value segment — the next questions, answered (the alternative method, the",
      "    adjacent setting, what to do when it goes wrong) — each one still performed on",
      "    screen: 15% MAX.",
      "  - The ask at the end: about 5%.",
      "The worst failure mode, and the one to actively avoid: rushing the steps in the first",
      "10-20% and filling the rest with general tips. If the steps are done and most of the",
      "runtime is still ahead of you, you paced it wrong — teach each step properly instead.",
    ].join("\n");
  }
  return [
    "PACING — spread the material across the WHOLE runtime. Budget:",
    "  - Introduction (click-confirm, the finished result on screen, what we cover and why):",
    "    8 to 10%.",
    "  - Step-by-step walkthrough: about 75% — the clear majority of the video.",
    "  - Closing value segment — the next questions, answered, each still performed on",
    "    screen: 10% MAX.",
    "  - Close plus the ask: 5 to 7%.",
    "The worst failure mode, and the one to actively avoid: rushing the steps early and",
    "filling the rest with general tips. If the steps are done and most of the runtime is",
    "still ahead of you, you paced it wrong — teach each step properly instead.",
  ].join("\n");
}

/**
 * THE ASK, and how the script ends.
 *
 * SHORT ends ON the ask — no recap, no outro, no "in this video we learned".
 * The comment request is explicit and named ("say it was helpful") because the
 * owner wants comments specifically: they move the algorithm.
 */
export function buildAskAndEndingRule(tier: ScriptTier): string {
  const ask = [
    "  - a like,",
    "  - a subscribe,",
    "  - and a COMMENT saying it was helpful. Ask for that one explicitly and plainly, for",
    '    example: "and leave a comment saying this was helpful — comments are what push this',
    '    to other people looking for the same thing".',
  ];
  if (tier === "SHORT") {
    return [
      "THE ASK, THEN STOP — this is how the script ENDS. There is no outro.",
      "The order at the end is: finish the last step, then the closing value segment described",
      "above, then the ask. Nothing after the ask.",
      "Finish that last step with one sentence naming what they are looking at, deliver the",
      "closing value items, then ask for three things in one short natural passage:",
      ...ask,
      "Two or three sentences, warm, not begging.",
      "THEN STOP. The final sentence of that ask is the final sentence of the script.",
      'FORBIDDEN, all of it: a summary, a recap, "so that\'s how you", "in',
      'this video we learned", a list of what was covered, a plug for your other videos,',
      '"thanks for watching", or any sign-off paragraph. Every one of those is dead air with',
      "nothing on screen. Answering a NEW follow-up question is not a recap — restating what",
      "you already did is. The script ends on the ask.",
    ].join("\n");
  }
  if (tier === "MEDIUM") {
    return [
      "THE ASK, THEN STOP — this is how the script ENDS. There is no outro.",
      "Any genuinely useful extras go BEFORE the ask, never after, and each one is performed on",
      "screen like any other step. Once the viewer's question is fully answered and everything",
      "worth showing has been shown, finish with one sentence naming what is on screen now,",
      "then ask for three things in one short natural passage:",
      ...ask,
      "Two or three sentences, warm, not begging. THEN STOP — that ask is the last thing in the",
      'script. No recap, no summary, no "in this video we covered", no sign-off paragraph.',
    ].join("\n");
  }
  return [
    "CLOSE AND THE ASK — how the script ends.",
    "A video this long may close properly, but briefly and over something real on screen (the",
    "finished result, still open). At most three sentences: confirm the viewer can now do the",
    "task, naming it, and — if it genuinely helps — one concrete next thing worth doing inside",
    "the same tool. No list of everything that was covered.",
    "Then ask for three things in one short natural passage:",
    ...ask,
    "The ask is the last thing in the script. Always finish your final sentence completely;",
    "never trail off mid-thought.",
  ].join("\n");
}

/**
 * Section markers — the ONLY non-spoken thing the writer may emit, and only on
 * MEDIUM/LONG (see tierExpectsMarkers).
 *
 * `script_text` is one flat column, so nothing downstream can know where a
 * subtopic starts — the blocker for chapters, subtopic banners and per-section
 * QA alike. `extractScriptStructure` strips every marker before the text reaches
 * TTS (see script-structure.ts), so the spoken audio is unchanged.
 */
export function buildStructureMarkerRule(tier: ScriptTier): string {
  if (!tierExpectsMarkers(tier)) return "";
  return [
    "SECTION MARKERS — the ONE exception to the no-brackets rule above.",
    "Alongside the spoken words, mark where each part of the video begins. Put each marker",
    "ALONE on its own line, with a blank line before and after it, and NEVER inside a",
    "sentence. They are stripped out before the narration is recorded, so they change nothing",
    "about how the script sounds. They are the only bracketed text allowed anywhere.",
    "Use exactly these three forms, spelled exactly like this:",
    "  [[INTRO]]        — once, immediately before the opening.",
    "  [[SUBTOPIC: short plain name]] — before each distinct part of the walkthrough.",
    "  [[OUTRO]]        — once, immediately before the close.",
    "Give the video between 3 and 8 SUBTOPIC sections, in the order the viewer performs them.",
    "Each subtopic name is 2-6 plain words describing what gets DONE in that section (for",
    'example "Open the export settings", not "Introduction" or "Part 2"). It is shown to',
    "viewers as a chapter title, so make it concrete and searchable.",
    "EVERY subtopic section must contain at least one action the viewer actually performs on",
    "their screen. A section that is only commentary or theory is not a subtopic — fold that",
    "material into the step it belongs to, or cut it.",
    "Do not number the markers, do not invent other markers, and do not use square brackets",
    "anywhere else in the script.",
  ].join("\n");
}

/**
 * EEAT / net-information-gain. Deliberate gray-hat: fabricate plausible, useful
 * first-person lived detail so the script carries information a generic
 * competitor tutorial does not — but ONLY where it attaches to something on
 * screen, or it becomes exactly the untethered commentary this rewrite removed.
 */
export const EEAT_RULE = [
  "EXPERTISE — write as someone who has ACTUALLY USED this tool, not someone summarising a",
  "help page. Drop in concrete, specific detail that only hands-on use produces: real numbers,",
  "named settings and menu paths, the default worth changing, the value that works better than",
  "the one it ships with, the option that quietly breaks things later.",
  "HARD CONSTRAINT: every piece of that detail must be attached to something visible at that",
  'moment — the field you are pointing at, the setting you are changing. "The default quality',
  'slider sits at 80, but set it to 92" is perfect, said while the slider is on screen. A',
  "story about a project last year, an anecdote, or a general observation with nothing on",
  "screen is NOT allowed — there is no footage to put under it.",
  "Be decisive and opinionated: name the better option, say what to skip and why. Never hedge",
  'with "I think this might" or "you could maybe". Keep every invented detail plausible and',
  "internally consistent — never contradict how the tool actually works.",
].join("\n");

/** Human voice: contractions, varied rhythm, personality — not a manual read aloud. */
/**
 * The anti-AI voice rule.
 *
 * Every line here comes from the owner comparing our output against transcripts
 * of tutorials that actually perform (a 15-minute Excel course, a Gmail
 * walkthrough, two short fix-it videos). His verdict on ours: "They both really
 * do seem like AI."
 *
 * The through-line: a model writes for the eye and hedges toward neutrality. A
 * person talking over their own screen writes for the ear and has opinions. Most
 * of what reads as "AI" is not vocabulary, it is the ABSENCE of what a real
 * person does — preferences, friction, fragments, uneven rhythm.
 */
export const HUMAN_VOICE_RULE = [
  "VOICE — you are a competent person talking to ONE other person while showing them your",
  "screen. Not a manual. Not a narrator. Everything below is how that actually sounds.",
  "",
  "WORDS THAT GIVE YOU AWAY — never use any of these:",
  "  delve, unlock, unleash, harness, revolutionize, streamline, leverage, utilize, ensure,",
  "  empower, facilitate, robust, seamless, crucial, vital, intricate, dynamic,",
  "  comprehensive, effortless, game-changer, elevate.",
  "  Furthermore, moreover, consequently, additionally, in conclusion, in summary,",
  "  ultimately, that said, it is worth noting, needless to say.",
  "  'Let’s dive in' is banned. ('Let’s jump in' is fine — that is how people talk.)",
  "  Never open with 'Here’s the thing' or 'The good news is'.",
  "  Never use a dash as a dramatic pause. If you want a beat, start a new sentence.",
  "",
  "WRITE FOR THE EAR:",
  "  - Contractions, always. you don’t, it’s, we’re. 'I’m gonna show you' is fine.",
  "  - Fragments are good. 'Not ideal.' 'Let’s fix that.' 'Moving on.' 'Real big button.'",
  "  - Start sentences with And, But, So, Now, Okay. Constantly. That is how speech runs.",
  "  - Say it the way you would out loud: 'mileage is on the Expenses page', never",
  "    'mileage lives on the Expenses page'.",
  "",
  "HAVE AN OPINION. This is the biggest single difference between a person and a model.",
  "  A model stays neutral and lists both options. A person tells you which one to use.",
  "  BAD:  'There are two ways to do this. The first method is...'",
  "  GOOD: 'There are two ways to do this. I never use the first one, it’s unreliable.'",
  "  Say what you prefer, what you skip, and what you think is badly designed.",
  "",
  "SHOW THE FRICTION. A model assumes every step works. Software does not.",
  "  Name the actual error text when there is one. Say where YOU get it wrong:",
  "  'I always forget to tick this, and then the whole thing fails on save.'",
  "  Anticipating the mistake is worth more than describing the success.",
  "",
  "VARY THE RHYTHM. A model writes every sentence the same length and it drones.",
  "  Long winding sentence for the fiddly technical bit, then a short one. Like this.",
  "",
  "SPEAK AS 'I', TO 'YOU'. This is required, not decorative.",
  "  You are a real person who has done this task before. Say so. The viewer is one",
  "  person you are talking to, and they are 'you', never 'users' or 'we' or 'one'.",
  "  Use 'I' when it carries something real: your preference, your habit, your warning.",
  "    'I always set the rate before the description, because...'",
  "    'I would not use the manual option here.'",
  "    'I have had this fail on save when the tag is missing.'",
  "  A script with no 'I' in it reads as a manual no matter how good the words are, and",
  "  the platform rewards the one that sounds like a person who actually did the thing.",
  "",
  "AUTHENTIC, BUT PROFESSIONAL. This is a working tutorial, not a personality showcase.",
  "  NO jokes, no puns, no quips, no bits, no sarcasm, no cute asides about yourself.",
  "  NO invented backstory, no anecdotes that did not happen, no fake statistics.",
  "  The 'I' earns its place by being USEFUL — an opinion, a habit, a warning, a",
  "  preference between two real options.",
  "  If a sentence starting with 'I' teaches the viewer nothing, cut it.",
  "  GOOD: 'I always double-check the rate here, it is the field that gets things",
  "  rejected.'  BAD: 'I have to admit, spreadsheets are not my favourite thing.'",
  "",
  "NEVER summarise what you just said, and never announce what you are about to say.",
].join("\n");

/** Semantic coverage for SEO — natural, never stuffed, never an excuse to pad. */
export function buildSeoRule(tier: ScriptTier): string {
  if (tier === "SHORT") {
    return [
      "SEARCH WORDS — say the exact thing the viewer searched for in your first sentence, in",
      "plain natural English, and once more naturally while you are doing it. That is enough.",
      "Do NOT add extra subtopics, related tools, or adjacent terms for search reasons. On a",
      "short video that is padding, and padding is the thing we are removing.",
    ].join("\n");
  }
  return [
    "COVERAGE — cover the topic and the subtopics a viewer expects around it: the closely",
    "related steps, the obvious alternative method, the adjacent settings that naturally come",
    "up — each one demonstrated on screen, never just mentioned. Hit the target keyword and",
    "its natural variants often, but ALWAYS the way a person actually talks, never stuffed.",
    "Depth beats breadth: include a subtopic only if it carries real value AND can be shown.",
  ].join("\n");
}

/** Uniqueness — beat gist/duplicate detection with fresh everything. */
export const UNIQUENESS_RULE = [
  "UNIQUENESS — this script must be substantially your own. Never copy phrasing, sentence",
  "structure, or step ordering from any source or any typical tutorial on this topic. Use",
  "fresh examples, a fresh order where it makes sense, and your own analogies. If a phrasing",
  "feels like the obvious one everyone uses, choose a different one.",
].join("\n");

/**
 * Build the LENGTH line shared by every prompt.
 */
export function buildLengthLine(
  targetMinutes: number,
  allowLonger: boolean,
  tier: ScriptTier = tierForMinutes(targetMinutes),
): string[] {
  const targetWords = Math.round(targetMinutes * WORDS_PER_MINUTE);
  if (allowLonger) {
    return [
      `LENGTH — let the TOPIC set the length. Aim for AT LEAST about ${targetMinutes} minutes`,
      `(~${targetWords} words); a rich topic may run longer and will be split into parts. But`,
      "never stretch a thin topic to get there — a complete, non-padded script is always better",
      "than a padded one.",
    ];
  }
  if (tier === "SHORT") {
    // The floor is PROPORTIONAL to the chosen length, not a constant.
    //
    // It used to be a hardcoded "about 3 minutes / 450 words" for every SHORT
    // job, and the next line told the model outright that "a simple task
    // answered in three minutes is the CORRECT outcome". THREE_MIN and SIX_MIN
    // both resolve to this tier, so a VA who picked 6-Minute Tutorial got a
    // prompt whose stated floor, and whose stated ideal, were three minutes.
    // The model obeyed and wrote ~450-550 words. VAs reported it as "6-minute
    // mode only generates 2-3 minutes"; they were right, and the prompt was
    // the reason.
    //
    // 80% of target: 6 min → a 5-minute floor (750 words), 3 min → unchanged
    // at 3 minutes / 450 words, so THREE_MIN behaviour is exactly as before.
    const floorMinutes = Math.max(3, Math.round(targetMinutes * 0.8));
    const floorWords = floorMinutes * WORDS_PER_MINUTE;
    // Ceiling in MINUTES and ceiling in WORDS must describe the same number.
    // They did not: the minute ceiling was `max(4, target)` while the word
    // ceiling stayed `target * 150`, so a 3-minute job read "between about 3
    // and 4 minutes (roughly 450 to 450 words)" — a range whose two halves
    // contradict each other, in the one instruction whose whole job is to be
    // unambiguous about length.
    const ceilingMinutes = Math.max(4, targetMinutes);
    const ceilingWords = ceilingMinutes * WORDS_PER_MINUTE;
    return [
      `LENGTH — between about ${floorMinutes} and ${ceilingMinutes} minutes`,
      `(roughly ${floorWords} to ${ceilingWords} words). A human chose ${targetMinutes} minutes for`,
      "this specific topic, so treat the range as their instruction rather than a suggestion.",
      "The upper number is a CEILING, not a goal. The lower number is a FLOOR.",
      `Under about ${floorWords} words you have not written a ${targetMinutes}-minute tutorial, you`,
      "have written a list of clicks — it means you skipped saying what appears on screen after",
      "each action and skipped the one thing that goes wrong at each step. Go back and put those in.",
      "Reach the floor by explaining what is happening on screen, NEVER by adding an intro, an",
      "outro, a recap, general tips or extra sections. If the topic genuinely cannot fill the",
      "floor without padding, say so by writing a complete shorter script — but that is a last",
      "resort, not the default, and it is NOT what a thin walkthrough of the same steps is.",
    ];
  }
  // MEDIUM/LONG used to get one soft line here while SHORT got a floor, a
  // ceiling, a word range and instructions. On the first real generation run a
  // 20-minute target produced 4,366 words (29 minutes) and a 40-minute
  // long-form produced 8,059 (54 minutes) — the teaching-substance and
  // closing-value blocks push for more material, and a single "MAX" could not
  // hold against them. The ceiling is now stated with the same force as SHORT's.
  const floorMinutes = Math.max(2, Math.round(targetMinutes * 0.8));
  const floorWords = floorMinutes * WORDS_PER_MINUTE;
  return [
    `LENGTH — between about ${floorMinutes} and ${targetMinutes} minutes`,
    `(roughly ${floorWords} to ${targetWords} words).`,
    `${targetWords} words is a HARD CEILING, not a goal. A human chose ${targetMinutes} minutes`,
    "for this specific topic. A script that runs half again as long is a different video from",
    "the one they asked for, and someone has to sit and record every extra minute of it.",
    "Overshooting is not generosity.",
    "If you are near the ceiling and still have material, CUT the least valuable step or the",
    "weakest closing item rather than running past it. Real depth on fewer things always beats",
    "thin coverage of everything.",
    "Let the TOPIC set the length within that range: only approach the ceiling if the topic",
    "honestly has that much worth teaching AND showing.",
  ];
}

/**
 * LENGTH line for the sub-3-minute ADAPTIVE modes (SHORT_MATCH, SHORT_PLUS).
 *
 * Why this exists instead of reusing `buildLengthLine`'s SHORT branch: that
 * branch floors its printed band at `Math.max(3, …)` minutes / `Math.max(4, …)`
 * for the ceiling, because it was written for THREE_MIN / SIX_MIN, which are
 * never under three minutes. Passing it a 2-minute target still prints "between
 * about 3 and 4 minutes" — the exact floor we are trying to escape. So the
 * adaptive short modes get their own honest sub-3 band.
 *
 * The target is measured off the reference video's real runtime (see
 * `targetMinutesForMode`), not chosen from a menu. `spendExtraOnExamples` is set
 * for SHORT_PLUS, whose target is ~15% over the source: it directs that extra
 * runtime into worked examples and short explanations, never filler — the whole
 * reason the owner wants a "slightly longer" variant at all.
 */
export function buildShortAdaptiveLengthLine(
  targetMinutes: number,
  opts: { spendExtraOnExamples?: boolean } = {},
): string[] {
  const targetWords = Math.round(targetMinutes * WORDS_PER_MINUTE);
  // A tight band around the target — roughly ±15%, never floored up to 3 min.
  const lowWords = Math.round(targetWords * 0.85);
  const highWords = Math.round(targetWords * 1.15);
  const mins = targetMinutes % 1 === 0 ? targetMinutes.toFixed(0) : targetMinutes.toFixed(1);
  const lines = [
    "LENGTH — match the reference video you are based on. It ran roughly this long, and that",
    `is the runtime the market already rewards for this exact search, not a guess. Aim for about`,
    `${mins} minutes — about ${targetWords} words — and stay between roughly ${lowWords} and ${highWords} words.`,
    "Do not pad to stretch it and do not race to shorten it.",
    "Hit that length by TEACHING each step properly — say what appears on screen after every",
    "action, and the one thing that goes wrong right there. NEVER reach it with an intro, an",
    "outro, a recap, a general-tips section, or the same point said twice. If the task is",
    "genuinely complete in fewer words without padding, stop there — a complete shorter script",
    "always beats a padded one.",
  ];
  if (opts.spendExtraOnExamples) {
    lines.push(
      "You have a little more room than the bare clicks need — spend it, but ONLY on real",
      "teaching: one or two concrete worked examples performed on screen (real values typed into",
      "real fields, a real file name, a real number) and a short 'why this works' on the steps",
      "that matter. That extra teaching is the entire point of the few extra seconds. Restating,",
      "filler, or a second lap of the same point is not, and is worse than simply being shorter.",
    );
  }
  return lines;
}

/** The two adaptive sub-3-minute modes whose length tracks the reference video. */
export function isShortAdaptiveMode(mode: string): boolean {
  return mode === "SHORT_MATCH" || mode === "SHORT_PLUS";
}

/**
 * Assemble the rule stack every tutorial prompt shares, in priority order.
 * Exported so the transcript-rewrite prompt uses the identical stack and the two
 * can never drift.
 */
/**
 * Retention devices that are compatible with net information gain.
 *
 * The owner's framing: "Explanations and net information gain is important and
 * wanted. And we can be detailed. We just can't have the viewer click away."
 *
 * Those two pull against each other only if you assume detail is what loses
 * people. It is not — undifferentiated detail is. A viewer leaves when they
 * cannot tell whether the next thirty seconds are worth their time, so the
 * devices below all work by ANSWERING that question earlier, not by withholding
 * the answer. Every one of them pays the viewer immediately.
 *
 * Explicitly banned here are the retention tricks that trade the viewer's time
 * for watch time — "stay till the end", teasing something the video already
 * showed, or announcing structure instead of delivering it. Those raise
 * retention on a dashboard and lower it in the only place that matters.
 */
const RETENTION_RULE = [
  "HOLDING ATTENTION — you may and should use these. They cost no runtime:",
  '  - Name the trap BEFORE the step it belongs to: "this next field is where most people',
  '    get it wrong". The viewer now has a reason to watch that specific step.',
  "  - Say what will be on screen a beat before it appears, so the picture confirms your",
  "    words instead of racing them.",
  "  - Vary sentence length hard. Several long explanatory sentences, then a short one.",
  "    Monotone rhythm reads as filler even when the content is dense.",
  "  - When a step is genuinely boring but necessary, say so in three words and move —",
  "    acknowledging it costs less attention than pretending it is interesting.",
  '  - Give the reason WITH the instruction, not after it. "Pick the matching rate, because',
  '    the wrong one gets the whole expense rejected" holds; "pick the rate" does not.',
  "NEVER use these — they buy watch time by spending the viewer's:",
  '  - "Stay till the end", "we\'ll get to that in a moment", or any deferred payoff.',
  '  - Teasing something you already showed, or announcing structure ("first, let\'s...")',
  "    instead of simply doing it.",
  "  - Repeating a point in different words to fill time.",
].join("\n");

export function buildSharedRuleStack(
  tier: ScriptTier,
  opts: {
    markers?: boolean;
    /**
     * Include the OPENING rule. LONG_FORM middle and final chapters set this
     * false.
     *
     * This is the fix for the single worst long-form defect: every chapter used
     * to receive the full LONG opening rule — a detailed demand for a 60-90
     * second "REAL INTRODUCTION" — so every chapter was written as a standalone
     * mini-tutorial that introduced itself. positionGuidance said otherwise in
     * three lines and lost. Our own 45-minute video opened seven separate
     * segments with "In this walkthrough, you'll learn…".
     */
    opening?: boolean;
    /**
     * Include the closing value segment and the ask. Only the final chapter of
     * a LONG_FORM video does; otherwise every chapter signs off and re-lists
     * its own steps, which is exactly what that video did.
     */
    closing?: boolean;
  } = {},
): string[] {
  // LONG_FORM chapter expansions opt OUT: their text is written straight to the
  // child job's script_text and fed to TTS without passing through
  // extractScriptStructure, so a marker emitted there would be SPOKEN. Their
  // structure comes from the outline instead (structureFromParts).
  const marker = opts.markers === false ? "" : buildStructureMarkerRule(tier);
  const withOpening = opts.opening !== false;
  const withClosing = opts.closing !== false;
  return [
    NO_PRESENTER_RULE,
    ...(withOpening ? ["", buildOpeningRule(tier)] : []),
    "",
    buildWalkthroughRule(tier),
    "",
    buildTeachingSubstanceRule(tier),
    "",
    buildPacingRule(tier),
    "",
    RETENTION_RULE,
    ...(withClosing
      ? ["", buildClosingValueRule(tier), "", buildAskAndEndingRule(tier)]
      : []),
    ...(marker ? ["", marker] : []),
    "",
    EEAT_RULE,
    "",
    HUMAN_VOICE_RULE,
    "",
    buildSeoRule(tier),
    "",
    UNIQUENESS_RULE,
  ];
}

/**
 * Script prompt for the single-shot tutorial modes (THREE_MIN, SIX_MIN, and the
 * SIX_MIN_STITCH master).
 *
 * The operator's preset (a DB row in `tutorial_prompt_presets`, or a custom
 * prompt) is framed as reference for TONE / EXPERTISE / TOPIC only; everything
 * structural below overrides it. That framing matters more than it looks: the
 * live presets were written for a presenter-led video and literally instruct
 * "In today's video, I'm going to show you how to…" plus a recap at the end.
 * They have been rewritten too, but the override keeps any old or hand-written
 * preset from reintroducing the defect.
 */
export function buildAnswerFirstScriptPrompt(
  baseInstructions: string,
  targetMinutes: number,
  opts: {
    allowLonger?: boolean;
    tier?: ScriptTier;
    title?: string;
    /**
     * The VA's own text box (`steps_input`). Passed SEPARATELY from
     * `baseInstructions` on purpose — see buildVaInstructionsBlock.
     */
    vaInstructions?: string | null;
    /**
     * Pre-built LENGTH lines to use instead of `buildLengthLine`. The adaptive
     * sub-3-minute modes (SHORT_MATCH / SHORT_PLUS) pass a
     * `buildShortAdaptiveLengthLine` result here so the working THREE_MIN /
     * SIX_MIN branch of `buildLengthLine` is never touched.
     */
    lengthLineOverride?: string[];
  } = {},
): string {
  const tier = opts.tier ?? tierForMinutes(targetMinutes);
  const lengthLine =
    opts.lengthLineOverride ??
    buildLengthLine(targetMinutes, opts.allowLonger ?? false, tier);
  const title = opts.title?.trim();
  const vaBlock = buildVaInstructionsBlock(opts.vaInstructions);

  return [
    "You write the spoken narration for a screen-recorded software tutorial. You will be given",
    "a persona and topic (PRESET). Follow it for TONE, EXPERTISE and TOPIC only — the FORMAT",
    "and STRUCTURE RULES below OVERRIDE any structural, opening, closing, or length guidance",
    "inside it, without exception.",
    // The title is the video's headline — literally the phrase the viewer typed
    // into search before clicking. Until 2026-08-03 it was never sent to the
    // model at all on this path: the topic reached the LLM only by accident,
    // through whatever the VA happened to type into `steps_input`. The whole
    // "confirm the click" opening depends on knowing that exact phrase.
    ...(title
      ? [
          "",
          `VIDEO TITLE: ${title}`,
          "That title is the exact phrase the viewer searched for before clicking. Your opening",
          "confirms it back to them in natural spoken English — not word-for-word robotic, but",
          "unmistakably the same thing.",
        ]
      : []),
    "",
    "----- PRESET -----",
    baseInstructions,
    "----- END PRESET -----",
    "",
    "FORMAT AND STRUCTURE RULES (highest priority):",
    "",
    ...buildSharedRuleStack(tier),
    "",
    ...lengthLine,
    "Never pad, stall, or repeat to reach a length.",
    // Placed last of the content blocks on purpose: it has to win over the
    // defaults above it, and recency is the cheapest way to buy that in a long
    // prompt. Only the TTS output guard follows it.
    ...(vaBlock.length > 0 ? ["", ...vaBlock] : []),
    "",
    TTS_OUTPUT_RULE,
  ].join("\n");
}

/**
 * The length target (minutes) implied by a single-shot tutorial mode. VAs pick
 * the mode per topic; `target_minutes` (when set) overrides for STITCH totals.
 *
 * `refVideoSeconds` is the runtime of the reference video being rewritten — the
 * STITCH fallback target, so "beat this 18-minute video" produces an 18-minute
 * script instead of silently defaulting to 6. Fixed-length modes ignore it on
 * purpose: THREE_MIN means three minutes.
 */
export function targetMinutesForMode(
  mode: string,
  targetMinutesField: number | null | undefined,
  refVideoSeconds?: number | null,
): { targetMinutes: number; allowLonger: boolean; tier: ScriptTier } {
  const withTier = (targetMinutes: number, allowLonger: boolean) => ({
    targetMinutes,
    allowLonger,
    tier: tierForMinutes(targetMinutes),
  });
  switch (mode) {
    case "THREE_MIN":
      return withTier(3, false);
    case "SIX_MIN":
      return withTier(6, false);
    // Adaptive sub-3-minute modes: length is MEASURED off the reference video's
    // runtime, then clamped into a sub-3 band. SHORT_MATCH mirrors the source;
    // SHORT_PLUS runs ~15% longer, the extra spent on examples (see
    // buildShortAdaptiveLengthLine). Both fall back to the VA's typed
    // target_minutes, then to 2 min, when no reference runtime is known.
    case "SHORT_MATCH":
    case "SHORT_PLUS": {
      const baseMinutes =
        refVideoSeconds && refVideoSeconds > 0
          ? refVideoSeconds / 60
          : targetMinutesField && targetMinutesField > 0
            ? targetMinutesField
            : 2;
      const multiplier = mode === "SHORT_PLUS" ? 1.15 : 1;
      const floor = mode === "SHORT_PLUS" ? 1.75 : 1.5;
      const ceiling = mode === "SHORT_PLUS" ? 3.25 : 3;
      const clamped = Math.min(
        Math.max(baseMinutes * multiplier, floor),
        ceiling,
      );
      // Two decimals, not one: the clamp bounds (1.75, 3.25) are half-tenths,
      // and rounding to one decimal would push 3.25 up to 3.3 and past the
      // ceiling. The word count (target × 150) is rounded separately in the
      // length line.
      const targetMinutes = Math.round(clamped * 100) / 100;
      return { targetMinutes, allowLonger: false, tier: "SHORT" };
    }
    case "SIX_MIN_STITCH": {
      // Master gets chunked into ~6-min parts; rich topics legitimately run
      // longer, so seed from the VA's total target when they set one, then from
      // the reference video's own runtime, and only then from the 6-min floor.
      const fromRef =
        refVideoSeconds && refVideoSeconds > 0
          ? Math.max(6, Math.round(refVideoSeconds / 60))
          : 0;
      return withTier(
        targetMinutesField && targetMinutesField > 0
          ? targetMinutesField
          : fromRef || 6,
        true,
      );
    }
    default:
      return withTier(6, false);
  }
}
