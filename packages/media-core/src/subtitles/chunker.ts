import type {
  WordTimestamp,
  ChunkerOptions,
  CaptionWord,
  CaptionChunk,
  CaptionPlan,
} from "./types.js";
import { MIN_CUE_SECONDS, estimateTextWidthEm } from "./layout.js";

// ===========================================================================
// v2 chunker — produces a CaptionPlan (engine-agnostic segmentation brain).
// Spec: docs/superpowers/specs/2026-07-26-global-subtitle-system-design.md §3.2
// ===========================================================================

const DEFAULT_LARGE_SILENCE_MS = 600;

/** Trailing punctuation we may strip, depending on punctuationMode. */
const TRAILING_PUNCT = /[.,!?;:"'’”)…]+$/u;
/** Only `. , ; :` are stripped in 'soft' mode ( ! ? and quotes are kept ). */
const SOFT_STRIP = /[.,;:]+$/u;

/** Abbreviations whose trailing period must NOT be read as a sentence end. */
const ABBREVIATIONS = new Set([
  "mr.",
  "mrs.",
  "ms.",
  "dr.",
  "prof.",
  "sr.",
  "jr.",
  "st.",
  "vs.",
  "etc.",
  "e.g.",
  "i.e.",
  "no.",
  "fig.",
  "inc.",
  "ltd.",
]);

/** Articles that couple to the following noun. */
const ARTICLES = new Set(["a", "an", "the"]);

/** Units that couple to a preceding number (number + unit protection). */
const UNITS = new Set([
  "km",
  "kg",
  "m",
  "cm",
  "mm",
  "ft",
  "in",
  "lb",
  "lbs",
  "mph",
  "kmh",
  "kph",
  "gb",
  "mb",
  "kb",
  "tb",
  "hz",
  "khz",
  "mhz",
  "ghz",
  "s",
  "ms",
  "min",
  "mins",
  "hr",
  "hrs",
  "l",
  "ml",
  "oz",
  "pt",
  "k",
  "percent",
  "%",
]);

function stripTrailingPunct(
  token: string,
  mode: "all" | "soft" | "none",
): string {
  if (mode === "all") return token;
  if (mode === "soft") return token.replace(SOFT_STRIP, "") || token;
  // none — strip all trailing punctuation
  return token.replace(TRAILING_PUNCT, "") || token;
}

function applyCase(
  token: string,
  textCase: "asIs" | "upper" | "lower",
): string {
  if (textCase === "upper") return token.toUpperCase();
  if (textCase === "lower") return token.toLowerCase();
  return token;
}

/** True when the RAW token ends a sentence (period/!/? not an abbreviation). */
function endsSentence(raw: string): boolean {
  const trimmed = raw.trim();
  if (!/[.!?]["'’”)]*$/u.test(trimmed)) return false;
  const lower = trimmed.toLowerCase();
  if (ABBREVIATIONS.has(lower)) return false;
  // Single-letter initial like "J." — treat as not a sentence end.
  if (/^[a-z]\.$/i.test(trimmed)) return false;
  return true;
}

function isNumberLike(raw: string): boolean {
  return /\d/.test(raw);
}

function isCapitalized(raw: string): boolean {
  return /^[A-Z][a-zA-Z’'-]*$/.test(raw.trim());
}

/**
 * Coupled-word protection table. Returns true when `a` and `b` are tightly
 * coupled and must not be split across a chunk boundary. Uses the RAW tokens so
 * capitalization survives a textCase transform. (Tuning heuristic — see spec.)
 */
function areCoupled(rawA: string, rawB: string): boolean {
  const a = rawA.trim();
  const b = rawB.trim();
  const bBare = b.replace(TRAILING_PUNCT, "").toLowerCase();
  // number + unit (e.g. "5 km", "10 %")
  if (isNumberLike(a) && (UNITS.has(bBare) || isNumberLike(b))) return true;
  // article + noun (e.g. "the dog")
  if (ARTICLES.has(a.replace(TRAILING_PUNCT, "").toLowerCase())) return true;
  // multi-word proper noun (e.g. "New York")
  if (isCapitalized(a) && isCapitalized(b)) return true;
  return false;
}

function validateWords(words: WordTimestamp[]): void {
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (
      typeof w.start !== "number" ||
      typeof w.end !== "number" ||
      Number.isNaN(w.start) ||
      Number.isNaN(w.end)
    ) {
      throw new Error(
        `chunkWords: word ${i} ("${w.word}") has non-numeric timings ` +
          `(start=${w.start}, end=${w.end}).`,
      );
    }
    if (w.end < w.start) {
      throw new Error(
        `chunkWords: word ${i} ("${w.word}") ends before it starts ` +
          `(start=${w.start}, end=${w.end}).`,
      );
    }
    if (i > 0) {
      const prev = words[i - 1]!;
      if (w.start < prev.start) {
        throw new Error(
          `chunkWords: non-monotonic timings — word ${i} ("${w.word}") starts ` +
            `at ${w.start}, before previous word ("${prev.word}") start ${prev.start}.`,
        );
      }
    }
  }
}

/** Transform raw words into CaptionWords (punctuation + case), role='normal'. */
function transformWords(
  words: WordTimestamp[],
  opts: ChunkerOptions,
): CaptionWord[] {
  return words.map((w) => {
    const stripped = stripTrailingPunct(w.word, opts.punctuationMode);
    return {
      word: applyCase(stripped, opts.textCase),
      raw: w.word,
      start: w.start,
      end: w.end,
      role: "normal",
      ...(w.speakerId !== undefined ? { speakerId: w.speakerId } : {}),
    };
  });
}

/**
 * Wrap a chunk into lines.
 *
 * Two constraints, in priority order:
 *
 *  1. HARD: no line may exceed `budgetEm` (the caption's safe width, in em of
 *     its own font size). A line that overflows gets re-wrapped independently by
 *     Chrome in the Remotion engine and by libass in the ASS engine, and they
 *     break at different words — so the chunker must never emit one. This can
 *     legitimately produce MORE than `maxLines` lines; that is strictly better
 *     than an overflow the two renderers resolve differently.
 *  2. SOFT: aim for `maxLines` balanced lines.
 *
 * `budgetEm` is Infinity when the caller did not say what frame it is building
 * for, which reduces this to the balance-only behaviour.
 */
function wrapLines(
  words: CaptionWord[],
  maxLines: number,
  budgetEm: number,
  fontWeight: number,
): CaptionWord[][] {
  if (words.length <= 1) return [words];

  const widthOf = (text: string) => estimateTextWidthEm(text, fontWeight);
  const spaceEm = widthOf(" ");
  const wordEm = words.map((w) => widthOf(w.word));
  const totalEm =
    wordEm.reduce((a, b) => a + b, 0) + spaceEm * (words.length - 1);

  // How many lines this text ACTUALLY needs. When the budget forces more than
  // `maxLines`, balance across the real count — otherwise the greedy fill packs
  // the early lines to the target and strands a single short word on the last
  // one ("Most people" / "think subtitles" / "are").
  const linesNeeded = Number.isFinite(budgetEm)
    ? Math.max(maxLines, Math.ceil(totalEm / budgetEm))
    : maxLines;

  // Balance target: the width each line carries if the text is split evenly
  // across `linesNeeded`. Never wider than the hard budget.
  const lineTarget =
    linesNeeded > 1 ? Math.min(budgetEm, totalEm / linesNeeded) : budgetEm;

  const lines: CaptionWord[][] = [];
  let line: CaptionWord[] = [];
  let lineEm = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const projected =
      line.length === 0 ? wordEm[i]! : lineEm + spaceEm + wordEm[i]!;

    const overBudget = projected > budgetEm;
    const overTarget = projected > lineTarget && lines.length < linesNeeded - 1;

    if (line.length > 0 && (overBudget || overTarget)) {
      lines.push(line);
      line = [w];
      lineEm = wordEm[i]!;
    } else {
      line.push(w);
      lineEm = projected;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/**
 * v2 chunker: WordTimestamp[] + rules -> CaptionPlan. Pure function.
 * Throws on malformed input (no silent fallbacks — bad captions are worse than
 * a hard error, per project rule D9).
 */
export function chunkWords(
  words: WordTimestamp[],
  options: ChunkerOptions,
): CaptionPlan {
  if (words.length === 0) return [];
  validateWords(words);

  const opts = options;
  const wpc = Math.max(1, Math.floor(opts.wordsPerChunk));
  const silenceMs = opts.largeSilenceThresholdMs ?? DEFAULT_LARGE_SILENCE_MS;
  const shortMax = opts.oneWordMode.shortWordMaxLen;
  const pairShort = opts.oneWordMode.pairShortWords;
  const cw = transformWords(words, opts);
  const n = cw.length;

  // The per-chunk word budget. In one-word mode with pairing, two adjacent
  // short words may share a chunk.
  const chunkLimit = (start: number): number => {
    if (wpc !== 1) return wpc;
    if (
      pairShort &&
      cw[start + 1] &&
      cw[start]!.word.length <= shortMax &&
      cw[start + 1]!.word.length <= shortMax
    ) {
      return 2;
    }
    return 1;
  };

  // 1. Group into index ranges applying smartSplit rules.
  const ranges: Array<[number, number]> = []; // [startInclusive, endExclusive)
  // Whether the boundary AFTER each range is semantically hard (sentence end or
  // a long silence). The minimum-duration pass below must never merge across
  // one of these, because that would put words from two sentences — or from
  // either side of a pause — into the same caption.
  const hardBreakAfter: boolean[] = [];
  let start = 0;
  while (start < n) {
    const limit = chunkLimit(start);
    let i = start;
    // Whether the boundary was forced by a sentence end / large silence (a
    // semantically hard break) vs a soft count-based break. Anti-strand only
    // applies to soft breaks — pulling a word across a hard break is wrong.
    let forcedBreak = false;
    while (i < n) {
      const w = cw[i]!;
      const next = cw[i + 1];
      const count = i - start + 1;

      // smartSplit (a): sentence-end look-ahead — break AT the boundary.
      if (opts.smartSplit && endsSentence(w.raw)) {
        i++;
        forcedBreak = true;
        break;
      }
      // smartSplit (c): large-silence break.
      if (opts.smartSplit && next) {
        const gapMs = (next.start - w.end) * 1000;
        if (gapMs > silenceMs) {
          i++;
          forcedBreak = true;
          break;
        }
      }
      // count-based break, with coupled-word protection.
      if (count >= limit) {
        if (
          opts.smartSplit &&
          next &&
          areCoupled(w.raw, next.raw) &&
          count < wpc + 3 // cap runaway growth
        ) {
          i++;
          continue; // keep the coupled tokens together
        }
        i++;
        break;
      }
      i++;
    }

    let end = i;
    // smartSplit (b): never strand a trailing 1-2 char word — pull it forward.
    // Only for soft (count-based) breaks; a forced break boundary is correct.
    if (
      opts.smartSplit &&
      !forcedBreak &&
      end - start > 1 &&
      end < n &&
      cw[end - 1]!.word.length <= 2 &&
      !endsSentence(cw[end - 1]!.raw)
    ) {
      end -= 1;
    }
    ranges.push([start, end]);
    hardBreakAfter.push(forcedBreak);
    start = end;
  }

  // 1b. Minimum on-screen duration.
  //
  // Subtitle specs put the shortest readable cue at about five-sixths of a
  // second; below that a caption reads as a flash. Fast speech plus a small
  // wordsPerChunk regularly produces sub-half-second cues, which is a large part
  // of why the captions felt twitchy.
  //
  // This ONLY ever merges adjacent ranges — it never moves, stretches or
  // invents a timestamp, and it never merges across a sentence end or a long
  // silence. A cue that is still too short after that (a genuinely isolated
  // short utterance) is left alone rather than falsified.
  const cueSpan = (i: number): number => {
    const [s, e] = ranges[i]!;
    // With gapFree the cue actually lives until the NEXT cue begins.
    const endTime =
      opts.gapFree && i + 1 < ranges.length
        ? cw[ranges[i + 1]![0]]!.start
        : cw[e - 1]!.end;
    return endTime - cw[s]!.start;
  };
  // Absorbing a stranded short cue is worth at most a couple of extra words;
  // doubling the caption would push it past the ~42-characters-per-line budget.
  const mergeCap = wpc + 2;
  // One-word mode is a deliberate style whose cues are SUPPOSED to be short.
  // Merging there would silently defeat the preset, so it is left alone.
  const enforceMinCue = wpc > 1;
  for (let i = 0; enforceMinCue && i < ranges.length; i++) {
    if (ranges.length < 2) break;
    if (cueSpan(i) >= MIN_CUE_SECONDS) continue;

    const size = (j: number) => ranges[j]![1] - ranges[j]![0];
    // Prefer merging forward (the next cue continues the same thought).
    if (
      i + 1 < ranges.length &&
      !hardBreakAfter[i] &&
      size(i) + size(i + 1) <= mergeCap
    ) {
      ranges[i]![1] = ranges[i + 1]![1];
      hardBreakAfter[i] = hardBreakAfter[i + 1]!;
      ranges.splice(i + 1, 1);
      hardBreakAfter.splice(i + 1, 1);
      i -= 1; // re-test the merged range
      continue;
    }
    if (i > 0 && !hardBreakAfter[i - 1] && size(i - 1) + size(i) <= mergeCap) {
      ranges[i - 1]![1] = ranges[i]![1];
      hardBreakAfter[i - 1] = hardBreakAfter[i]!;
      ranges.splice(i, 1);
      hardBreakAfter.splice(i, 1);
      // Re-test the range we merged into (now at i-1); the loop's i++ lands there.
      i = Math.max(-1, i - 2);
      continue;
    }
    // Genuinely un-mergeable: leave the short cue rather than fake its timing.
  }

  // 2. Build chunks (start/end from first/last word, line wrapping).
  const plan: CaptionChunk[] = ranges.map(([s, e]) => {
    const chunkWordList = cw.slice(s, e);
    const lines = opts.breakLines
      ? wrapLines(
          chunkWordList,
          opts.maxLines,
          opts.lineWidthBudgetEm ?? Infinity,
          opts.fontWeight ?? 400,
        )
      : [chunkWordList];
    // Chunk-level speakerId (drives the SpeakerHeading) is only set when every
    // word in the chunk agrees on the same speaker — a chunk straddling two
    // speakers is ambiguous, so it renders no heading rather than a wrong one.
    const firstSpeaker = chunkWordList[0]!.speakerId;
    const speakerId =
      firstSpeaker !== undefined &&
      chunkWordList.every((w) => w.speakerId === firstSpeaker)
        ? firstSpeaker
        : undefined;
    return {
      words: chunkWordList,
      lines,
      start: chunkWordList[0]!.start,
      end: chunkWordList[chunkWordList.length - 1]!.end,
      ...(speakerId !== undefined ? { speakerId } : {}),
    };
  });

  // 3. gapFree — extend each chunk end to the next chunk start (no blank frames).
  if (opts.gapFree) {
    for (let k = 0; k < plan.length - 1; k++) {
      plan[k]!.end = plan[k + 1]!.start;
    }
  }

  return plan;
}
