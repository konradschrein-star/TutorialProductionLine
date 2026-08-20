import { describe, it, expect } from "vitest";
import {
  fitSelectionToBlock,
  selectionMatchesBlock,
  selectionTotalMs,
  SELECTION_TOLERANCE_MS,
} from "../broll-selection-fit";

/**
 * Regression guard for the 2026-08-04 "I can't approve shit" bug.
 *
 * `ranking-footage-collection` seeds every item with a single 0→4000ms segment
 * (the FIXED-timing constant) even when the item is narration-anchored to a
 * 44–58s window. The studio's controls are all Σ-preserving, so such a block
 * could never satisfy the approve validator and no VA action could fix it.
 * These are the real numbers from job bd4bfd38 (item-1: 25460→76880 narration,
 * minus the 1.5s tier and 3s reveal beats = a 46 920 ms B-roll window).
 */
describe("fitSelectionToBlock", () => {
  const SEEDED = [{ candidateIndex: 0, startMs: 0, endMs: 4000 }];

  it("rescales the 4s seed to a real anchored window", () => {
    const fit = fitSelectionToBlock(SEEDED, 46_920, [150_016]);
    expect(fit.changed).toBe(true);
    expect(fit.shortfallMs).toBe(0);
    expect(selectionTotalMs(fit.segments)).toBe(46_920);
    expect(selectionMatchesBlock(fit.segments, 46_920)).toBe(true);
  });

  it("leaves an already-correct selection untouched", () => {
    const good = [{ candidateIndex: 0, startMs: 1000, endMs: 47_920 }];
    const fit = fitSelectionToBlock(good, 46_920, [150_016]);
    expect(fit.changed).toBe(false);
    expect(fit.segments).toEqual(good);
  });

  it("accepts anything inside the approve tolerance", () => {
    const nearly = [
      { candidateIndex: 0, startMs: 0, endMs: 46_920 + SELECTION_TOLERANCE_MS },
    ];
    expect(fitSelectionToBlock(nearly, 46_920, [150_016]).changed).toBe(false);
  });

  it("preserves proportions across a split selection", () => {
    const split = [
      { candidateIndex: 0, startMs: 0, endMs: 1000 },
      { candidateIndex: 1, startMs: 5000, endMs: 8000 },
    ];
    const fit = fitSelectionToBlock(split, 40_000, [150_000, 150_000]);
    expect(selectionTotalMs(fit.segments)).toBe(40_000);
    // 1:3 in, 1:3 out (within rounding).
    const [a, b] = fit.segments;
    expect(Math.round((b!.endMs - b!.startMs) / (a!.endMs - a!.startMs))).toBe(
      3,
    );
    expect(fit.segments[1]!.candidateIndex).toBe(1);
  });

  it("never makes a segment longer than the clip it points at", () => {
    const fit = fitSelectionToBlock(SEEDED, 46_920, [10_000]);
    expect(fit.segments[0]!.endMs - fit.segments[0]!.startMs).toBe(10_000);
    expect(fit.shortfallMs).toBe(36_920);
  });

  it("reports a shortfall instead of padding when sources are too short", () => {
    const split = [
      { candidateIndex: 0, startMs: 0, endMs: 2000 },
      { candidateIndex: 1, startMs: 0, endMs: 2000 },
    ];
    const fit = fitSelectionToBlock(split, 50_000, [8000, 9000]);
    expect(selectionTotalMs(fit.segments)).toBe(17_000);
    expect(fit.shortfallMs).toBe(33_000);
  });

  it("treats an unknown clip duration as unconstrained, not as zero", () => {
    const fit = fitSelectionToBlock(SEEDED, 46_920, [undefined]);
    expect(selectionTotalMs(fit.segments)).toBe(46_920);
    expect(fit.shortfallMs).toBe(0);
  });

  it("seeds an empty selection onto candidate 0", () => {
    const fit = fitSelectionToBlock([], 46_920, [150_016]);
    expect(fit.segments).toEqual([
      { candidateIndex: 0, startMs: 0, endMs: 46_920 },
    ]);
    expect(fit.changed).toBe(true);
  });

  it("keeps the VA's source position when the clip has room", () => {
    const framed = [{ candidateIndex: 0, startMs: 30_000, endMs: 34_000 }];
    const fit = fitSelectionToBlock(framed, 20_000, [150_000]);
    expect(fit.segments[0]!.startMs).toBe(30_000);
    expect(fit.segments[0]!.endMs).toBe(50_000);
  });

  it("pulls the start back when growing would overrun the clip", () => {
    const framed = [{ candidateIndex: 0, startMs: 140_000, endMs: 144_000 }];
    const fit = fitSelectionToBlock(framed, 20_000, [150_000]);
    expect(fit.segments[0]!.endMs).toBe(150_000);
    expect(fit.segments[0]!.startMs).toBe(130_000);
  });

  /**
   * Regression guard for job 75c0cbe8 (2026-08-05): two of five items fetched
   * NO footage, yet each came back with a full-length segment on candidate 0 —
   * a candidate that does not exist. Σ matched the block exactly, so approve
   * passed and the item would have rendered as one still hero for 88 seconds.
   */
  describe("an item with no candidates at all", () => {
    it("returns no selection and reports the whole block as shortfall", () => {
      const fit = fitSelectionToBlock([], 87_980, []);
      expect(fit.segments).toEqual([]);
      expect(fit.shortfallMs).toBe(87_980);
    });

    it("does not invent a segment on a candidate that does not exist", () => {
      const phantom = [{ candidateIndex: 0, startMs: 0, endMs: 4000 }];
      const fit = fitSelectionToBlock(phantom, 58_840, []);
      expect(fit.segments).toEqual([]);
      expect(fit.changed).toBe(true);
      expect(selectionTotalMs(fit.segments)).toBe(0);
      // The approve validator compares Σ to the window, so this now fails
      // the gate instead of silently passing it.
      expect(selectionMatchesBlock(fit.segments, 58_840)).toBe(false);
    });
  });
});
