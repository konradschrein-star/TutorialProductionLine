import { describe, it, expect } from "vitest";
import {
  pickLeastRecentlyUsedArchetype,
  resolveArchetypeCandidates,
} from "../thumbnail-repository.js";
import type { ThumbnailArchetype } from "../../schema/thumbnails.js";

// Minimal fake DrizzleClient that returns a scripted usage aggregate.
function fakeDb(usage: Array<{ archetype_id: string; last_used: string }>) {
  const chain = {
    from: () => chain,
    where: () => chain,
    groupBy: async () => usage,
  };
  return {
    select: () => chain,
  } as unknown as import("../../client.js").DrizzleClient;
}

function arch(id: string): ThumbnailArchetype {
  return {
    id,
    name: id,
    reference_image_path: "/x.jpg",
    layout_instructions: null,
    base_prompt: null,
    features_logo: false,
    category: "General",
    formats: ["TUTORIAL_STUDIO"],
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

/**
 * Fake client for resolveArchetypeCandidates, which issues at most two
 * selects: the channel's links, then the archetype rows. A THIRD select would
 * be the global-library query — the very fall-through this suite forbids — so
 * the script simply runs out and the test fails loudly rather than passing on
 * an empty global pool.
 */
function fakeCurationDb(
  links: Array<{ archetype_id: string; tier: string; sort_order: number }>,
  rows: ThumbnailArchetype[],
) {
  const results: unknown[][] = [links, rows];
  let call = -1;
  const chain = {
    from: () => chain,
    where: (..._a: unknown[]) => {
      const r = results[call];
      if (!r) {
        throw new Error(
          "resolveArchetypeCandidates queried the GLOBAL archetype library " +
            "for a curated channel — curation must be authoritative.",
        );
      }
      return Promise.resolve(r);
    },
  };
  return {
    select: () => {
      call++;
      return chain;
    },
  } as unknown as import("../../client.js").DrizzleClient;
}

describe("resolveArchetypeCandidates — curation is authoritative", () => {
  const link = (id: string, sort_order: number) => ({
    archetype_id: id,
    tier: "base",
    sort_order,
  });

  it("returns the curated set in the operator's link order", async () => {
    const db = fakeCurationDb(
      [link("b", 0), link("a", 1)],
      [arch("a"), arch("b")],
    );
    const res = await resolveArchetypeCandidates(db, "chan", "TUTORIAL_STUDIO");
    expect(res.source).toBe("curated");
    expect(res.candidates.map((c) => c.id)).toEqual(["b", "a"]);
    expect(res.emptyCurationReason).toBeNull();
  });

  it("refuses instead of widening to the global library when every curated row is inactive", async () => {
    const db = fakeCurationDb(
      [link("a", 0), link("b", 1)],
      [
        { ...arch("a"), is_active: false },
        { ...arch("b"), is_active: false },
      ],
    );
    const res = await resolveArchetypeCandidates(db, "chan", "TUTORIAL_STUDIO");
    expect(res.candidates).toEqual([]);
    expect(res.source).toBe("curated");
    expect(res.emptyCurationReason).toContain("2 inactive");
  });

  it("refuses instead of widening when the curated rows are restricted to other formats", async () => {
    const db = fakeCurationDb([link("a", 0)], [arch("a")]); // formats: TUTORIAL_STUDIO
    const res = await resolveArchetypeCandidates(db, "chan", "EXPLAINER");
    expect(res.candidates).toEqual([]);
    expect(res.emptyCurationReason).toContain("1 restricted to other formats");
  });
});

describe("pickLeastRecentlyUsedArchetype", () => {
  it("returns undefined when there are no candidates", async () => {
    const result = await pickLeastRecentlyUsedArchetype(fakeDb([]), "chan", []);
    expect(result).toBeUndefined();
  });

  it("prefers a never-used archetype over a used one", async () => {
    const candidates = [arch("used"), arch("fresh")];
    const db = fakeDb([
      { archetype_id: "used", last_used: "2026-01-01T00:00:00Z" },
    ]);
    const result = await pickLeastRecentlyUsedArchetype(db, "chan", candidates);
    expect(result?.id).toBe("fresh");
  });

  it("among used archetypes, returns the one used longest ago", async () => {
    const candidates = [arch("recent"), arch("old")];
    const db = fakeDb([
      { archetype_id: "recent", last_used: "2026-06-01T00:00:00Z" },
      { archetype_id: "old", last_used: "2026-01-01T00:00:00Z" },
    ]);
    const result = await pickLeastRecentlyUsedArchetype(db, "chan", candidates);
    expect(result?.id).toBe("old");
  });
});
