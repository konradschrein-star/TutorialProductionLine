// ---------------------------------------------------------------------------
// simulate-timings — turn arbitrary typed text into plausible per-word
// timings so an operator can preview a preset against THEIR OWN copy without
// running a job through Whisper.
//
// This is a PREVIEW SIMULATOR, not pipeline data. It is deliberately not the
// banned "synthetic fallback": nothing downstream ever consumes these numbers,
// they never reach a render, and the UI labels them as simulated. Real renders
// still hard-fail when word timings are missing.
//
// Model:
//   - every word gets a weight from its syllable count (vowel-group estimate),
//     so "extraordinarily" is held longer than "a";
//   - weights are normalised so the AVERAGE word lands exactly on the chosen
//     words-per-minute, which makes the WPM control mean what it says;
//   - each word duration is clamped to a sane speech range;
//   - punctuation adds a pause AFTER the word (comma < sentence end), which is
//     also what drives the chunker's sentence-break and large-silence rules, so
//     the simulated segmentation matches what real speech would produce.
//
// Pure and deterministic — same text + same WPM always gives the same timings.
// ---------------------------------------------------------------------------

export interface SimulatedWord {
  word: string;
  start: number;
  end: number;
}

export interface SimulateOptions {
  /** Speaking rate. Typical narration is 130-170; fast social edits 180-220. */
  wordsPerMinute?: number;
  /** Time before the first word (seconds). */
  leadIn?: number;
}

/** Shortest / longest a single spoken word may last, in seconds. */
export const MIN_WORD_SECONDS = 0.1;
export const MAX_WORD_SECONDS = 1.1;

/** Silence inserted after a word ending in the given punctuation (seconds). */
const SENTENCE_PAUSE = 0.4;
const CLAUSE_PAUSE = 0.18;
const ELLIPSIS_PAUSE = 0.5;
/** Baseline silence between two ordinary words. */
const WORD_GAP = 0.03;

export const DEFAULT_WPM = 150;

/**
 * Rough English syllable count. Counts vowel groups, drops a silent trailing
 * "e", and never returns less than 1. Good enough to make long words feel long.
 */
export function estimateSyllables(token: string): number {
  const w = token.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 1;
  const groups = w.match(/[aeiouy]+/g);
  let n = groups ? groups.length : 1;
  // Silent final "e" ("time", "large") — but not for words like "the" or "be".
  if (w.length > 3 && w.endsWith("e") && !/[aeiouy]e$/.test(w)) n -= 1;
  // "-le" after a consonant is its own syllable ("table", "little").
  if (w.length > 2 && /[^aeiouy]le$/.test(w)) n += 1;
  return Math.max(1, n);
}

/** Pause (seconds) that this token's trailing punctuation implies. */
export function trailingPause(token: string): number {
  const t = token.trim();
  if (/(\.{3}|…)["'’”)]*$/.test(t)) return ELLIPSIS_PAUSE;
  if (/[.!?]["'’”)]*$/.test(t)) return SENTENCE_PAUSE;
  if (/[,;:—–]["'’”)]*$/.test(t)) return CLAUSE_PAUSE;
  return 0;
}

/**
 * Build simulated word timings for `text`.
 *
 * Returns `[]` for blank input — the caller is expected to show its own "type
 * something" state rather than an empty preview pretending to be content.
 */
export function simulateWordTimings(
  text: string,
  options: SimulateOptions = {},
): SimulatedWord[] {
  const wpm = clamp(options.wordsPerMinute ?? DEFAULT_WPM, 40, 400);
  const leadIn = Math.max(0, options.leadIn ?? 0.2);

  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const weights = tokens.map((t) => estimateSyllables(t));
  const avgWeight = weights.reduce((a, b) => a + b, 0) / weights.length;
  // Seconds an average-weight word should occupy at this rate, minus the gap we
  // always insert, so the effective rate really is `wpm`.
  const secondsPerWord = 60 / wpm;
  const baseSpoken = Math.max(MIN_WORD_SECONDS, secondsPerWord - WORD_GAP);

  const out: SimulatedWord[] = [];
  let t = leadIn;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const duration = clamp(
      (weights[i]! / avgWeight) * baseSpoken,
      MIN_WORD_SECONDS,
      MAX_WORD_SECONDS,
    );
    const start = round3(t);
    const end = round3(t + duration);
    out.push({ word: token, start, end });
    t = end + WORD_GAP + trailingPause(token);
  }
  return out;
}

/** Total simulated duration in seconds (0 for empty input). */
export function simulatedDuration(words: SimulatedWord[]): number {
  if (words.length === 0) return 0;
  return words[words.length - 1]!.end;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
