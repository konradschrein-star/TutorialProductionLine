/**
 * BUSINESS_PLAN_HUB — script generation (task O4).
 *
 * A 15-minute script is ~2,250 spoken words. Single-shot generation at that
 * length is unreliable in this pipeline (measured on the tutorial path: chapters
 * asked for 8 minutes came back between 9.4 and 12.9, and reasoning models
 * guillotine the answer at the token ceiling mid-sentence). So this module uses
 * the same OUTLINE-THEN-EXPAND shape as
 * `apps/worker-orchestrator/src/utils/tutorial/long-form.ts`:
 *
 *   1. plan N chapters (default 4 x ~4 minutes) as strict JSON,
 *   2. expand each chapter with the prior chapters' briefs so it does not
 *      repeat them,
 *   3. enforce a per-chapter word ceiling, splitting an overlong chapter at
 *      SENTENCE boundaries only,
 *   4. parse and strip the inline `[[SOURCE: ref]]` citations,
 *   5. assemble.
 *
 * FAIL CLOSED. Everything here throws rather than degrading:
 *   - a chapter that ends mid-sentence is TRUNCATED and never reaches TTS,
 *   - a malformed or unresolvable citation is a hard failure, not a warning,
 *   - a script below the citation floor is a hard failure (design section 8),
 *   - bracketed text that is not a source tag would be spoken aloud, so it is a
 *     hard failure too.
 * Nothing is estimated, defaulted or substituted.
 */

import {
  PRIMARY_SOURCE_DOMAINS,
  SourceRefSchema,
  isAllowlistedPrimarySource,
  type BusinessHubFamily,
  type SourceRef,
} from "@repo/contracts";
import { sanitizeScriptText } from "../../utils/tutorial/sanitize-script.js";
import {
  parseOutline,
  countWords,
  type OutlinePart,
} from "../../utils/tutorial/long-form.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Spoken words per minute for this format. Matches the claude-pool writer. */
export const BUSINESS_HUB_WPM = 150;

/** Default target runtime, design section 2. */
export const BUSINESS_HUB_DEFAULT_TARGET_MINUTES = 15;

/** Default chapter length. 15 / 4 rounds to four chapters. */
export const BUSINESS_HUB_DEFAULT_CHAPTER_MINUTES = 4;

/**
 * How far over its target a chapter may run before it is split. Same 1.3 as the
 * tutorial path: below that the overrun is absorbed by pacing, above it the
 * chapter is a different chapter than the one that was planned.
 */
const CHAPTER_OVERFLOW_FACTOR = 1.3;

/** Hard ceiling stated to the model, as a multiple of the chapter word target. */
const CHAPTER_CEILING_FACTOR = 1.1;

/**
 * A script this far below its word target is not a short script, it is a failed
 * generation. Same floor the claude-pool writer's validator uses.
 */
const MIN_WORD_TARGET_RATIO = 0.6;

const OUTLINE_MAX_TOKENS = 4_000;
const CHAPTER_MAX_TOKENS = 8_000;
const LLM_TIMEOUT_MS = 300_000;

/**
 * The inline citation grammar. Kept byte-compatible with
 * `SOURCE_TAG_PATTERN` in `apps/claude-pool/src/writers/business-plan-hub.ts`,
 * which is where the writer is TOLD to emit it. claude-pool is a separately
 * deployed service that depends on nothing from this monorepo, so the grammar
 * is stated in both places; this one is the gate the render reads. See
 * `docs/superpowers/handoff/O4.md` for the proposed extraction.
 */
const SOURCE_TAG_RE = /\[\[\s*source\s*:\s*([^\]\r\n]+?)\s*\]\]/gi;

/** A single-bracket near-miss. Looks cited, parses to nothing, gets spoken. */
const MALFORMED_TAG_RE = /(?<!\[)\[\s*source\s*:[^\]\r\n]*\]/gi;

/** Any remaining bracketed run once real tags are removed. */
const STRAY_BRACKET_RE = /\[[^\]\r\n]*\]/;

/** A whole `[[...]]` run, tag body included. Used by the sentence splitter. */
const TAG_BODY_RE = /\[\[[^\]\r\n]*\]\]/g;

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

/** Why script generation failed. Stable strings; callers may branch on them. */
export type BusinessHubScriptErrorCode =
  | "bad-request"
  | "empty-generation"
  | "truncated"
  | "malformed-source-tag"
  | "unresolvable-source"
  | "too-few-sources"
  | "stray-brackets"
  | "too-short";

/**
 * A hard failure in script generation. Carries the code, the chapter it came
 * from when it is chapter-scoped, and a diagnostic the operator can act on.
 */
export class BusinessHubScriptError extends Error {
  constructor(
    readonly code: BusinessHubScriptErrorCode,
    message: string,
    readonly chapterIndex?: number,
  ) {
    super(message);
    this.name = "BusinessHubScriptError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface BusinessHubScriptRequest {
  /** The long-tail query this video answers. Required, never derived. */
  topic: string;
  /** Which video family (design section 2). Shapes the outline. */
  family: BusinessHubFamily;
  /** Total runtime target in minutes. Default 15. */
  targetMinutes?: number;
  /** Per-chapter runtime target in minutes. Default 4. */
  chapterMinutes?: number;
  /** The video title, if it differs from the topic. */
  title?: string;
  /** Operator notes, keyword data, source material. Passed to every prompt. */
  context?: string;
  /**
   * The format SOP. Defaults to {@link BUSINESS_HUB_NARRATION_SOP}, which is
   * this side's statement of the same rules the claude-pool writer enforces.
   * Pass the canonical writer prompt here when the caller can reach it.
   */
  sop?: string;
}

export interface BusinessHubLlmRequest {
  prompt: string;
  /** Which step is asking. Lets a caller route or log the two differently. */
  purpose: "outline" | "chapter";
  maxTokens: number;
  /** Ask for strict JSON where the provider supports it. Outline only. */
  json: boolean;
  /** 0-based chapter index, for the chapter step only. */
  chapterIndex?: number;
}

export interface BusinessHubLlmResponse {
  text: string;
  /**
   * OpenAI-style finish reason when the provider exposes one. `"length"` means
   * the answer was cut at the token ceiling and is a hard failure. Providers
   * that do not report it leave this undefined; the mid-sentence check below is
   * the backstop for those.
   */
  finishReason?: string;
}

/** The single injected dependency. Keeps every pure part of this file testable. */
export type BusinessHubLlm = (
  request: BusinessHubLlmRequest,
) => Promise<BusinessHubLlmResponse>;

/** One `[[SOURCE: ref]]` occurrence, resolved against the contracts schema. */
export interface BusinessHubSourceTag {
  /** The raw tag as written, e.g. `"[[SOURCE: sba.gov/x#y]]"`. */
  raw: string;
  /** Validated citation. `kind` follows `SourceRefSchema` in `@repo/contracts`. */
  source: SourceRef;
  /** 0-based chapter this citation came from. */
  chapterIndex: number;
  /** Offset into the assembled, tag-stripped script where the tag stood. */
  charIndex: number;
  /** The sentence the citation is attached to, tag-stripped and trimmed. */
  sentence: string;
}

export interface BusinessHubChapter {
  index: number;
  /** Outline title. Chapters produced by an overflow split are suffixed. */
  title: string;
  /** Outline summary that produced this chapter. */
  summary: string;
  /** Tag-stripped, TTS-ready narration. */
  narration: string;
  words: number;
}

export interface BusinessHubScriptResult {
  /**
   * The assembled, tag-stripped script — prose only, no directives.
   *
   * Do NOT hand this to the scene planner: `planBusinessHub` compiles one scene
   * per directive-led paragraph and requires exactly one `[hook]` and one
   * `[close]`, and this string carries neither. Call
   * {@link toPlannableScript} to get the annotated form.
   */
  script: string;
  chapters: BusinessHubChapter[];
  /** Every citation in the script, in order of appearance. */
  sources: BusinessHubSourceTag[];
  wordCount: number;
  estimatedMinutes: number;
  /** The outline the chapters were expanded from, for debugging and QA. */
  outline: OutlinePart[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Source-tag parsing (pure)
// ─────────────────────────────────────────────────────────────────────────────

/** Sentinel for a `.` that does NOT terminate a sentence. */
const PERIOD_SENTINEL = "\u0000";
/** Sentinels for `!` and `?` appearing inside a citation ref. */
const BANG_SENTINEL = "\u0001";
const QUERY_SENTINEL = "\u0002";

/**
 * Mask punctuation that is not a sentence terminator.
 *
 * Three cases, all of which this format actually produces:
 *  - punctuation inside a citation, `[[SOURCE: sba.gov/...]]`, which would
 *    otherwise split the tag into "sba." and "gov/...]]" and hand half of it to
 *    the next sentence,
 *  - the decimal point in a number, so "a 1.25 ratio." is one sentence rather
 *    than "a 1." followed by "25 ratio.",
 *  - a single-letter initial such as "U.S.".
 *
 * Every replacement is one character for one character, so offsets into the
 * masked string stay valid offsets into the original and nothing needs to be
 * unmasked. Over-masking merges two sentences (harmless here); under-masking
 * would tear a claim away from the citation that follows it, which is not.
 */
function maskInlinePeriods(text: string): string {
  return text
    .replace(TAG_BODY_RE, (tag) =>
      tag
        .replace(/\./g, PERIOD_SENTINEL)
        .replace(/!/g, BANG_SENTINEL)
        .replace(/\?/g, QUERY_SENTINEL),
    )
    .replace(/(\d)\.(?=\d)/g, `$1${PERIOD_SENTINEL}`)
    .replace(/\b([A-Za-z])\.(?=[A-Za-z]\.|\s*[a-z])/g, `$1${PERIOD_SENTINEL}`);
}

export interface SentenceSpan {
  text: string;
  /** Inclusive start offset in the source string. */
  start: number;
  /** Exclusive end offset in the source string. */
  end: number;
}

/**
 * Split `text` into sentence spans with offsets into `text` itself.
 *
 * Decimal-aware (see {@link maskInlinePeriods}). Trailing text with no terminal
 * punctuation is returned as a final span, so a truncated chapter is visible
 * rather than silently dropped.
 */
export function splitSentenceSpans(text: string): SentenceSpan[] {
  const masked = maskInlinePeriods(text);
  const spans: SentenceSpan[] = [];
  // A citation sits AFTER the full stop of the claim it cites, so the trailing
  // group pulls it into the same span. Without it, a chapter split could put a
  // claim in one chunk and its source in the next.
  const re = /[^.!?\r\n]+[.!?]+["')\]]*(?:[ \t]*\[\[[^\]\r\n]*\]\])*/g;
  let consumed = 0;
  for (const match of masked.matchAll(re)) {
    const start = match.index;
    const end = start + match[0].length;
    spans.push({ text: text.slice(start, end), start, end });
    consumed = end;
  }
  if (consumed < text.length) {
    const tail = text.slice(consumed);
    if (tail.trim().length > 0) {
      spans.push({ text: tail, start: consumed, end: text.length });
    }
  }
  return spans;
}

export interface SourceTagParseResult {
  /** `text` with every well-formed tag removed. */
  narration: string;
  /** Each tag's ref plus where it sat in `narration`. */
  tags: Array<{
    raw: string;
    ref: string;
    charIndex: number;
    sentence: string;
  }>;
  /** Near-miss tags that would have been spoken aloud. */
  malformed: string[];
}

/**
 * Extract and strip the inline citations.
 *
 * A tag sits immediately after the full stop of the sentence it cites, so the
 * sentence attributed to it is the one ENDING at the tag's position, not the
 * one starting there. One preceding space is swallowed with the tag so the
 * stripped narration has no double spaces for TTS to breathe on.
 *
 * Pure. Never throws.
 */
export function parseSourceTags(text: string): SourceTagParseResult {
  const tags: SourceTagParseResult["tags"] = [];
  let narration = "";
  let last = 0;

  for (const match of text.matchAll(new RegExp(SOURCE_TAG_RE.source, "gi"))) {
    const start = match.index;
    const ref = (match[1] ?? "").trim();
    let cut = start;
    while (cut > last && (text[cut - 1] === " " || text[cut - 1] === "\t")) {
      cut -= 1;
    }
    narration += text.slice(last, cut);
    tags.push({
      raw: match[0],
      ref,
      charIndex: narration.length,
      sentence: "",
    });
    last = start + match[0].length;
  }
  narration += text.slice(last);

  const spans = splitSentenceSpans(narration);
  for (const tag of tags) {
    const span =
      spans.find((s) => tag.charIndex > s.start && tag.charIndex <= s.end) ??
      spans.find((s) => tag.charIndex >= s.start && tag.charIndex < s.end);
    tag.sentence = span ? span.text.trim() : "";
  }

  const malformed = [
    ...text.matchAll(new RegExp(MALFORMED_TAG_RE.source, "gi")),
  ]
    .map((m) => m[0])
    .filter((m) => !/^\[\[/.test(m));

  return { narration, tags, malformed };
}

/**
 * Resolve a raw ref into a validated {@link SourceRef}, or explain why it
 * cannot be. Mirrors `SourceRefSchema` in `@repo/contracts`: an allowlisted
 * government host with a real document path, or a repo-relative file path with
 * an extension and an optional `#anchor`.
 *
 * Pure. Never throws.
 */
export function classifySourceRef(
  ref: string,
): { ok: true; source: SourceRef } | { ok: false; reason: string } {
  const trimmed = ref.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty ref" };

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const hostPart = (withoutScheme.split(/[/?#]/, 1)[0] ?? "").toLowerCase();
  const host = hostPart.startsWith("www.") ? hostPart.slice(4) : hostPart;
  const hostShaped =
    /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) && /\.[a-z]{2,}$/.test(host);

  if (hasScheme || hostShaped) {
    if (!isAllowlistedPrimarySource(trimmed)) {
      return {
        ok: false,
        reason:
          `host "${host}" is not on the primary allowlist ` +
          `(${PRIMARY_SOURCE_DOMAINS.join(", ")})`,
      };
    }
    const path = withoutScheme.slice(hostPart.length);
    if (path.replace(/^[/#?]+/, "").length === 0) {
      return {
        ok: false,
        reason:
          "a bare domain is not a citation; cite the specific document path",
      };
    }
    const parsed = SourceRefSchema.safeParse({
      kind: "primary",
      ref: trimmed,
    });
    return parsed.success
      ? { ok: true, source: parsed.data }
      : { ok: false, reason: parsed.error.issues[0]?.message ?? "invalid ref" };
  }

  if (!/^[\w.@-]+(?:\/[\w.@-]+)+\.[a-z]{1,5}(?:#[\w.-]+)?$/i.test(trimmed)) {
    return {
      ok: false,
      reason:
        "neither an allowlisted primary document " +
        `(${PRIMARY_SOURCE_DOMAINS.join(", ")}) nor a repo-relative file ` +
        "path with an extension",
    };
  }
  const parsed = SourceRefSchema.safeParse({ kind: "repo", ref: trimmed });
  return parsed.success
    ? { ok: true, source: parsed.data }
    : { ok: false, reason: parsed.error.issues[0]?.message ?? "invalid ref" };
}

/**
 * The citation floor for a script of this length: one per two minutes, never
 * fewer than three. A 15-minute script needs 8. THROWS on a non-positive or
 * non-finite length rather than picking a number.
 */
export function requiredSourceCount(targetMinutes: number): number {
  if (!Number.isFinite(targetMinutes) || targetMinutes <= 0) {
    throw new BusinessHubScriptError(
      "bad-request",
      `requiredSourceCount: targetMinutes must be positive and finite, got ${String(targetMinutes)}`,
    );
  }
  return Math.max(3, Math.ceil(targetMinutes / 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Truncation (pure)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reject a chapter the provider cut off.
 *
 * Two signals. `finish_reason === "length"` is definitive when the provider
 * reports it. When it does not (claude-pool's `/v1/run` returns text only),
 * the backstop is that spoken narration always ends on terminal punctuation,
 * so text ending "…and the lender will" is a fragment.
 *
 * This is the concept `assertNotTruncated` in
 * `apps/worker-orchestrator/src/utils/tutorial/llm-registry.ts` exists for: a
 * fragment was previously returned as a normal success, saved, and sent to TTS.
 *
 * THROWS {@link BusinessHubScriptError} with code `truncated` or
 * `empty-generation`.
 */
export function assertChapterComplete(
  text: string,
  ctx: { chapterIndex: number; finishReason?: string; maxTokens?: number },
): void {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new BusinessHubScriptError(
      "empty-generation",
      `chapter ${ctx.chapterIndex + 1} came back empty. Nothing to record.`,
      ctx.chapterIndex,
    );
  }
  if (ctx.finishReason === "length") {
    throw new BusinessHubScriptError(
      "truncated",
      `chapter ${ctx.chapterIndex + 1} was TRUNCATED at the token ceiling ` +
        `(finish_reason=length${ctx.maxTokens !== undefined ? `, max_tokens=${ctx.maxTokens}` : ""}, ` +
        `chars_returned=${text.length}). It ends: "...${trimmed.slice(-80)}". ` +
        `A script ending mid-sentence must never reach TTS. Retry re-rolls ` +
        `generation; if it repeats, raise maxTokens for this call.`,
      ctx.chapterIndex,
    );
  }
  const tail = trimmed.replace(/\[\[[^\]\r\n]*\]\]$/i, "").trim();
  if (!/[.!?]["')\]]?$/.test(tail)) {
    throw new BusinessHubScriptError(
      "truncated",
      `chapter ${ctx.chapterIndex + 1} does not end on a complete sentence, ` +
        `so it was cut mid-thought. It ends: "...${tail.slice(-80)}". ` +
        `A script ending mid-sentence must never reach TTS.`,
      ctx.chapterIndex,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Chapter splitting (pure)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split a chapter that overran its target into chunks of roughly
 * `targetMinutes` each, at SENTENCE boundaries only.
 *
 * A citation belongs to the sentence it follows, and {@link splitSentenceSpans}
 * keeps them together, so a split can never separate a claim from its source.
 * Returns `[text]` unchanged when the chapter is within
 * {@link CHAPTER_OVERFLOW_FACTOR} of target.
 *
 * THROWS on a non-positive target rather than defaulting to one.
 */
export function splitChapterAtSentences(
  text: string,
  targetMinutes: number,
): string[] {
  if (!Number.isFinite(targetMinutes) || targetMinutes <= 0) {
    throw new BusinessHubScriptError(
      "bad-request",
      `splitChapterAtSentences: targetMinutes must be positive and finite, got ${String(targetMinutes)}`,
    );
  }
  const trimmed = text.trim();
  const targetWords = targetMinutes * BUSINESS_HUB_WPM;
  if (countWords(trimmed) <= targetWords * CHAPTER_OVERFLOW_FACTOR) {
    return [trimmed];
  }

  const chunks: string[] = [];
  let current: string[] = [];
  let words = 0;
  for (const span of splitSentenceSpans(trimmed)) {
    const sentence = span.text.trim();
    if (sentence.length === 0) continue;
    const w = countWords(sentence);
    if (words > 0 && words + w > targetWords) {
      chunks.push(current.join(" ").trim());
      current = [sentence];
      words = w;
    } else {
      current.push(sentence);
      words += w;
    }
  }
  if (current.length > 0) chunks.push(current.join(" ").trim());
  return chunks.filter((c) => c.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The narration rules this side states to the model.
 *
 * The canonical SOP lives in `apps/claude-pool/src/writers/business-plan-hub.ts`
 * and is injected as CLAUDE.md when generation goes through claude-pool's
 * `/v1/script`. Outline-then-expand uses the free-form endpoint, which injects
 * no writer, so the rules that must survive have to travel in the prompt. This
 * constant is that statement. It is deliberately the SHORT form: persona, the
 * no-withholding rule, the citation grammar and the banned list. Callers that
 * can reach the canonical prompt should pass it as `request.sop` instead.
 */
export const BUSINESS_HUB_NARRATION_SOP = [
  "You write spoken narration for the Business Plan Hub channel: business plan writing, SBA",
  "loan applications, EB-5 investor plans and business fundamentals, for people who searched a",
  "specific question and landed here.",
  "",
  "VOICE. A specialist explaining a filing. Someone who has read the SOP and knows which",
  "paragraph the rule lives in. Precise, unhurried, slightly dry. Never a YouTuber, never a",
  "coach. Cite rules by name: the SOP, the form number, the section.",
  "",
  "GIVE THE METHOD AWAY. This is a Hormozi structure. The entire method is free, in full,",
  "nothing held back. The offer is that checking your own draft against all of it by hand is",
  "the expensive part. Never withhold an answer to create a click.",
  "",
  "ANSWER EARLY. The title is a query somebody typed. Answer it directly and completely, as",
  'early as it comes up. Banned outright: "stick around", "stay tuned", "by the end of this',
  'video", "we will get to that in a minute", "but first". There is no back half of the video',
  "holding the good part. Depth keeps people watching, not suspense.",
  "",
  "CITATIONS. Every claim about SBA, EB-5, USCIS or IRS rules, every threshold, percentage,",
  "dollar figure, ratio and quotation carries an inline tag placed immediately after the full",
  "stop of the sentence that makes the claim:",
  "  [[SOURCE: sba.gov/document/sop-50-10-business-loan-program#dscr]]",
  "  [[SOURCE: packages/finance-kit/src/amortization.ts#monthlyPayment]]",
  `A ref is either a document path on one of ${PRIMARY_SOURCE_DOMAINS.join(", ")} (a bare`,
  "domain is not a citation) or a repo-relative file path with an extension and an optional",
  "#anchor. NEVER invent a URL, a section number or a statistic. If you cannot attribute it, do",
  "not say it. The build REJECTS this script if a sentence states a statistic, formula, dollar",
  "figure, ratio or quotation with no tag, and it rejects it again if the whole script carries",
  "fewer than one citation per two minutes of speech. Programme names are not statistics:",
  '"an SBA 7(a) loan" needs no tag; what the programme REQUIRES does.',
  "",
  "OUTPUT. Clean TTS-ready prose only. One paragraph per beat, paragraphs separated by a single",
  "blank line. No markdown, no headers, no bullets, no numbered lists, no stage directions, no",
  "speaker labels. The only bracketed text permitted anywhere is the source tag above. No em",
  'dashes and no en dashes, use a comma or the word "to" for a range. No ellipses.',
  "",
  'BANNED LANGUAGE. Creator-speak ("smash that like button", "like and subscribe", "hit',
  'subscribe", "what\'s up guys", "let\'s dive in", "without further ado", "buckle up"). Filler',
  '("in today\'s fast-paced world", "in this day and age", "here\'s the thing", "most people',
  'think", "let that sink in", "at the end of the day"). Hype ("you won\'t believe", "blow your',
  'mind", "trust me", "game-changing", "revolutionary", "this one simple trick"). There is no',
  "like ask, no subscribe ask, no bell and no comment prompt, ever.",
].join("\n");

function contextBlock(request: BusinessHubScriptRequest): string[] {
  const lines: string[] = [];
  const title = request.title?.trim();
  if (title) {
    lines.push(
      `VIDEO TITLE (the exact phrase the viewer searched for): ${title}`,
    );
  }
  const context = request.context?.trim();
  if (context) {
    lines.push(`REFERENCE CONTEXT AND OPERATOR NOTES:\n${context}`);
  }
  return lines;
}

/**
 * Ask for the chapter plan as strict JSON.
 *
 * The outline is not narration, so it carries the STRUCTURAL constraints only:
 * the query is answered in chapter one, no chapter is a recap, and every
 * chapter has to be citable. `parseOutline` (tutorial/long-form.ts) reads the
 * result, so the requested shape matches its schema exactly.
 */
export function buildBusinessHubOutlinePrompt(
  request: BusinessHubScriptRequest,
  nChapters: number,
  chapterMinutes: number,
): string {
  return [
    request.sop ?? BUSINESS_HUB_NARRATION_SOP,
    "",
    `TASK: plan this video as EXACTLY ${nChapters} chapters. Each chapter is spoken for about`,
    `${chapterMinutes} minutes (~${chapterMinutes * BUSINESS_HUB_WPM} words).`,
    "",
    `THE QUERY THIS VIDEO ANSWERS: ${request.topic.trim()}`,
    `VIDEO FAMILY: ${request.family}`,
    "",
    "CHAPTER ONE ANSWERS THE QUERY. Not a preamble, not a definition of terms, not a promise of",
    "what is coming. It confirms the viewer is in the right place and gives the direct, complete",
    "answer to the query. Every chapter after it is the depth behind that answer: why the rule",
    "is what it is, what it looks like when it goes wrong, what to actually write.",
    "",
    "NO RECAP CHAPTER. The last chapter teaches its own real material like every other one and",
    "only then closes. A chapter whose content is 'review of what we covered' is a wasted",
    "chapter and will be rejected.",
    "",
    "NO OVERLAP. Chapters must not restate each other. Each summary lists the concrete rules,",
    "thresholds, failure modes and sentences-to-write that chapter covers, specifically enough",
    "that it can be written without seeing the others.",
    "",
    "EVERY CHAPTER MUST BE CITABLE. Do not plan a chapter whose substance is opinion or vibes.",
    "If a chapter's material cannot be traced to a government document or to a computation, it",
    "is the wrong chapter. Name the likely source in the summary.",
    "",
    ...contextBlock(request),
    "",
    "Respond with ONLY JSON in this exact shape. No prose, no markdown fences:",
    '{"parts":[{"title":"...","summary":"..."}]}',
  ].join("\n");
}

/** Which of the three CTA moments this chapter carries. */
export interface CtaPlan {
  /** "the tool is trained on this material", roughly a third of the way in. */
  midRoll: boolean;
  /** Point at the free business plan checker, after the method is delivered. */
  payoff: boolean;
  /** The closing beat. */
  close: boolean;
}

/**
 * Assign the three CTA moments across the chapters.
 *
 * Position-aware on purpose. Handing every chapter the full SOP is what turned
 * the tutorial format's 45-minute video into seven mini-tutorials, each opening
 * and closing itself. Here it would put three CTAs in every chapter.
 *
 * THROWS on an out-of-range index rather than guessing.
 */
export function ctaPlanFor(index: number, total: number): CtaPlan {
  if (!Number.isInteger(total) || total < 1) {
    throw new BusinessHubScriptError(
      "bad-request",
      `ctaPlanFor: total must be a positive integer, got ${String(total)}`,
    );
  }
  if (!Number.isInteger(index) || index < 0 || index >= total) {
    throw new BusinessHubScriptError(
      "bad-request",
      `ctaPlanFor: index ${String(index)} is out of range for ${total} chapter(s)`,
    );
  }
  if (total === 1) return { midRoll: true, payoff: true, close: true };
  const midRollIndex = Math.min(total - 2, Math.max(1, Math.round(total / 3)));
  return {
    midRoll: index === midRollIndex,
    payoff: index === total - 1,
    close: index === total - 1,
  };
}

/**
 * Expand one outline chapter into narration.
 *
 * Carries: the SOP, the chapter brief, the hard word ceiling, the position
 * rules (open / flow / close), the CTA moments assigned to THIS chapter, and
 * the briefs of every chapter already written so it does not repeat them.
 */
export function buildBusinessHubExpansionPrompt(
  request: BusinessHubScriptRequest,
  part: OutlinePart,
  chapterMinutes: number,
  position: { index: number; total: number },
  priorParts: readonly OutlinePart[],
): string {
  const { index, total } = position;
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const isOnly = total === 1;
  const cta = ctaPlanFor(index, total);
  const targetWords = chapterMinutes * BUSINESS_HUB_WPM;

  const positionLines: string[] = isOnly
    ? [
        "This chapter is the WHOLE video. Open it by answering the query directly, then teach",
        "the method in full, then close.",
      ]
    : isFirst
      ? [
          "This is the OPENING chapter. Its first paragraph confirms the viewer is in the right",
          "place and gives the direct, complete answer to the query. No greeting, no channel",
          "talk, no promise of what they will know by the end. Then start teaching, and end",
          "mid-flow: the next chapter continues straight on, so do not recap or sign off.",
        ]
      : isLast
        ? [
            "This is the FINAL chapter. Begin mid-flow, continuing from the previous chapter.",
            "Do not greet the viewer or re-introduce the video. Teach this last section, then",
            "close.",
          ]
        : [
            "This is a MIDDLE chapter. Begin mid-flow, continuing from the previous chapter. Do",
            "not greet the viewer, re-introduce the video or recap from the beginning. End",
            "mid-flow so the next chapter continues seamlessly.",
          ];

  const ctaLines: string[] = [];
  if (cta.midRoll) {
    ctaLines.push(
      "CTA MOMENT, MID-ROLL. Somewhere in this chapter, one or two sentences, flat, moved on",
      "from immediately: the plan builder we run is trained on this same standard, so it flags",
      "this section before a lender does. Then continue teaching in the very next sentence. No",
      "pause for effect, no second mention.",
    );
  }
  if (cta.payoff) {
    ctaLines.push(
      "CTA MOMENT, PAYOFF. After the method is fully delivered, point at the free business plan",
      'checker. Use the phrase "free business plan checker" exactly. The logic is always: you',
      "now know exactly what to do, and checking your own draft against all of it by hand is the",
      "slow part.",
    );
  }
  if (cta.close) {
    ctaLines.push(
      "CTA MOMENT, CLOSE. The last beat: at most three sentences saying what they can now do,",
      "and the checker as the next concrete step. Never a summary of the video, never a list of",
      "what was covered. No like ask, no subscribe ask.",
    );
  }
  if (ctaLines.length === 0) {
    ctaLines.push(
      "NO CTA IN THIS CHAPTER. Do not mention the tool, the checker, the channel or any next",
      "step. Those beats belong to other chapters and repeating them reads as an advert.",
    );
  }

  return [
    request.sop ?? BUSINESS_HUB_NARRATION_SOP,
    "",
    "FORMAT AND STRUCTURE RULES (highest priority, they override anything above):",
    "",
    "ONE CONTINUOUS VIDEO, not a stack of little videos. The viewer is watching one recording",
    "straight through. Chapters are where the markers go; the viewer never hears one begin or",
    'end. Never open a chapter by announcing what it will teach ("in this section we will',
    'cover"), and never close one by re-listing what you just said ("to recap", "so by doing X,',
    'Y and Z"). Say it once, while doing it.',
    "",
    `THE QUERY THIS VIDEO ANSWERS: ${request.topic.trim()}`,
    "",
    `Write the spoken narration for ONE chapter: "${part.title}".`,
    `Cover exactly this: ${part.summary}`,
    `Target about ${chapterMinutes} minutes of speech (~${targetWords} words).`,
    `HARD CEILING: ${Math.round(targetWords * CHAPTER_CEILING_FACTOR)} words. Going over does not make`,
    "the video better, it makes this chapter get split later, which breaks the hand-off you",
    "wrote. If you are running long, cut the least valuable point, not the depth on the points",
    "that matter.",
    "",
    ...positionLines,
    "",
    ...ctaLines,
    "",
    "Output the narration only. No chapter title, no part number, no headings, no meta",
    'commentary, no phrases like "in this chapter" or "in this part".',
    ...(priorParts.length > 0
      ? [
          "",
          "CHAPTERS ALREADY WRITTEN EARLIER IN THIS VIDEO. Build on these, never repeat them:",
          priorParts
            .map((p, i) => `${i + 1}. ${p.title} — ${p.summary}`)
            .join("\n"),
        ]
      : []),
    ...(contextBlock(request).length > 0 ? ["", ...contextBlock(request)] : []),
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleaning
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A chapter heading the model emitted despite being told not to.
 *
 * Deliberately narrow: it must be the FIRST line, must name a numbered chapter
 * or section, must carry no sentence-terminating punctuation, must be short,
 * and must be followed by a blank line. All four conditions together are what
 * keeps a real opening sentence that happens to begin "Section 3 of the SOP is
 * where this lives." from being eaten — that one has a full stop, so it fails
 * the `[^\r\n.!?]` clause.
 */
const LEADING_HEADING_RE =
  /^[ \t]*(?:chapter|part|section)[ \t]+\d+[ \t]*[:.)\-]?[^\r\n.!?]{0,60}\r?\n[ \t]*\r?\n/i;

/**
 * Strip formatting artefacts a generated chapter carries into TTS.
 *
 * Reuses `sanitizeScriptText` (markdown, code fences, em/en dash to comma) and
 * additionally drops a leading chapter heading. It only ever REMOVES formatting
 * — it never rewrites, shortens or paraphrases the spoken words, so it cannot
 * mask a bad generation the way a synthetic fallback would.
 */
export function cleanChapterText(raw: string): {
  text: string;
  removed: string[];
} {
  const withoutHeading = raw.replace(LEADING_HEADING_RE, "");
  const removed = withoutHeading === raw ? [] : ["chapter-heading"];
  const { text, report } = sanitizeScriptText(withoutHeading);
  return { text: text.trim(), removed: [...removed, ...report.removed] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Default LLM adapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The production LLM adapter: the premium tier (claude_pool first), free-form
 * endpoint, long timeout.
 *
 * The free-form endpoint is deliberate. claude-pool's `/v1/script` injects the
 * writer SOP and self-corrects, but it takes a bare topic and a single target
 * length, which cannot express "chapter 2 of 4, mid-roll CTA, 600 words". The
 * outline-then-expand prompts carry the SOP themselves instead
 * (see {@link BUSINESS_HUB_NARRATION_SOP}).
 *
 * `requestLLMText` returns text only, so `finishReason` is left undefined and
 * {@link assertChapterComplete}'s mid-sentence backstop is what catches a cut
 * generation. The import is dynamic so that this module's pure exports can be
 * unit-tested without the provider environment.
 */
export function createDefaultBusinessHubLlm(): BusinessHubLlm {
  return async (request: BusinessHubLlmRequest) => {
    const { requestLLMText } = await import("../../utils/llm-client.js");
    const text = await requestLLMText(request.prompt, {
      tier: "premium",
      json: request.json,
      maxTokens: request.maxTokens,
      timeoutMs: LLM_TIMEOUT_MS,
      context: `business-hub-script:${request.purpose}`,
    });
    return { text };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestration
// ─────────────────────────────────────────────────────────────────────────────

function validateRequest(request: BusinessHubScriptRequest): {
  targetMinutes: number;
  chapterMinutes: number;
  nChapters: number;
} {
  if (request.topic.trim().length === 0) {
    throw new BusinessHubScriptError(
      "bad-request",
      "BUSINESS_PLAN_HUB script generation needs a topic (the long-tail query the video answers). It is never derived from the title.",
    );
  }
  const targetMinutes =
    request.targetMinutes ?? BUSINESS_HUB_DEFAULT_TARGET_MINUTES;
  const chapterMinutes =
    request.chapterMinutes ?? BUSINESS_HUB_DEFAULT_CHAPTER_MINUTES;
  if (!Number.isFinite(targetMinutes) || targetMinutes <= 0) {
    throw new BusinessHubScriptError(
      "bad-request",
      `targetMinutes must be positive and finite, got ${String(request.targetMinutes)}`,
    );
  }
  if (!Number.isFinite(chapterMinutes) || chapterMinutes <= 0) {
    throw new BusinessHubScriptError(
      "bad-request",
      `chapterMinutes must be positive and finite, got ${String(request.chapterMinutes)}`,
    );
  }
  if (chapterMinutes > targetMinutes) {
    throw new BusinessHubScriptError(
      "bad-request",
      `chapterMinutes (${chapterMinutes}) exceeds targetMinutes (${targetMinutes}); the video cannot be shorter than one of its chapters`,
    );
  }
  const nChapters = Math.max(1, Math.round(targetMinutes / chapterMinutes));
  return { targetMinutes, chapterMinutes, nChapters };
}

/**
 * Generate a BUSINESS_PLAN_HUB script: outline, expand, split, cite, assemble.
 *
 * Returns the assembled tag-stripped narration (what goes to TTS), the chapter
 * breakdown, and every citation resolved against `SourceRefSchema`.
 *
 * THROWS {@link BusinessHubScriptError} on: an unusable request, an empty or
 * truncated chapter, a malformed citation, a citation that resolves to neither
 * an allowlisted primary document nor a repo file, a script below the citation
 * floor, bracketed text that would be spoken aloud, or a script materially
 * shorter than its target. It never returns a partial or repaired script.
 */
export async function generateBusinessHubScript(
  request: BusinessHubScriptRequest,
  llm: BusinessHubLlm = createDefaultBusinessHubLlm(),
): Promise<BusinessHubScriptResult> {
  const { targetMinutes, chapterMinutes, nChapters } = validateRequest(request);

  // 1. Outline.
  const outlineRaw = await llm({
    prompt: buildBusinessHubOutlinePrompt(request, nChapters, chapterMinutes),
    purpose: "outline",
    maxTokens: OUTLINE_MAX_TOKENS,
    json: true,
  });
  if (outlineRaw.text.trim().length === 0) {
    throw new BusinessHubScriptError(
      "empty-generation",
      `outline generation returned no text for topic "${request.topic}"`,
    );
  }
  const outline = parseOutline(outlineRaw.text);

  // 2. Expand each chapter with the prior briefs, then overflow-split.
  const chapters: BusinessHubChapter[] = [];
  const sources: BusinessHubSourceTag[] = [];
  const narrations: string[] = [];
  let assembledLength = 0;

  for (let i = 0; i < outline.parts.length; i++) {
    const part = outline.parts[i];
    if (!part) {
      throw new BusinessHubScriptError(
        "bad-request",
        `outline part ${i} is missing after parseOutline validated the outline. This is an internal invariant violation, not a model problem.`,
      );
    }
    const response = await llm({
      prompt: buildBusinessHubExpansionPrompt(
        request,
        part,
        chapterMinutes,
        { index: i, total: outline.parts.length },
        outline.parts.slice(0, i),
      ),
      purpose: "chapter",
      maxTokens: CHAPTER_MAX_TOKENS,
      json: false,
      chapterIndex: i,
    });
    assertChapterComplete(response.text, {
      chapterIndex: i,
      finishReason: response.finishReason,
      maxTokens: CHAPTER_MAX_TOKENS,
    });

    const cleaned = cleanChapterText(response.text);
    const chunks = splitChapterAtSentences(cleaned.text, chapterMinutes);

    for (let c = 0; c < chunks.length; c++) {
      const chunk = chunks[c];
      if (chunk === undefined) {
        throw new BusinessHubScriptError(
          "bad-request",
          `chapter ${i + 1} chunk ${c} is missing after splitChapterAtSentences. This is an internal invariant violation.`,
          i,
        );
      }
      const chapterIndex = chapters.length;
      const parsed = parseSourceTags(chunk);

      if (parsed.malformed.length > 0) {
        throw new BusinessHubScriptError(
          "malformed-source-tag",
          `chapter ${chapterIndex + 1} contains malformed citation(s): ` +
            `${parsed.malformed
              .slice(0, 3)
              .map((m) => `"${m.slice(0, 60)}"`)
              .join(", ")}. ` +
            `The exact form is [[SOURCE: ref]] with double brackets. A near-miss ` +
            `is spoken aloud by TTS and is invisible to the citation gate.`,
          chapterIndex,
        );
      }
      const stray = STRAY_BRACKET_RE.exec(parsed.narration);
      if (stray) {
        throw new BusinessHubScriptError(
          "stray-brackets",
          `chapter ${chapterIndex + 1} contains bracketed text ` +
            `"${stray[0].slice(0, 60)}" that is not a source tag. It would be ` +
            `read aloud. Narration is prose only.`,
          chapterIndex,
        );
      }

      for (const tag of parsed.tags) {
        const classified = classifySourceRef(tag.ref);
        if (!classified.ok) {
          throw new BusinessHubScriptError(
            "unresolvable-source",
            `chapter ${chapterIndex + 1} cites "${tag.ref}", which is ` +
              `${classified.reason}. Cited on: "${tag.sentence.slice(0, 120)}". ` +
              `An unresolvable citation is a hard failure, not a warning.`,
            chapterIndex,
          );
        }
        sources.push({
          raw: tag.raw,
          source: classified.source,
          chapterIndex,
          charIndex: assembledLength + tag.charIndex,
          sentence: tag.sentence,
        });
      }

      const narration = parsed.narration.replace(/[ \t]+\n/g, "\n").trim();
      chapters.push({
        index: chapterIndex,
        title: c === 0 ? part.title : `${part.title} (continued)`,
        summary: part.summary,
        narration,
        words: countWords(narration),
      });
      narrations.push(narration);
      // Chapters are joined with "\n\n", so the next chapter's offsets start
      // after this narration plus that two-character separator.
      assembledLength += narration.length + 2;
    }
  }

  if (chapters.length === 0) {
    throw new BusinessHubScriptError(
      "empty-generation",
      `no chapters were produced for topic "${request.topic}"`,
    );
  }

  // 3. Assemble and gate.
  const script = narrations.join("\n\n");
  const words = countWords(script);
  const wordTarget = targetMinutes * BUSINESS_HUB_WPM;
  const minWords = Math.round(wordTarget * MIN_WORD_TARGET_RATIO);
  if (words < minWords) {
    throw new BusinessHubScriptError(
      "too-short",
      `assembled script is ${words} words; a ${targetMinutes}-minute video needs at least ` +
        `${minWords} (target ~${wordTarget}). A short script is a failed generation, ` +
        `not a shorter video.`,
    );
  }

  const required = requiredSourceCount(targetMinutes);
  if (sources.length < required) {
    throw new BusinessHubScriptError(
      "too-few-sources",
      `script carries ${sources.length} citation(s); a ${targetMinutes}-minute ` +
        `BUSINESS_PLAN_HUB script needs at least ${required} (one per two minutes). ` +
        `SBA and EB-5 claims sit next to unauthorised-practice-of-law exposure; ` +
        `this gate is the control (design section 8, rule 1).`,
    );
  }

  return {
    script,
    chapters,
    sources,
    wordCount: words,
    estimatedMinutes: words / BUSINESS_HUB_WPM,
    outline: outline.parts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generator output -> planner grammar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a generated script into the directive-annotated form the scene
 * planner (O1) compiles.
 *
 * ## Why this exists
 *
 * The two sides of this format's own pipeline did not meet. This module returns
 * tag-stripped prose and rejects any `[` in narration — correctly, because a
 * stray bracket is spoken aloud by TTS. `planBusinessHub` compiles one scene per
 * directive-led paragraph and requires exactly one `[hook]` and one `[close]`.
 * So a script this file generated could never satisfy the planner, and the
 * pipeline threw one call after paying for the generation. Every
 * BUSINESS_PLAN_HUB job was unrunnable without a hand-authored script.
 *
 * Nothing is invented here. Every directive is derived from structure the
 * generator already produced:
 *
 *   `[hook]`            the first beat of the first chapter — the opening beat
 *                       IS the hook, which is what the outline prompt asks for.
 *   `[chapter: <title>]` the first beat of every later chapter, titled from the
 *                       outline part it was expanded from.
 *   `[close]`           the last beat of the last chapter.
 *   `[source: k ref]`   attached to the beat the citation was written on, from
 *                       `sources[].chapterIndex` + `sources[].sentence`.
 *   (nothing)           every other beat is connective narration.
 *
 * ## What it deliberately does NOT emit
 *
 * `[fig:]` / `[element:]` / `[doc:]`. Those bind a beat to a finance-kit figure
 * or a named document, and the generator produces neither — guessing which
 * paragraph "is" the DSCR chart would fabricate the one thing design §8 rule 1
 * exists to prevent. A plan built from a converted script therefore carries no
 * motion-graphic scenes. To get figure beats, author the directives on
 * `content_jobs.script`; the pipeline uses an existing script as-is.
 *
 * ## Directive collisions
 *
 * A beat may carry at most one ROLE directive (`classifyBeat` throws on two),
 * and `[close]` is mandatory-and-unique, so where the last beat would also open
 * a chapter, `[close]` wins and the chapter title is dropped rather than
 * producing a plan that cannot be compiled. Likewise a beat carrying more than
 * one citation keeps the first: `[source:]` may appear once per beat, and the
 * full list stays on {@link BusinessHubScriptResult.sources}.
 *
 * @throws {BusinessHubScriptError} `empty-generation` when the result yields
 *   fewer than two beats — the hook and the close must be different beats, and
 *   a one-paragraph script is a failed generation, not a short video.
 */
export function toPlannableScript(result: BusinessHubScriptResult): string {
  interface Beat {
    readonly chapterIndex: number;
    readonly firstOfChapter: boolean;
    readonly chapterTitle: string;
    /** Collapsed to a single line: the planner splits beats on blank lines. */
    readonly text: string;
  }

  const beats: Beat[] = [];
  for (const chapter of result.chapters) {
    const paragraphs = chapter.narration
      .split(/\n{2,}/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter((p) => p.length > 0);
    paragraphs.forEach((text, index) => {
      beats.push({
        chapterIndex: chapter.index,
        firstOfChapter: index === 0,
        chapterTitle: chapter.title,
        text,
      });
    });
  }

  if (beats.length < 2) {
    throw new BusinessHubScriptError(
      "empty-generation",
      `the generated script yields ${beats.length} beat(s). The planner needs a distinct ` +
        `[hook] and [close], so at least two paragraphs of narration are required. This ` +
        `is a failed generation, not a shorter video.`,
    );
  }

  // First citation per beat. A beat is identified by the chapter it came from
  // plus the sentence the citation was attached to.
  const sourceForBeat = new Map<number, SourceRef>();
  for (const tag of result.sources) {
    const sentence = tag.sentence.replace(/\s+/g, " ").trim();
    if (sentence.length === 0) continue;
    const index = beats.findIndex(
      (beat) =>
        beat.chapterIndex === tag.chapterIndex && beat.text.includes(sentence),
    );
    if (index === -1) continue;
    if (!sourceForBeat.has(index)) sourceForBeat.set(index, tag.source);
  }

  const lastIndex = beats.length - 1;
  const lines = beats.map((beat, index) => {
    const directives: string[] = [];
    if (index === 0) {
      directives.push("[hook]");
    } else if (index === lastIndex) {
      directives.push("[close]");
    } else if (beat.firstOfChapter) {
      directives.push(`[chapter: ${beat.chapterTitle.replace(/[[\]]/g, "")}]`);
    }
    const source = sourceForBeat.get(index);
    if (source !== undefined) {
      directives.push(`[source: ${source.kind} ${source.ref}]`);
    }
    return `${directives.join(" ")}${directives.length > 0 ? " " : ""}${beat.text}`;
  });

  return lines.join("\n\n");
}
