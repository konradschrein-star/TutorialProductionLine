/**
 * B-Roll Selection Studio — fit a selection to its block window.
 *
 * ## Why this exists (the 2026-08-04 "I can't approve shit" bug)
 *
 * A RANKING block's B-roll window is narration-anchored: its length is the
 * item's real spoken span minus the tier + reveal beats, which on a real job is
 * 44–58 SECONDS. But `ranking-footage-collection.ts` seeds every item's default
 * `brollSelection` as a single `0 → BLOCK_DURATION_MS` segment — the FIXED-
 * timing constant, 4000 ms — regardless of anchoring.
 *
 * The studio's whole selection model is Σ-preserving by design: the block
 * timeline divides a fixed total, boundary drags trade duration between
 * neighbours, split cuts a segment in two, remove donates the freed span to a
 * neighbour, and a source-row drag slides a window without changing its length.
 * Not one operation can change Σ. So a block that ARRIVES with Σ = 4000 ms
 * against a 46 920 ms window can never satisfy the approve validator
 * (`|Σ − blockDurationMs| ≤ SELECTION_TOLERANCE_MS`), and the VA has no control
 * that could make it. Every block of every anchored job was unapprovable.
 *
 * The control was not the problem and the validator was not wrong — the seed
 * value was. This module repairs the seed: it rescales a selection so Σ equals
 * the block window exactly, preserving the VA's proportions and each segment's
 * source position, and clamping every segment to the length of the clip it
 * points at.
 *
 * Deliberately dependency-free (plain numbers in, plain numbers out) so BOTH
 * the server (`ranking-blocks.ts`) and the browser bundle (the studio client)
 * can call the SAME implementation. Do not re-inline a copy — see the header of
 * `@repo/contracts/schemas/ranking-timing` for what hand-synced duplicates cost
 * this codebase.
 *
 * ## No synthetic fallbacks
 *
 * When the available sources genuinely cannot cover the block, this does NOT
 * pad, loop or invent footage. It returns the best honest fit plus
 * `shortfallMs`, and the caller surfaces it: the VA must add a longer clip.
 */

/** ±tolerance (ms) allowed between Σ segment durations and the block length. */
export const SELECTION_TOLERANCE_MS = 80;

/** Smallest segment the studio will produce (matches the split/boundary MIN). */
const MIN_SEGMENT_MS = 200;

export interface FitSegment {
  candidateIndex: number;
  startMs: number;
  endMs: number;
}

export interface FitResult {
  segments: FitSegment[];
  /** true when the returned segments differ from the input. */
  changed: boolean;
  /**
   * ms by which Σ still falls short of the block after clamping every segment
   * to its source clip. > 0 means the sources are too short — the VA must add
   * or split in a longer clip. Never silently padded.
   */
  shortfallMs: number;
}

const dur = (s: FitSegment): number => Math.max(0, s.endMs - s.startMs);

/** Σ of segment durations. */
export function selectionTotalMs(segments: readonly FitSegment[]): number {
  return segments.reduce((sum, s) => sum + dur(s), 0);
}

/** true when Σ is within tolerance of the block window. */
export function selectionMatchesBlock(
  segments: readonly FitSegment[],
  blockDurationMs: number,
): boolean {
  return (
    Math.abs(selectionTotalMs(segments) - blockDurationMs) <=
    SELECTION_TOLERANCE_MS
  );
}

/**
 * Rescale `segments` so their durations sum to exactly `blockDurationMs`.
 *
 * `candidateDurationsMs[i]` is the length of candidate `i`'s clip, or
 * `undefined` when it is unknown (an older candidate with no probed duration).
 * Unknown means UNCONSTRAINED — we decline to invent a length; the studio's
 * existing "clip too short" row warning covers that case visually.
 *
 * Proportions are preserved, each segment keeps its source position where it
 * can, and no segment is ever longer than the clip it points at.
 */
export function fitSelectionToBlock(
  segments: readonly FitSegment[],
  blockDurationMs: number,
  candidateDurationsMs: ReadonlyArray<number | undefined>,
): FitResult {
  const target = Math.max(0, Math.round(blockDurationMs));

  const capOf = (candidateIndex: number): number => {
    const d = candidateDurationsMs[candidateIndex];
    return typeof d === "number" && d > 0 ? d : Number.POSITIVE_INFINITY;
  };

  // NO CANDIDATES AT ALL → no selection, and the whole block is a shortfall.
  //
  // Every branch below addresses candidate 0, and an unknown duration is
  // treated as unconstrained, so an item that fetched zero footage used to come
  // back with a full-length segment pointing at a candidate that does not
  // exist. Σ then equalled the block window exactly, the approve validator
  // passed, and an item with no footage at all was indistinguishable from a
  // correctly-filled one — it would render as a single still hero for its whole
  // 40-90s segment and fail the frozen-frame QA gate at the very end of the
  // pipeline. Job 75c0cbe8 (2026-08-05) arrived with two such items.
  //
  // This is the synthetic fallback this codebase forbids, so it is reported
  // rather than papered over: the VA gets the real shortfall and must paste or
  // upload a clip before the block can be approved.
  if (candidateDurationsMs.length === 0) {
    return { segments: [], changed: segments.length > 0, shortfallMs: target };
  }

  // No selection at all → one segment on candidate 0 covering the window.
  if (segments.length === 0) {
    const cap = capOf(0);
    const len = Math.min(target, cap);
    return {
      segments: [{ candidateIndex: 0, startMs: 0, endMs: len }],
      changed: true,
      shortfallMs: Math.max(0, target - len),
    };
  }

  const total = selectionTotalMs(segments);
  if (Math.abs(total - target) <= SELECTION_TOLERANCE_MS) {
    return { segments: [...segments], changed: false, shortfallMs: 0 };
  }

  // 1. Scale every segment proportionally; the last one absorbs the rounding so
  //    Σ is exact rather than "exact ± n × 0.5ms".
  const scale = total > 0 ? target / total : 0;
  const wanted: number[] = segments.map((s) =>
    total > 0 ? Math.max(MIN_SEGMENT_MS, Math.round(dur(s) * scale)) : 0,
  );
  if (total === 0) {
    // Degenerate input (zero-length segments): spread the window evenly.
    const each = Math.floor(target / segments.length);
    for (let i = 0; i < wanted.length; i++) wanted[i] = each;
  }
  const drift = target - wanted.reduce((a, b) => a + b, 0);
  wanted[wanted.length - 1] = Math.max(
    MIN_SEGMENT_MS,
    (wanted[wanted.length - 1] ?? 0) + drift,
  );

  // 2. Clamp each to its source clip, accumulating whatever we could not place.
  const caps = segments.map((s) => capOf(s.candidateIndex));
  let deficit = 0;
  for (let i = 0; i < wanted.length; i++) {
    const cap = caps[i]!;
    if (wanted[i]! > cap) {
      deficit += wanted[i]! - cap;
      wanted[i] = Math.floor(cap);
    }
  }

  // 3. Redistribute the deficit onto segments that still have headroom.
  if (deficit > 0) {
    for (let i = 0; i < wanted.length && deficit > 0; i++) {
      const headroom = caps[i]! - wanted[i]!;
      if (headroom <= 0) continue;
      const give = Math.min(headroom, deficit);
      wanted[i] = wanted[i]! + give;
      deficit -= give;
    }
  }

  // 4. Rebuild segments, keeping each one's source position where the clip
  //    allows it (so the VA's framing survives a rescale).
  const out: FitSegment[] = segments.map((s, i) => {
    const len = Math.max(0, Math.round(wanted[i]!));
    const cap = caps[i]!;
    const maxStart = Number.isFinite(cap) ? Math.max(0, cap - len) : Infinity;
    const startMs = Math.round(Math.max(0, Math.min(s.startMs, maxStart)));
    return { candidateIndex: s.candidateIndex, startMs, endMs: startMs + len };
  });

  return {
    segments: out,
    changed: true,
    shortfallMs: Math.max(0, Math.round(deficit)),
  };
}
