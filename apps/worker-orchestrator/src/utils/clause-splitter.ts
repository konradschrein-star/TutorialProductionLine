/**
 * Clause splitter — splits a script string into timed clauses using Whisper word timestamps.
 *
 * Each sentence is split into clauses at comma boundaries and common coordinating /
 * subordinating conjunctions.  For each clause the start_ms and end_ms are derived from
 * the word-level timestamps produced by Whisper and stored in assembly_manifest.word_timestamps.
 *
 * Timing derivation strategy:
 *   1. Build a word→index lookup from the Whisper output (normalised: lowercase, strip punct).
 *   2. For each clause, locate the first and last word in the lookup.
 *   3. If a word is missing from the lookup, slide a small search window forward in the
 *      Whisper array to handle minor transcription variations.
 *   4. ERROR if fewer than 50% of clauses resolve a real Whisper anchor (mirrors the same
 *      gate in packages/domain/src/pacing.ts's computeWordAlignedPacing). No silent fallback
 *      past that point.
 *   5. Clauses with no timing anchor are interpolated proportionally between neighbouring
 *      found timings so the output is always a complete, gapless timeline — each clause's
 *      `matched` flag records whether its timing is real or interpolated/clamped.
 */

import type { WordTimestamp } from "@repo/contracts";

export interface ClauseTiming {
  clause_index: number;
  sentence_index: number; // which sentence this clause came from
  text: string;
  start_ms: number;
  end_ms: number;
  /**
   * True when BOTH start_ms and end_ms came from a real Whisper word lookup
   * (Pass 2); false when either boundary was linearly interpolated (Pass 3)
   * or clamped to 0 / audio end (Pass 4) because the clause's boundary words
   * weren't found in the transcript. clip-selection.ts prefers clause_timings
   * over sentence_timings for exact footage-placement windows, so this lets
   * a caller/QC reviewer tell a real cut from a guess.
   */
  matched: boolean;
}

// Splits on commas and the most common English conjunctions/transitions.
// Uses a lookbehind so the conjunction itself stays attached to the second clause.
const CLAUSE_SPLIT_PATTERN =
  /,\s*|(?<=\s)(and|but|or|so|because|although|while|when|if|since|though|however|yet|nor)\s/gi;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Normalise a raw word token for lookup: lowercase + strip all non-alphanumeric chars. */
function normalise(token: string): string {
  return token.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

/**
 * Split `text` into sentences on sentence-ending punctuation.
 * We include the trailing punctuation in the sentence so the text round-trips cleanly.
 */
function splitIntoSentences(text: string): string[] {
  // Split on . ! ? followed by whitespace or end-of-string.
  // The regex keeps the delimiter attached to the preceding sentence via a lookbehind.
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Split a sentence into clauses using CLAUSE_SPLIT_PATTERN.
 * Very short fragments (< 3 chars after normalisation) are merged back into
 * the previous clause to avoid degenerate single-word clauses.
 */
function splitSentenceIntoClauses(sentence: string): string[] {
  // split() with a capturing group includes undefined entries when an alternative
  // without the capture group matches (e.g. the comma branch). Guard against that.
  const raw = sentence.split(CLAUSE_SPLIT_PATTERN).map((s) => (s ?? "").trim());

  const merged: string[] = [];
  for (const part of raw) {
    if (!part) continue;
    // Merge back trivially short fragments (conjunctions captured as their own split group)
    if (part.length < 3 && merged.length > 0) {
      merged[merged.length - 1] += " " + part;
    } else {
      merged.push(part);
    }
  }

  return merged.filter((s) => s.length > 0);
}

/**
 * Extract the words from a clause text as an array of normalised tokens,
 * filtering out pure-punctuation / empty tokens.
 */
function clauseWords(clauseText: string): string[] {
  return clauseText
    .split(/\s+/)
    .map(normalise)
    .filter((w) => w.length > 0);
}

// ---------------------------------------------------------------------------
// Core lookup structures built from the Whisper word list
// ---------------------------------------------------------------------------

interface WordEntry {
  /** Whisper array index */
  index: number;
  start_ms: number;
  end_ms: number;
}

/**
 * Build a map from normalised word → array of all WordEntry occurrences.
 * A word may appear multiple times; we keep all positions so we can pick
 * the one closest to our expected position.
 */
function buildWordIndex(
  wordTimings: WordTimestamp[],
): Map<string, WordEntry[]> {
  const map = new Map<string, WordEntry[]>();
  for (let i = 0; i < wordTimings.length; i++) {
    const wt = wordTimings[i]!;
    const key = normalise(wt.word);
    if (!key) continue; // pure punctuation / whitespace token
    const entry: WordEntry = {
      index: i,
      start_ms: Math.round(wt.start * 1000),
      end_ms: Math.round(wt.end * 1000),
    };
    const existing = map.get(key);
    if (existing) {
      existing.push(entry);
    } else {
      map.set(key, [entry]);
    }
  }
  return map;
}

/**
 * Find the best matching WordEntry for `normalised` given a hint about where
 * in the Whisper array we expect it to be (`searchStartIndex`).
 *
 * Strategy:
 *   1. Look up all occurrences of the word.
 *   2. Return the one whose index is closest to (and >= ) searchStartIndex.
 *   3. If none found at or after searchStartIndex, accept the closest before it
 *      (handles reordered/skipped words).
 *
 * Returns null if the word does not exist in the index at all.
 */
function findWord(
  wordIndex: Map<string, WordEntry[]>,
  normalised: string,
  searchStartIndex: number,
): WordEntry | null {
  const occurrences = wordIndex.get(normalised);
  if (!occurrences || occurrences.length === 0) return null;

  // Prefer the occurrence closest to searchStartIndex (at or after it)
  let bestAfter: WordEntry | null = null;
  let bestBefore: WordEntry | null = null;

  for (const occ of occurrences) {
    if (occ.index >= searchStartIndex) {
      if (!bestAfter || occ.index < bestAfter.index) bestAfter = occ;
    } else {
      if (!bestBefore || occ.index > bestBefore.index) bestBefore = occ;
    }
  }

  return bestAfter ?? bestBefore;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Split `script` into timed clauses using `wordTimings` from Whisper.
 *
 * @param script       The full narration script text.
 * @param wordTimings  Word-level timestamps from Whisper (start/end in seconds).
 * @returns            An array of ClauseTiming objects with ms timestamps.
 */
export function splitIntoClauses(
  script: string,
  wordTimings: WordTimestamp[],
): ClauseTiming[] {
  if (!script.trim() || wordTimings.length === 0) return [];

  const wordIndex = buildWordIndex(wordTimings);
  const sentences = splitIntoSentences(script);

  // ------------------------------------------------------------------
  // Pass 1: collect all clauses with their raw text and sentence origin
  // ------------------------------------------------------------------
  interface RawClause {
    clause_index: number;
    sentence_index: number;
    text: string;
  }

  const rawClauses: RawClause[] = [];
  let clauseCounter = 0;

  for (let si = 0; si < sentences.length; si++) {
    const sentence = sentences[si]!;
    const clauses = splitSentenceIntoClauses(sentence);
    for (const clauseText of clauses) {
      rawClauses.push({
        clause_index: clauseCounter++,
        sentence_index: si,
        text: clauseText,
      });
    }
  }

  if (rawClauses.length === 0) return [];

  // ------------------------------------------------------------------
  // Pass 2: resolve start_ms / end_ms for each clause
  // We maintain a `cursor` (Whisper array index) that advances monotonically
  // through the word list as we process clauses left-to-right.
  // ------------------------------------------------------------------

  // Intermediate result: nullable timings; we fill gaps in Pass 3.
  interface TimedClause extends RawClause {
    start_ms: number | null;
    end_ms: number | null;
  }

  const timed: TimedClause[] = rawClauses.map((c) => ({
    ...c,
    start_ms: null,
    end_ms: null,
  }));

  let cursor = 0; // current expected position in wordTimings

  for (const tc of timed) {
    const words = clauseWords(tc.text);
    if (words.length === 0) continue;

    const firstWord = words[0]!;
    const lastWord = words[words.length - 1]!;

    // Find first word
    const firstEntry = findWord(wordIndex, firstWord, cursor);
    if (firstEntry) {
      tc.start_ms = firstEntry.start_ms;
      // Advance cursor past the first word's position
      cursor = firstEntry.index + 1;
    }

    // Find last word — search from cursor (after first word)
    const lastEntry = findWord(wordIndex, lastWord, cursor);
    if (lastEntry) {
      tc.end_ms = lastEntry.end_ms;
      // Advance cursor past the last word
      cursor = lastEntry.index + 1;
    } else if (firstEntry) {
      // Last word not found but first word was — use first word's end as clause end
      tc.end_ms = firstEntry.end_ms;
    }
  }

  // ------------------------------------------------------------------
  // Pass 2.5: gate on match quality — no silent fallback past this point.
  // Mirrors the ≥50% gate established in packages/domain/src/pacing.ts's
  // computeWordAlignedPacing / computeSentenceImageTimings: a clause counts
  // as "matched" only when BOTH start_ms and end_ms were resolved from a
  // real Whisper word lookup in Pass 2 above — not by the interpolation
  // (Pass 3) or clamping (Pass 4) that follow.
  // ------------------------------------------------------------------
  const matchedFlags: boolean[] = timed.map(
    (tc) => tc.start_ms !== null && tc.end_ms !== null,
  );
  const matchedCount = matchedFlags.filter(Boolean).length;
  const matchRate = matchedCount / timed.length;

  console.log(
    `[Clause Splitter] Matched ${matchedCount}/${timed.length} clauses (${(matchRate * 100).toFixed(1)}%)`,
  );
  timed.forEach((tc, i) => {
    console.log(
      `  Clause ${tc.clause_index} (sentence ${tc.sentence_index}): "${tc.text}" → ${matchedFlags[i] ? "✓" : "✗"}`,
    );
  });

  // ERROR if fewer than 50% matched — no silent fallback. Same gate/style as
  // computeWordAlignedPacing in packages/domain/src/pacing.ts for the same
  // class of failure: unmatched clause boundaries would otherwise be
  // silently linear-interpolated (Pass 3) or clamped (Pass 4) into
  // plausible-looking but fabricated cut points — and clip-selection.ts
  // prefers clause_timings over sentence_timings for exact footage
  // placement, so a low match rate here directly risks desynced footage.
  if (matchRate < 0.5) {
    const failedClauses = timed.filter((_, i) => !matchedFlags[i]);
    const diagnosticReport = failedClauses
      .slice(0, 5) // Show first 5 failures
      .map(
        (tc) =>
          `  Clause ${tc.clause_index} (sentence ${tc.sentence_index}): "${tc.text}"`,
      )
      .join("\n");

    throw new Error(
      `Clause alignment failed: Only ${matchedCount}/${timed.length} clauses (${(matchRate * 100).toFixed(1)}%) matched.\n` +
        `Require ≥50% match rate. Check for:\n` +
        `- Misspellings between script and TTS audio\n` +
        `- Script text not present in audio\n` +
        `- Wrong script attached to this job's TTS output\n\n` +
        `Failed clauses (first 5):\n${diagnosticReport}`,
    );
  }

  // ------------------------------------------------------------------
  // Pass 3: interpolate missing timings
  // ------------------------------------------------------------------

  // Anchor: total audio duration from last Whisper word
  const audioDurationMs = Math.round(
    wordTimings[wordTimings.length - 1]!.end * 1000,
  );

  // Forward-fill start_ms for the first clause if missing
  if (timed[0]!.start_ms === null) {
    timed[0]!.start_ms = 0;
  }

  // Backward-fill end_ms for the last clause if missing
  if (timed[timed.length - 1]!.end_ms === null) {
    timed[timed.length - 1]!.end_ms = audioDurationMs;
  }

  // Fill interior gaps using linear interpolation between nearest known anchors
  for (let i = 0; i < timed.length; i++) {
    if (timed[i]!.start_ms !== null && timed[i]!.end_ms !== null) continue;

    // Find the last known end_ms before i
    let prevEndMs = 0;
    for (let j = i - 1; j >= 0; j--) {
      if (timed[j]!.end_ms !== null) {
        prevEndMs = timed[j]!.end_ms!;
        break;
      }
    }

    // Find the next known start_ms after i
    let nextStartMs = audioDurationMs;
    for (let j = i + 1; j < timed.length; j++) {
      if (timed[j]!.start_ms !== null) {
        nextStartMs = timed[j]!.start_ms!;
        break;
      }
    }

    // Count how many consecutive clauses need interpolation in this gap
    let gapCount = 0;
    for (let j = i; j < timed.length; j++) {
      if (timed[j]!.start_ms !== null && timed[j]!.end_ms !== null) break;
      gapCount++;
    }

    // Distribute the gap evenly
    const span = nextStartMs - prevEndMs;
    const sliceSize = gapCount > 0 ? span / gapCount : 0;

    for (let k = 0; k < gapCount; k++) {
      const tc2 = timed[i + k]!;
      if (tc2.start_ms === null) {
        tc2.start_ms = Math.round(prevEndMs + k * sliceSize);
      }
      if (tc2.end_ms === null) {
        tc2.end_ms = Math.round(prevEndMs + (k + 1) * sliceSize);
      }
    }
  }

  // ------------------------------------------------------------------
  // Pass 4: build final output, clamping any remaining nulls to safe values
  // ------------------------------------------------------------------
  const result: ClauseTiming[] = timed.map((tc, i) => ({
    clause_index: tc.clause_index,
    sentence_index: tc.sentence_index,
    text: tc.text,
    start_ms: tc.start_ms ?? 0,
    end_ms: tc.end_ms ?? audioDurationMs,
    matched: matchedFlags[i]!,
  }));

  return result;
}
