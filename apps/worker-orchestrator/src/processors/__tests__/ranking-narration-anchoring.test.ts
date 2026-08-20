import { describe, it, expect } from "vitest";
import { computeItemNarrationSegments } from "../ranking/narration-anchoring.js";
import type { RankingItem, RankingPlacement } from "@repo/contracts";
import type { RankingWordTimestamp } from "../ranking/ranking-tts.js";

/** Build a word-timestamp stream from `[word, startSec]` pairs (1s words). */
function words(pairs: Array<[string, number]>): RankingWordTimestamp[] {
  return pairs.map(([word, start]) => ({ word, start, end: start + 0.9 }));
}

function item(id: string, name: string): RankingItem {
  return { id, name };
}

function placement(itemId: string, revealOrder: number): RankingPlacement {
  return { itemId, tierIndex: 0, revealOrder };
}

describe("computeItemNarrationSegments", () => {
  it("anchors each item to its first mention in reveal order", () => {
    const items = [
      item("i1", "iPhone"),
      item("i2", "Pixel"),
      item("i3", "Galaxy"),
    ];
    const placements = [
      placement("i1", 0),
      placement("i2", 1),
      placement("i3", 2),
    ];
    // Intro words, then each item mentioned once, in order.
    const wordTimestamps = words([
      ["today", 0],
      ["we", 1],
      ["rank", 2],
      ["the", 3],
      ["iPhone", 4],
      ["is", 5],
      ["great", 6],
      ["the", 7],
      ["Pixel", 8],
      ["is", 9],
      ["okay", 10],
      ["the", 11],
      ["Galaxy", 12],
      ["wins", 13],
    ]);

    const res = computeItemNarrationSegments({
      jobId: "j",
      items,
      placements,
      wordTimestamps,
    });

    expect(res.anchored).toBe(true);
    expect(res.unmatched).toEqual([]);
    const byId = new Map(res.items.map((it) => [it.id, it]));
    // i1: first mention at 4s → 4000ms; ends at i2 start (8000ms)
    expect(byId.get("i1")!.narrationStartMs).toBe(4000);
    expect(byId.get("i1")!.narrationEndMs).toBe(8000);
    // i2: [8000, 12000]
    expect(byId.get("i2")!.narrationStartMs).toBe(8000);
    expect(byId.get("i2")!.narrationEndMs).toBe(12000);
    // i3: [12000, lastWordEnd = 13.9s → 13900ms]
    expect(byId.get("i3")!.narrationStartMs).toBe(12000);
    expect(byId.get("i3")!.narrationEndMs).toBe(13900);
  });

  it("matches multi-word names and skips pure numbers", () => {
    const items = [item("i1", "iPhone 15"), item("i2", "Galaxy S24")];
    const placements = [placement("i1", 0), placement("i2", 1)];
    // "15" / "S24" appear as spoken words but matching keys off the alpha token.
    const wordTimestamps = words([
      ["the", 0],
      ["iPhone", 1],
      ["fifteen", 2],
      ["rules", 3],
      ["the", 4],
      ["Galaxy", 5],
      ["s24", 6],
      ["too", 7],
    ]);

    const res = computeItemNarrationSegments({
      jobId: "j",
      items,
      placements,
      wordTimestamps,
    });

    expect(res.anchored).toBe(true);
    const byId = new Map(res.items.map((it) => [it.id, it]));
    expect(byId.get("i1")!.narrationStartMs).toBe(1000);
    expect(byId.get("i2")!.narrationStartMs).toBe(5000);
  });

  it("partial: located items keep segments, only unlocatable items fall back", () => {
    const items = [item("i1", "iPhone"), item("i2", "Nonexistent")];
    const placements = [placement("i1", 0), placement("i2", 1)];
    const wordTimestamps = words([
      ["the", 0],
      ["iPhone", 1],
      ["is", 2],
      ["nice", 3],
    ]);

    const res = computeItemNarrationSegments({
      jobId: "j",
      items,
      placements,
      wordTimestamps,
    });

    expect(res.anchored).toBe(false);
    expect(res.unmatched).toContain("Nonexistent");
    const byId = new Map(res.items.map((it) => [it.id, it]));
    // Per-item fallback: the located item IS anchored (ends at last word 3.9s).
    expect(byId.get("i1")!.narrationStartMs).toBe(1000);
    expect(byId.get("i1")!.narrationEndMs).toBe(3900);
    // The unlocatable item carries no segment (studio uses fixed timing for it).
    expect(byId.get("i2")!.narrationStartMs).toBeUndefined();
    expect(byId.get("i2")!.narrationEndMs).toBeUndefined();
  });

  it("distinguishes near-duplicate model variants (Master 3S vs Master 4)", () => {
    const items = [
      item("i1", "Logitech MX Master 3S"),
      item("i2", "Logitech MX Master 4"),
    ];
    const placements = [placement("i1", 0), placement("i2", 1)];
    // "MX Master 4" is name-dropped early as a brief comparison (no brand word
    // nearby); each item's real dedicated mention uses the full brand + its own
    // model token, so the idf-weighted full-name mention outscores the comparison.
    const wordTimestamps = words([
      ["unlike", 0],
      ["the", 1],
      ["mx", 2],
      ["master", 3],
      ["4", 4], // early comparison mention of the 4 — must NOT anchor i2 here
      ["is", 5],
      ["pricey", 6],
      ["so", 7],
      ["skip", 8],
      ["it", 9],
      ["the", 10],
      ["logitech", 11],
      ["mx", 12],
      ["master", 13],
      ["3", 14], // i1 dedicated: "3S" transcribed as "3"
      ["is", 15],
      ["compact", 16],
      ["later", 17],
      ["the", 18],
      ["logitech", 19],
      ["mx", 20],
      ["master", 21],
      ["4", 22], // i2 dedicated (full name)
      ["wins", 23],
    ]);

    const res = computeItemNarrationSegments({
      jobId: "j",
      items,
      placements,
      wordTimestamps,
    });

    const byId = new Map(res.items.map((it) => [it.id, it]));
    // i1 (Master 3S) anchors at its full-name "3" mention (11s).
    expect(byId.get("i1")!.narrationStartMs).toBe(11000);
    // i2 (Master 4) anchors at its dedicated full-name mention (19s), not the
    // early bare-comparison "4" at 4s.
    expect(byId.get("i2")!.narrationStartMs).toBe(19000);
    // Forward, non-overlapping segments.
    expect(byId.get("i1")!.narrationEndMs).toBe(19000);
  });

  it("returns anchored:false when no word timestamps are available", () => {
    const items = [item("i1", "iPhone")];
    const placements = [placement("i1", 0)];
    const res = computeItemNarrationSegments({
      jobId: "j",
      items,
      placements,
      wordTimestamps: [],
    });
    expect(res.anchored).toBe(false);
    expect(res.items[0]!.narrationStartMs).toBeUndefined();
  });
});

/**
 * TRANSPOSITION guard (2026-08-04). A real production job failed the anchoring
 * gate at 4/5 items because Whisper rendered "Keychron" as "Keycrone" — neither
 * string contains the other, so exact and substring matching both missed it and
 * the whole job was thrown away after the script and TTS had been paid for.
 */
describe("tolerates Whisper mangling brand names", () => {
  it("regression: matches Keychron against Whisper's 'Keycrone'", () => {
    const items = [item("i1", "Redragon K552"), item("i2", "Keychron V1")];
    const placements = [placement("i1", 0), placement("i2", 1)];
    const stream = words([
      ["Redragon", 10],
      ["K552", 11],
      ["is", 12],
      ["fine", 13],
      ["The", 40],
      ["Keycrone", 41],
      ["V1", 42],
      ["wins", 43],
    ]);

    const r = computeItemNarrationSegments({
      jobId: "j",
      items,
      placements,
      wordTimestamps: stream,
    });

    expect(r.anchored).toBe(true);
    expect(r.unmatched).toEqual([]);
    expect(r.items[1]!.narrationStartMs).toBe(41_000);
  });

  it("does not fuzzy-match short words into false positives", () => {
    // "bose" vs "dose"/"rose" are 1 edit apart; the >=6 char gate excludes them.
    const items = [item("i1", "Bose"), item("i2", "Sennheiser Momentum")];
    const placements = [placement("i1", 0), placement("i2", 1)];
    const stream = words([
      ["a", 5],
      ["dose", 6],
      ["of", 7],
      ["rose", 8],
      ["Sennheiser", 30],
      ["Momentum", 31],
    ]);

    const r = computeItemNarrationSegments({
      jobId: "j",
      items,
      placements,
      wordTimestamps: stream,
    });

    // Bose is never really said, so it must stay unmatched.
    expect(r.unmatched).toContain("Bose");
    expect(r.anchored).toBe(false);
  });

  it("does not collide two similar product names", () => {
    const items = [item("i1", "Epomaker TH80"), item("i2", "Epomaker TH99")];
    const placements = [placement("i1", 0), placement("i2", 1)];
    // Filler between the two mentions so they fall in DIFFERENT match windows.
    // The matcher windows by word INDEX, not by time, so two mentions three
    // words apart are one window however many seconds separate them — which is
    // an artefact of a synthetic stream, not of real narration where items are
    // over a hundred words apart.
    const filler: Array<[string, number]> = Array.from(
      { length: 20 },
      (_, i) => [`filler${i}`, 12 + i],
    );
    const stream = words([
      ["Epomaker", 10],
      ["TH80", 11],
      ...filler,
      ["Epomaker", 40],
      ["TH99", 41],
    ]);

    const r = computeItemNarrationSegments({
      jobId: "j",
      items,
      placements,
      wordTimestamps: stream,
    });

    expect(r.anchored).toBe(true);
    expect(r.items[0]!.narrationStartMs).toBe(10_000);
    expect(r.items[1]!.narrationStartMs).toBe(40_000);
  });
});
