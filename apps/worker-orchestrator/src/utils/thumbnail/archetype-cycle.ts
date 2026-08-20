/**
 * Archetype cycling for thumbnail generation.
 *
 * The owner's requirement, verbatim: "I primarily, from now on, start using:
 * the tutorial #10 for the virtual FD, the tutorial #11, the tutorial #1 best
 * archetype, the tutorial #8, the tutorial #4. That's it. The same cycle of
 * thumbnails I also want to use for entrepreneurs school and for blink
 * blueprint."
 *
 * WHY THIS REPLACED THE LEAST-RECENTLY-USED PICKER
 * ------------------------------------------------
 * The engine used to auto-pick with `pickLeastRecentlyUsedArchetype`, which
 * reads the `thumbnails` usage table and takes the coldest candidate. LRU
 * spreads nicely, but it is a function of GLOBAL HISTORY, not of the job — and
 * that breaks the two properties this system actually needs:
 *
 *  1. REPRODUCIBILITY. Re-running a job (a BullMQ retry, or the operator
 *     pressing regenerate a week later) re-reads a usage table that has moved
 *     on, so it returns a DIFFERENT archetype than the one recorded in the
 *     thumbnail row's brief. The row would then describe a template that was
 *     never used. This codebase has been burned by exactly that class of
 *     untruth before.
 *  2. INDEPENDENCE. Every variant of a batch reads the same usage snapshot, so
 *     the offset hack in the old call site existed purely to stop a 3-variant
 *     batch rendering one archetype three times.
 *
 * The cycle here is the SAME one the host-image cycle already uses
 * (`pickCycleIndex` in ./character.ts — one implementation, deliberately):
 *
 *     index = ( hash(seed) + variantIndex + regenStep ) % candidateCount
 *
 *   * same job, same variant, replayed   -> same archetype (reproducible)
 *   * variants 0/1/2 of one batch        -> three CONSECUTIVE, distinct ones
 *   * regenerate (parentThumbnailId set) -> a step of 1..count-1, so it is
 *                                           GUARANTEED to differ, and is itself
 *                                           reproducible
 *   * different jobs                     -> spread over the whole set
 *
 * THE SALT
 * --------
 * The seed is prefixed with "archetype:" so this cycle is INDEPENDENT of the
 * host-image cycle. Without it both cycles hash the same subject id, so a
 * channel with 5 archetypes and 5 host images would pin archetype #3 to host
 * image #3 forever — a fixed pairing that quietly throws away most of the
 * variation the two cycles were built to produce.
 */

import type { ThumbnailArchetype } from "@repo/db";
import { pickCycleIndex, type CycleSeed } from "./character.js";

/** Keeps the archetype ring independent of the host-image ring. */
const ARCHETYPE_CYCLE_SALT = "archetype:";

/**
 * An archetype carrying its channel-link weight (migration 0070).
 *
 * The owner grades his curated set rather than treating it flat: "I want to
 * give the tutorial #1 Best Archetype a higher RNG so that we use it more
 * often… a little lower with the RNG but also still used a lot, I want the
 * tutorial #6… and the tutorial #4. These are the best ones."
 */
export type WeightedArchetype = ThumbnailArchetype & { weight?: number };

/** Weight, clamped and defaulted. Absent/0/negative all mean baseline 1. */
function weightOf(a: WeightedArchetype): number {
  const w = a.weight;
  if (typeof w !== "number" || !Number.isFinite(w) || w < 1) return 1;
  return Math.min(100, Math.floor(w));
}

/**
 * Expand a weighted ring into the slot list the cycle indexes into.
 *
 * A weight of 3 simply occupies three slots. That keeps the whole mechanism a
 * pure function of the seed — weighting widens an archetype's slice of the hash
 * space and introduces no randomness, so a regenerate still reproduces rather
 * than re-rolls.
 *
 * Slots are INTERLEAVED, not blocked: with weights 3,1 the ring is A,B,A,A —
 * not A,A,A,B. It matters because a 3-variant batch takes CONSECUTIVE indices,
 * and a blocked layout would hand all three variants the same archetype, which
 * is precisely the clumping the cycle exists to avoid.
 */
export function expandWeighted(
  candidates: readonly WeightedArchetype[],
): ThumbnailArchetype[] {
  const remaining = candidates.map(weightOf);
  const total = remaining.reduce((a, b) => a + b, 0);
  const out: ThumbnailArchetype[] = [];
  // Round-robin one slot at a time so heavier entries recur at intervals
  // instead of bunching.
  while (out.length < total) {
    for (let i = 0; i < candidates.length; i++) {
      if (remaining[i]! > 0) {
        out.push(candidates[i]!);
        remaining[i]! -= 1;
      }
    }
  }
  return out;
}

/**
 * Which archetype of `candidates` this generation gets. Pure — no DB, no clock.
 *
 * Returns undefined for an empty pool rather than inventing a default: there is
 * no "fallback archetype", and the caller must surface an empty pool as a
 * visible refusal (it already does).
 *
 * `candidates` must already be in the caller's intended ring order; the
 * repository sorts by the channel link's `sort_order` for exactly that reason.
 */
export function pickCycledArchetype(
  candidates: readonly WeightedArchetype[],
  seed: CycleSeed,
): ThumbnailArchetype | undefined {
  if (candidates.length === 0) return undefined;
  const ring = expandWeighted(candidates);
  const index = pickCycleIndex(
    { ...seed, subjectId: ARCHETYPE_CYCLE_SALT + seed.subjectId },
    ring.length,
  );
  return ring[index];
}

/**
 * The cycle order starting from this generation's pick — what the operator sees
 * as "next up". Exposed so the UI can show the rotation instead of the operator
 * having to infer it.
 */
export function archetypeCycleOrder(
  candidates: readonly WeightedArchetype[],
  seed: CycleSeed,
): ThumbnailArchetype[] {
  if (candidates.length === 0) return [];
  const ring = expandWeighted(candidates);
  const start = pickCycleIndex(
    { ...seed, subjectId: ARCHETYPE_CYCLE_SALT + seed.subjectId },
    ring.length,
  );
  return ring.map((_, i) => ring[(start + i) % ring.length]!);
}
