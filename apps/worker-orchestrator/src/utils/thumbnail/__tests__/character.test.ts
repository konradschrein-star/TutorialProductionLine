import { describe, it, expect } from "vitest";
import { buildCycleSeed, fnv1a32, pickCycleIndex } from "../character.js";

/**
 * The cycling contract, stated as tests because "a little bit of variation"
 * only holds if the selection is reproducible. A random picker would pass a
 * casual eyeball check and then quietly (a) hand a retried job a different face
 * than its recorded brief describes and (b) collide inside a 3-variant batch.
 */
describe("character image cycling", () => {
  const seed = (over: Partial<Parameters<typeof pickCycleIndex>[0]> = {}) => ({
    subjectId: "1f0f9b0e-3a4e-4a71-9b3d-2f0d4a0f2a11",
    variantIndex: 0,
    parentThumbnailId: null,
    ...over,
  });

  it("is deterministic — the same job replays to the same image", () => {
    const a = pickCycleIndex(seed(), 7);
    const b = pickCycleIndex(seed(), 7);
    expect(a).toBe(b);
  });

  it("gives the variants of one batch different images", () => {
    // 3 variants over 7 images: a random picker duplicates ~60% of the time.
    const picks = [0, 1, 2].map((variantIndex) =>
      pickCycleIndex(seed({ variantIndex }), 7),
    );
    expect(new Set(picks).size).toBe(3);
  });

  it("makes a regenerate land on a different image than the original", () => {
    const original = pickCycleIndex(seed(), 7);
    const regenerated = pickCycleIndex(
      seed({ parentThumbnailId: "9c7a6f2b-55ac-4f9e-8b6e-1d2c3e4f5a6b" }),
      7,
    );
    expect(regenerated).not.toBe(original);
    // …and the regenerate is itself reproducible.
    expect(
      pickCycleIndex(
        seed({ parentThumbnailId: "9c7a6f2b-55ac-4f9e-8b6e-1d2c3e4f5a6b" }),
        7,
      ),
    ).toBe(regenerated);
  });

  it("stays inside the image set", () => {
    for (let n = 1; n <= 12; n++) {
      for (let i = 0; i < 50; i++) {
        const idx = pickCycleIndex(
          seed({ subjectId: `subject-${i}`, variantIndex: i % 3 }),
          n,
        );
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(n);
      }
    }
  });

  it("spreads across the whole set rather than favouring one image", () => {
    const counts = new Array(7).fill(0);
    for (let i = 0; i < 700; i++) {
      counts[pickCycleIndex(seed({ subjectId: `job-${i}` }), 7)]! += 1;
    }
    // Uniform would be 100 each. Anything outside 55..165 means the hash is
    // clumping badly enough that the owner would notice a favoured photo.
    for (const c of counts) {
      expect(c).toBeGreaterThan(55);
      expect(c).toBeLessThan(165);
    }
  });

  it("refuses an empty image set instead of substituting anything", () => {
    expect(() => pickCycleIndex(seed(), 0)).toThrow(/cannot be placed/i);
  });

  it("degrades honestly when a character has only one image", () => {
    // Nothing to cycle. Every request returns image 0 — including a
    // regenerate. That is a data problem (add photos), not something to fake.
    expect(pickCycleIndex(seed(), 1)).toBe(0);
    expect(pickCycleIndex(seed({ parentThumbnailId: "p" }), 1)).toBe(0);
  });

  it("hashes and seeds are stable values, not process state", () => {
    expect(buildCycleSeed(seed())).toBe("1f0f9b0e-3a4e-4a71-9b3d-2f0d4a0f2a11");
    // FNV-1a/32 of "hello" — a fixed, well-known vector.
    expect(fnv1a32("hello")).toBe(0x4f9f2cab);
  });
});
