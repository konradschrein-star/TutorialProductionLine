import { describe, it, expect } from "vitest";
import {
  BLOCK_DURATION_MS,
  computeItemWindow,
  type FootageCandidate,
  type RankingItem,
} from "@repo/contracts";
import {
  brollWindowMsForItem,
  defaultBrollSelection,
  isUntouchedSeed,
  reseedDefaultBrollSelections,
} from "../ranking/broll-default-selection.js";

/**
 * The seed a RANKING block arrives with has to equal its narration-anchored
 * window, because every B-Roll Studio control is sum-preserving: a block seeded
 * with the fixed 4000ms constant against a ~47s window is unapprovable and no VA
 * control can change that. These tests pin the seed to the window, and to the
 * value hub-web's `fitSelectionToBlock([], …)` would produce for the same input.
 */

const candidate = (durationSeconds?: number): FootageCandidate => ({
  url: "file:///media/clip.mp4",
  source: "yt-dlp",
  kind: "video",
  ...(durationSeconds === undefined ? {} : { durationSeconds }),
});

const item = (over: Partial<RankingItem> = {}): RankingItem =>
  ({
    id: "i1",
    name: "Thing",
    ...over,
  }) as RankingItem;

describe("brollWindowMsForItem", () => {
  it("uses the anchored window when the item has a spoken segment", () => {
    // A real production span: item discussed from 12.0s to 58.92s.
    const it_ = item({ narrationStartMs: 12_000, narrationEndMs: 58_920 });
    const expected = computeItemWindow(12_000, 58_920).brollDurationMs;
    expect(brollWindowMsForItem(it_)).toBe(expected);
    // Sanity: this is tens of seconds, an order of magnitude off the constant.
    expect(expected).toBeGreaterThan(40_000);
  });

  it("falls back to the fixed constant only when unanchored", () => {
    expect(brollWindowMsForItem(item())).toBe(BLOCK_DURATION_MS);
    // A zero-length or inverted segment is not anchoring.
    expect(
      brollWindowMsForItem(
        item({ narrationStartMs: 5_000, narrationEndMs: 5_000 }),
      ),
    ).toBe(BLOCK_DURATION_MS);
  });
});

describe("defaultBrollSelection", () => {
  it("spans the whole anchored window when the clip is long enough", () => {
    const it_ = item({ narrationStartMs: 12_000, narrationEndMs: 58_920 });
    const win = computeItemWindow(12_000, 58_920).brollDurationMs;
    const sel = defaultBrollSelection(it_, [candidate(120)]);
    expect(sel).toEqual({
      segments: [{ candidateIndex: 0, startMs: 0, endMs: win }],
    });
    // The approve gate is |Σ − blockDurationMs| ≤ 80ms. This is the point.
    const total = sel!.segments.reduce((s, g) => s + (g.endMs - g.startMs), 0);
    expect(Math.abs(total - win)).toBeLessThanOrEqual(80);
  });

  it("stops at the clip's real length instead of padding it", () => {
    // 10s of footage for a ~47s block: the honest seed is 10s plus a shortfall
    // the studio surfaces, NOT a looped or stretched 47s.
    const it_ = item({ narrationStartMs: 12_000, narrationEndMs: 58_920 });
    const sel = defaultBrollSelection(it_, [candidate(10)]);
    expect(sel).toEqual({
      segments: [{ candidateIndex: 0, startMs: 0, endMs: 10_000 }],
    });
  });

  it("treats an unknown clip duration as unconstrained, never guessed", () => {
    const it_ = item({ narrationStartMs: 0, narrationEndMs: 30_000 });
    const win = computeItemWindow(0, 30_000).brollDurationMs;
    expect(defaultBrollSelection(it_, [candidate()])).toEqual({
      segments: [{ candidateIndex: 0, startMs: 0, endMs: win }],
    });
  });

  it("seeds nothing when there is no candidate to point at", () => {
    expect(defaultBrollSelection(item(), [])).toBeUndefined();
  });

  it("seeds nothing when the clip is shorter than the minimum segment", () => {
    expect(defaultBrollSelection(item(), [candidate(0.05)])).toBeUndefined();
  });
});

describe("reseedDefaultBrollSelections", () => {
  it("repairs the collection-time 4000ms seed once anchoring is known", () => {
    const before = item({
      narrationStartMs: 12_000,
      narrationEndMs: 58_920,
      footageCandidates: [candidate(120)],
      brollSelection: {
        segments: [{ candidateIndex: 0, startMs: 0, endMs: BLOCK_DURATION_MS }],
      },
    });
    const win = computeItemWindow(12_000, 58_920).brollDurationMs;
    const [after] = reseedDefaultBrollSelections([before]);
    expect(after!.brollSelection!.segments).toEqual([
      { candidateIndex: 0, startMs: 0, endMs: win },
    ]);
  });

  it("leaves a VA-shaped selection alone", () => {
    const vaSelection = {
      segments: [
        { candidateIndex: 1, startMs: 4_000, endMs: 20_000 },
        { candidateIndex: 0, startMs: 0, endMs: 26_920 },
      ],
    };
    const before = item({
      narrationStartMs: 12_000,
      narrationEndMs: 58_920,
      footageCandidates: [candidate(120), candidate(120)],
      brollSelection: vaSelection,
    });
    const [after] = reseedDefaultBrollSelections([before]);
    expect(after!.brollSelection).toEqual(vaSelection);
  });

  it("leaves an item with no candidates untouched", () => {
    const before = item({
      narrationStartMs: 12_000,
      narrationEndMs: 58_920,
      brollSelection: {
        segments: [{ candidateIndex: 0, startMs: 0, endMs: BLOCK_DURATION_MS }],
      },
    });
    const [after] = reseedDefaultBrollSelections([before]);
    expect(after!.brollSelection!.segments[0]!.endMs).toBe(BLOCK_DURATION_MS);
  });
});

describe("isUntouchedSeed", () => {
  it("recognises only the exact shape footage collection writes", () => {
    expect(
      isUntouchedSeed({
        segments: [{ candidateIndex: 0, startMs: 0, endMs: 1 }],
      }),
    ).toBe(true);
    expect(
      isUntouchedSeed({
        segments: [{ candidateIndex: 1, startMs: 0, endMs: 1 }],
      }),
    ).toBe(false);
    expect(
      isUntouchedSeed({
        segments: [{ candidateIndex: 0, startMs: 5, endMs: 9 }],
      }),
    ).toBe(false);
    expect(isUntouchedSeed(undefined)).toBe(false);
  });
});
