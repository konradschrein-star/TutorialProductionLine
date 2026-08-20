import { describe, it, expect } from "vitest";
import {
  expandWeighted,
  pickCycledArchetype,
  type WeightedArchetype,
} from "../archetype-cycle.js";

/**
 * Weighted cycling (migration 0070).
 *
 * The owner grades his curated set rather than treating it flat:
 *   "I want to give the tutorial #1 Best Archetype a higher RNG so that we use
 *    it more often. Same, a little lower with the RNG but also still used a
 *    lot, I want the tutorial #6. That's also great and the tutorial #4."
 *
 * Two properties must survive weighting, and they are the reason the cycle
 * exists at all:
 *   - DETERMINISM: same job -> same archetype, so a regenerate reproduces
 *     rather than re-rolls and the recorded row stays truthful.
 *   - NO CLUMPING: consecutive variants of one batch must differ.
 */

function a(id: string, weight?: number): WeightedArchetype {
  return {
    id,
    name: id,
    weight,
    // Only the fields the picker touches matter here.
  } as unknown as WeightedArchetype;
}

describe("expandWeighted", () => {
  it("gives each archetype slots equal to its weight", () => {
    const ring = expandWeighted([a("A", 3), a("B", 1), a("C", 2)]);
    expect(ring).toHaveLength(6);
    expect(ring.filter((x) => x.id === "A")).toHaveLength(3);
    expect(ring.filter((x) => x.id === "B")).toHaveLength(1);
    expect(ring.filter((x) => x.id === "C")).toHaveLength(2);
  });

  it("treats a missing weight as baseline 1", () => {
    const ring = expandWeighted([a("A"), a("B")]);
    expect(ring.map((x) => x.id)).toEqual(["A", "B"]);
  });

  it("interleaves rather than blocking, so consecutive picks differ", () => {
    // Blocked would be A,A,A,B — then variants 0/1/2 of a batch all get A,
    // which is exactly the clumping the cycle exists to prevent.
    const ring = expandWeighted([a("A", 3), a("B", 1)]);
    expect(ring.map((x) => x.id)).toEqual(["A", "B", "A", "A"]);
    expect(ring[0]!.id).not.toBe(ring[1]!.id);
  });

  it("keeps unweighted archetypes in the ring — 'use more' is not 'delete'", () => {
    const ring = expandWeighted([a("Heavy", 5), a("Light", 1)]);
    expect(ring.some((x) => x.id === "Light")).toBe(true);
  });

  it("clamps absurd weights instead of exploding the ring", () => {
    expect(expandWeighted([a("A", 10_000)])).toHaveLength(100);
    expect(expandWeighted([a("A", 0)])).toHaveLength(1);
    expect(expandWeighted([a("A", -4)])).toHaveLength(1);
  });
});

describe("pickCycledArchetype with weights", () => {
  const pool = [a("best", 5), a("good", 3), a("ok", 1)];

  it("is deterministic — the same job always lands on the same archetype", () => {
    const seed = { subjectId: "job-1", variantIndex: 0, parentThumbnailId: null };
    const first = pickCycledArchetype(pool, seed)?.id;
    for (let i = 0; i < 20; i++) {
      expect(pickCycledArchetype(pool, seed)?.id).toBe(first);
    }
  });

  it("favours the heavier archetype across many jobs", () => {
    const counts: Record<string, number> = { best: 0, good: 0, ok: 0 };
    for (let i = 0; i < 900; i++) {
      const pick = pickCycledArchetype(pool, {
        subjectId: `job-${i}`,
        variantIndex: 0,
        parentThumbnailId: null,
      });
      counts[pick!.id] = (counts[pick!.id] ?? 0) + 1;
    }
    // 5 : 3 : 1 — assert the ORDER, not exact ratios; the hash is not a
    // uniform RNG and pinning proportions would make this test brittle.
    expect(counts.best).toBeGreaterThan(counts.good!);
    expect(counts.good).toBeGreaterThan(counts.ok!);
    // Every archetype the owner curated must still appear.
    expect(counts.ok).toBeGreaterThan(0);
  });

  it("still returns undefined for an empty pool rather than inventing one", () => {
    expect(
      pickCycledArchetype([], {
        subjectId: "x",
        variantIndex: 0,
        parentThumbnailId: null,
      }),
    ).toBeUndefined();
  });
});
