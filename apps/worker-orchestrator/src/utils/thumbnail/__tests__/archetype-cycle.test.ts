import { describe, expect, it } from "vitest";
import {
  pickCycledArchetype,
  archetypeCycleOrder,
} from "../archetype-cycle.js";
import { pickCycleIndex } from "../character.js";

type A = Parameters<typeof pickCycledArchetype>[0][number];

const arch = (id: string): A =>
  ({ id, name: id, sort_order: 0 }) as unknown as A;

/** The owner's five-archetype base cycle, in link order. */
const POOL = ["t10", "t11", "t1", "t8", "t4"].map(arch);

describe("pickCycledArchetype", () => {
  it("returns undefined for an empty pool rather than inventing a default", () => {
    expect(pickCycledArchetype([], { subjectId: "j", variantIndex: 0 })).toBe(
      undefined,
    );
  });

  it("is reproducible: the same job and variant always pick the same archetype", () => {
    const seed = { subjectId: "job-abc", variantIndex: 0 };
    const first = pickCycledArchetype(POOL, seed);
    for (let i = 0; i < 20; i++) {
      expect(pickCycledArchetype(POOL, seed)?.id).toBe(first?.id);
    }
  });

  it("walks the ring for the variants of one batch, never repeating", () => {
    const ids = [0, 1, 2].map(
      (variantIndex) =>
        pickCycledArchetype(POOL, { subjectId: "job-abc", variantIndex })?.id,
    );
    expect(new Set(ids).size).toBe(3);
  });

  it("guarantees a regenerate lands on a DIFFERENT archetype, reproducibly", () => {
    const base = { subjectId: "job-abc", variantIndex: 0 };
    const original = pickCycledArchetype(POOL, base);
    const regen = pickCycledArchetype(POOL, {
      ...base,
      parentThumbnailId: "thumb-1",
    });
    expect(regen?.id).not.toBe(original?.id);
    expect(
      pickCycledArchetype(POOL, { ...base, parentThumbnailId: "thumb-1" })?.id,
    ).toBe(regen?.id);
  });

  it("spreads across the whole set instead of clumping on one archetype", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 500; i++) {
      const picked = pickCycledArchetype(POOL, {
        subjectId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        variantIndex: 0,
      })!;
      counts.set(picked.id, (counts.get(picked.id) ?? 0) + 1);
    }
    expect(counts.size).toBe(POOL.length);
    // 500 jobs over 5 archetypes: an even split is 100 each. A generous band
    // still fails loudly if the hash ever collapses onto a subset.
    for (const n of counts.values()) {
      expect(n).toBeGreaterThan(50);
      expect(n).toBeLessThan(160);
    }
  });

  it("is INDEPENDENT of the host-image cycle, so pairings are not frozen", () => {
    // Same subject, same pool size: without the salt both cycles would return
    // the identical index for every job, pinning archetype #n to host image #n.
    let differed = 0;
    for (let i = 0; i < 100; i++) {
      const seed = { subjectId: `job-${i}`, variantIndex: 0 };
      const archetypeIdx = POOL.indexOf(pickCycledArchetype(POOL, seed)!);
      const hostImageIdx = pickCycleIndex(seed, POOL.length);
      if (archetypeIdx !== hostImageIdx) differed++;
    }
    expect(differed).toBeGreaterThan(50);
  });
});

describe("archetypeCycleOrder", () => {
  it("lists the whole ring once, starting at this generation's pick", () => {
    const seed = { subjectId: "job-abc", variantIndex: 0 };
    const order = archetypeCycleOrder(POOL, seed);
    expect(order).toHaveLength(POOL.length);
    expect(new Set(order.map((a) => a.id)).size).toBe(POOL.length);
    expect(order[0]?.id).toBe(pickCycledArchetype(POOL, seed)?.id);
  });

  it("returns an empty ring for an empty pool", () => {
    expect(
      archetypeCycleOrder([], { subjectId: "j", variantIndex: 0 }),
    ).toEqual([]);
  });
});
