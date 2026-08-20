export interface WordTiming {
  word: string;
  start_ms: number;
  end_ms: number;
}

/**
 * Given a target timestamp in ms, find the nearest natural pause in the
 * word timings — defined as a gap between consecutive words >= minGapMs.
 * Returns the end_ms of the word just before the pause.
 * Falls back to target if no qualifying pause is found within searchWindowMs.
 */
export function snapToPause(
  targetMs: number,
  wordTimings: WordTiming[],
  minGapMs = 200,
  searchWindowMs = 3000,
): number {
  if (wordTimings.length === 0) return targetMs;

  const lo = targetMs - searchWindowMs;
  const hi = targetMs + searchWindowMs;

  let bestMs = targetMs;
  let bestDist = Infinity;

  for (let i = 0; i < wordTimings.length - 1; i++) {
    const curr = wordTimings[i]!;
    const next = wordTimings[i + 1]!;
    const gapMs = next.start_ms - curr.end_ms;
    if (gapMs < minGapMs) continue;
    const pauseMs = curr.end_ms;
    if (pauseMs < lo || pauseMs > hi) continue;
    const dist = Math.abs(pauseMs - targetMs);
    if (dist < bestDist) {
      bestDist = dist;
      bestMs = pauseMs;
    }
  }

  return bestMs;
}

/**
 * Extract sentence boundaries from word timings.
 * A sentence ends when a word ends in punctuation (.!?) and is followed by
 * a gap >= minPauseMs OR the next word starts with a capital letter.
 * Returns array of end_ms timestamps.
 */
export function extractSentenceBoundaries(
  wordTimings: WordTiming[],
  minPauseMs = 150,
): number[] {
  const boundaries: number[] = [];
  const sentenceEnders = /[.!?]$/;

  for (let i = 0; i < wordTimings.length - 1; i++) {
    const curr = wordTimings[i]!;
    const next = wordTimings[i + 1]!;
    const isPunctEnd = sentenceEnders.test(curr.word.trim());
    const hasGap = next.start_ms - curr.end_ms >= minPauseMs;
    const nextIsCapital = /^[A-Z]/.test(next.word.trim());

    if (isPunctEnd && (hasGap || nextIsCapital)) {
      boundaries.push(curr.end_ms);
    }
  }

  const lastWord = wordTimings[wordTimings.length - 1];
  if (lastWord) boundaries.push(lastWord.end_ms);

  return boundaries;
}
