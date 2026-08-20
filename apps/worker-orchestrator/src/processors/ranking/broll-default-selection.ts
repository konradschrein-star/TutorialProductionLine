import {
  BLOCK_DURATION_MS,
  computeItemWindow,
  type BRollSelection,
  type FootageCandidate,
  type RankingItem,
} from "@repo/contracts";

/**
 * The default B-roll fill a freshly collected RANKING item is seeded with.
 *
 * ## Why this exists (the 2026-08-04 "I can't approve shit" bug)
 *
 * `ranking-footage-collection.ts` used to seed every item's `brollSelection` as
 * a single `0 → BLOCK_DURATION_MS` segment — the FIXED-cadence constant, 4000
 * ms — regardless of anchoring. But a real block's window is narration-anchored:
 * the item's spoken span minus the tier and reveal beats, which on a live job is
 * 44–58 SECONDS.
 *
 * The B-Roll Studio's approve gate requires `|Σ segment durations −
 * blockDurationMs| ≤ SELECTION_TOLERANCE_MS` (80 ms), and every studio control
 * is Σ-preserving by construction: boundary drags trade duration between
 * neighbours, split cuts one segment in two, remove donates the freed span to a
 * neighbour, a source-row drag slides a window without resizing it. So a block
 * that ARRIVED with Σ = 4000 ms against a 46 920 ms window could never be
 * approved and the VA had no control that could fix it.
 *
 * hub-web repairs this on read and on PATCH (`lib/broll-selection-fit.ts`), so
 * no job is blocked today — but the rows were still being WRITTEN wrong, and
 * every consumer that reads `metadata.ranking` without going through that repair
 * (the renderer's full_auto path included) saw the 4-second seed.
 *
 * ## Agreeing with the fit rather than fighting it
 *
 * `fitSelectionToBlock([], target, caps)` — the studio's answer for "no
 * selection at all" — is exactly:
 *
 *     [{ candidateIndex: 0, startMs: 0, endMs: min(target, capOf(0)) }]
 *
 * with anything it could not cover reported as a shortfall rather than padded.
 * This module produces that same value at seed time, so the studio's refit is a
 * no-op on a fresh job instead of a correction. Kept as a mirror rather than an
 * import: the root eslint config forbids `apps/*` → `apps/*`, and the shot
 * geometry both sides depend on already lives in `@repo/contracts`
 * (`schemas/ranking-timing.ts`), which is what actually prevents drift.
 *
 * ## No synthetic fallbacks
 *
 * When candidate 0's clip is shorter than the block, the seed is the clip's real
 * length — it is NOT looped, padded or stretched to fake a full block. The
 * studio's existing shortfall warning tells the VA to add a longer source. When
 * there is no candidate at all, nothing is seeded: an item with no footage must
 * look like an item with no footage.
 */

/** Smallest seed the studio will accept back (matches its split/boundary MIN). */
const MIN_SEGMENT_MS = 200;

/**
 * The B-roll window length (ms) for an item.
 *
 * Anchored (the item carries a Whisper-derived spoken segment) → the real middle
 * of that segment, via the ONE definition in `@repo/contracts`. Unanchored → the
 * fixed constant, which is what the studio also falls back to for an item whose
 * anchoring has not run yet. Mirrors hub-web's `itemBlockWindow`.
 */
export function brollWindowMsForItem(
  item: Pick<RankingItem, "narrationStartMs" | "narrationEndMs">,
): number {
  if (
    typeof item.narrationStartMs === "number" &&
    typeof item.narrationEndMs === "number" &&
    item.narrationEndMs > item.narrationStartMs
  ) {
    return computeItemWindow(item.narrationStartMs, item.narrationEndMs)
      .brollDurationMs;
  }
  return BLOCK_DURATION_MS;
}

/** Candidate 0's length in ms, or Infinity when it is unknown — UNCONSTRAINED,
 *  never guessed. Mirrors `capOf` in `broll-selection-fit`. */
function candidateCapMs(candidates: readonly FootageCandidate[]): number {
  const d = candidates[0]?.durationSeconds;
  return typeof d === "number" && d > 0 ? d * 1000 : Number.POSITIVE_INFINITY;
}

/**
 * The default fill for one item: candidate 0, from its start, for as much of the
 * block window as that clip actually holds.
 *
 * Returns `undefined` when there is no candidate to point at, or when the window
 * is degenerate — the caller keeps whatever the item already had rather than
 * writing an invented segment.
 */
export function defaultBrollSelection(
  item: Pick<RankingItem, "narrationStartMs" | "narrationEndMs">,
  candidates: readonly FootageCandidate[],
): BRollSelection | undefined {
  if (candidates.length === 0) return undefined;
  const target = Math.round(brollWindowMsForItem(item));
  const endMs = Math.round(Math.min(target, candidateCapMs(candidates)));
  if (endMs < MIN_SEGMENT_MS) return undefined;
  return { segments: [{ candidateIndex: 0, startMs: 0, endMs }] };
}

/**
 * True when a selection is still the untouched seed this module writes: one
 * segment, on candidate 0, starting at 0.
 *
 * Used to decide what may be re-seeded once narration anchoring has run (it runs
 * AFTER footage collection, so the collection-time seed cannot know the real
 * window). Anything of another shape came from a VA and is left alone — the
 * studio's own refit handles those, and silently rewriting a human's trim is
 * exactly the kind of invisible change this codebase forbids.
 */
export function isUntouchedSeed(
  selection: BRollSelection | undefined,
): boolean {
  if (!selection || selection.segments.length !== 1) return false;
  const seg = selection.segments[0];
  return seg !== undefined && seg.candidateIndex === 0 && seg.startMs === 0;
}

/**
 * Re-seed the default fill for every item that still carries the untouched seed,
 * now that the item's anchored window is known.
 *
 * Called from `asset-collection.ts` immediately after narration anchoring, which
 * is the first moment `narrationStartMs`/`narrationEndMs` exist. Items with a
 * VA-shaped selection, or with no candidates, pass through unchanged.
 */
export function reseedDefaultBrollSelections(
  items: readonly RankingItem[],
): RankingItem[] {
  return items.map((item) => {
    if (!isUntouchedSeed(item.brollSelection)) return item;
    const seeded = defaultBrollSelection(item, item.footageCandidates ?? []);
    return seeded === undefined ? item : { ...item, brollSelection: seeded };
  });
}
