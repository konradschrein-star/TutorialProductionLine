import { describe, it, expect } from "vitest";
import { chunkWords } from "../chunker.js";
import { mkWords, mkWordsExact, makeChunkerOptions } from "./_fixtures.js";

describe("chunkWords — grouping", () => {
  it("splits words into chunks of wordsPerChunk", () => {
    // 8 words at the fixture's 0.5s stride: every group is >= the minimum cue
    // duration, so no group is merged and the split is purely count-based.
    const input = mkWords(["a", "b", "c", "d", "e", "f", "g", "h"]);
    const plan = chunkWords(input, makeChunkerOptions({ wordsPerChunk: 4 }));
    expect(plan).toHaveLength(2);
    expect(plan[0]!.words.map((w) => w.word)).toEqual(["a", "b", "c", "d"]);
    expect(plan[1]!.words.map((w) => w.word)).toEqual(["e", "f", "g", "h"]);
  });

  it("merges a cue that would be too short to read into its neighbour", () => {
    // [a,b,c] [d,e,f] [g] — the fixture stride makes the trailing single-word
    // cue only 0.4s, under the ~0.83s minimum, so it is absorbed backwards
    // rather than flashed on screen.
    const input = mkWords(["a", "b", "c", "d", "e", "f", "g"]);
    const plan = chunkWords(input, makeChunkerOptions({ wordsPerChunk: 3 }));
    expect(plan).toHaveLength(2);
    expect(plan[0]!.words.map((w) => w.word)).toEqual(["a", "b", "c"]);
    expect(plan[1]!.words.map((w) => w.word)).toEqual(["d", "e", "f", "g"]);
  });

  it("never merges a short cue across a sentence end", () => {
    // "cat." ends a sentence, so the trailing short cue may NOT be pulled back
    // into it even though it is under the minimum duration. (A single letter
    // plus a period, e.g. "c.", is deliberately read as an initial rather than
    // a sentence end, so the fixture uses a real word.)
    const input = mkWordsExact([
      ["a", 0, 0.4],
      ["b", 0.5, 0.9],
      ["cat.", 1.0, 1.4],
      ["d", 1.5, 1.9],
    ]);
    const plan = chunkWords(
      input,
      makeChunkerOptions({ wordsPerChunk: 3, smartSplit: true }),
    );
    expect(plan).toHaveLength(2);
    expect(plan[0]!.words.map((w) => w.word)).toEqual(["a", "b", "cat."]);
    expect(plan[1]!.words.map((w) => w.word)).toEqual(["d"]);
  });

  it("leaves one-word mode alone (short cues are the point of that style)", () => {
    const plan = chunkWords(
      mkWords(["a", "b", "c", "d"]),
      makeChunkerOptions({ wordsPerChunk: 1 }),
    );
    expect(plan).toHaveLength(4);
  });

  it("returns [] for empty input", () => {
    expect(chunkWords([], makeChunkerOptions())).toEqual([]);
  });

  it("handles a single word", () => {
    const plan = chunkWords(mkWords(["hi"]), makeChunkerOptions());
    expect(plan).toHaveLength(1);
    expect(plan[0]!.words).toHaveLength(1);
    expect(plan[0]!.start).toBe(0);
  });

  it("sets start/end from first and last word by default (gapFree off)", () => {
    const input = mkWords(["a", "b", "c"]);
    const plan = chunkWords(input, makeChunkerOptions({ wordsPerChunk: 3 }));
    expect(plan[0]!.start).toBe(input[0]!.start);
    expect(plan[0]!.end).toBe(input[2]!.end);
  });

  it("all roles start as 'normal'", () => {
    const plan = chunkWords(mkWords(["a", "b"]), makeChunkerOptions());
    for (const w of plan.flatMap((c) => c.words)) {
      expect(w.role).toBe("normal");
    }
  });
});

describe("chunkWords — punctuation transform", () => {
  it("mode 'all' keeps all punctuation", () => {
    const plan = chunkWords(
      mkWords(["hello.", "world!"]),
      makeChunkerOptions({ punctuationMode: "all", wordsPerChunk: 2 }),
    );
    expect(plan[0]!.words.map((w) => w.word)).toEqual(["hello.", "world!"]);
  });

  it("mode 'soft' strips trailing . and , but keeps ! ? and quotes", () => {
    const plan = chunkWords(
      mkWords(["hello.", "hi,", "wow!", "eh?", 'say"']),
      makeChunkerOptions({ punctuationMode: "soft", wordsPerChunk: 8 }),
    );
    expect(plan[0]!.words.map((w) => w.word)).toEqual([
      "hello",
      "hi",
      "wow!",
      "eh?",
      'say"',
    ]);
    // raw preserved
    expect(plan[0]!.words[0]!.raw).toBe("hello.");
  });

  it("mode 'none' strips all trailing punctuation", () => {
    const plan = chunkWords(
      mkWords(["wow!", "eh?", "hi,", "end."]),
      makeChunkerOptions({ punctuationMode: "none", wordsPerChunk: 8 }),
    );
    expect(plan[0]!.words.map((w) => w.word)).toEqual([
      "wow",
      "eh",
      "hi",
      "end",
    ]);
  });
});

describe("chunkWords — text case", () => {
  it("upper uppercases display but keeps raw", () => {
    const plan = chunkWords(
      mkWords(["Hello", "World"]),
      makeChunkerOptions({ textCase: "upper", wordsPerChunk: 2 }),
    );
    expect(plan[0]!.words.map((w) => w.word)).toEqual(["HELLO", "WORLD"]);
    expect(plan[0]!.words[0]!.raw).toBe("Hello");
  });

  it("lower lowercases display", () => {
    const plan = chunkWords(
      mkWords(["Hello", "WORLD"]),
      makeChunkerOptions({ textCase: "lower", wordsPerChunk: 2 }),
    );
    expect(plan[0]!.words.map((w) => w.word)).toEqual(["hello", "world"]);
  });

  it("asIs leaves case untouched", () => {
    const plan = chunkWords(
      mkWords(["Hello", "WORLD"]),
      makeChunkerOptions({ textCase: "asIs", wordsPerChunk: 2 }),
    );
    expect(plan[0]!.words.map((w) => w.word)).toEqual(["Hello", "WORLD"]);
  });
});

describe("chunkWords — oneWordMode pairing", () => {
  it("pairs adjacent short words when wordsPerChunk===1", () => {
    const plan = chunkWords(
      mkWords(["a", "to", "hello", "of", "hi"]),
      makeChunkerOptions({
        wordsPerChunk: 1,
        oneWordMode: { pairShortWords: true, shortWordMaxLen: 3 },
      }),
    );
    // a+to paired; hello alone; of+hi paired
    expect(plan.map((c) => c.words.map((w) => w.word))).toEqual([
      ["a", "to"],
      ["hello"],
      ["of", "hi"],
    ]);
  });

  it("does not pair when pairShortWords is false (one word per chunk)", () => {
    const plan = chunkWords(
      mkWords(["a", "to", "hi"]),
      makeChunkerOptions({
        wordsPerChunk: 1,
        oneWordMode: { pairShortWords: false, shortWordMaxLen: 3 },
      }),
    );
    expect(plan).toHaveLength(3);
  });
});

describe("chunkWords — smartSplit", () => {
  it("breaks at a sentence boundary", () => {
    const plan = chunkWords(
      mkWords(["one", "two.", "three", "four"]),
      makeChunkerOptions({ wordsPerChunk: 8, smartSplit: true }),
    );
    expect(plan.map((c) => c.words.map((w) => w.word))).toEqual([
      ["one", "two."],
      ["three", "four"],
    ]);
  });

  it("forces a boundary on a large silence gap", () => {
    // gap between b and c is 1.0s (> 600ms) -> break after b
    const input = mkWordsExact([
      ["a", 0, 0.4],
      ["b", 0.5, 0.9],
      ["c", 2.0, 2.4],
      ["d", 2.5, 2.9],
    ]);
    const plan = chunkWords(
      input,
      makeChunkerOptions({
        wordsPerChunk: 8,
        smartSplit: true,
        largeSilenceThresholdMs: 600,
      }),
    );
    expect(plan.map((c) => c.words.map((w) => w.word))).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps a coupled proper noun together (New York)", () => {
    const plan = chunkWords(
      mkWords(["visit", "New", "York", "today"]),
      makeChunkerOptions({ wordsPerChunk: 2, smartSplit: true }),
    );
    // New and York must land in the same chunk
    for (const c of plan) {
      const words = c.words.map((w) => w.word);
      const hasNew = words.includes("New");
      const hasYork = words.includes("York");
      if (hasNew || hasYork) {
        expect(hasNew && hasYork).toBe(true);
      }
    }
  });

  it("does not strand a trailing 1-2 char word", () => {
    const plan = chunkWords(
      mkWords(["hello", "world", "xy", "test"]),
      makeChunkerOptions({ wordsPerChunk: 3, smartSplit: true }),
    );
    // "xy" would be the stranded trailing short word of chunk 0; pulled to next
    expect(plan[0]!.words.map((w) => w.word)).toEqual(["hello", "world"]);
    expect(plan[1]!.words[0]!.word).toBe("xy");
  });
});

describe("chunkWords — line wrapping", () => {
  it("single line when breakLines is off", () => {
    const plan = chunkWords(
      mkWords(["a", "b", "c", "d"]),
      makeChunkerOptions({ wordsPerChunk: 4, breakLines: false }),
    );
    expect(plan[0]!.lines).toHaveLength(1);
    expect(plan[0]!.lines[0]).toHaveLength(4);
  });

  it("wraps into <= maxLines lines when breakLines is on", () => {
    const plan = chunkWords(
      mkWords(["alpha", "bravo", "charlie", "delta"]),
      makeChunkerOptions({
        wordsPerChunk: 4,
        breakLines: true,
        maxLines: 2,
      }),
    );
    expect(plan[0]!.lines.length).toBeLessThanOrEqual(2);
    // every word appears exactly once across lines
    const flat = plan[0]!.lines.flat().map((w) => w.word);
    expect(flat).toEqual(["alpha", "bravo", "charlie", "delta"]);
  });
});

describe("chunkWords — gapFree", () => {
  it("extends chunk end to next chunk start when on", () => {
    const input = mkWordsExact([
      ["a", 0, 0.4],
      ["b", 0.5, 0.9],
      ["c", 1.5, 1.9],
      ["d", 2.0, 2.4],
    ]);
    const plan = chunkWords(
      input,
      makeChunkerOptions({ wordsPerChunk: 2, gapFree: true }),
    );
    expect(plan[0]!.end).toBe(plan[1]!.start);
    // last chunk keeps its own end
    expect(plan[1]!.end).toBe(2.4);
  });

  it("leaves gaps when off", () => {
    const input = mkWordsExact([
      ["a", 0, 0.4],
      ["b", 0.5, 0.9],
      ["c", 1.5, 1.9],
      ["d", 2.0, 2.4],
    ]);
    const plan = chunkWords(
      input,
      makeChunkerOptions({ wordsPerChunk: 2, gapFree: false }),
    );
    expect(plan[0]!.end).toBe(0.9);
  });
});

describe("chunkWords — malformed input", () => {
  it("throws when a word starts before the previous word's start", () => {
    const bad = mkWordsExact([
      ["a", 1.0, 1.4],
      ["b", 0.5, 0.9],
    ]);
    expect(() => chunkWords(bad, makeChunkerOptions())).toThrow();
  });

  it("throws when end < start", () => {
    const bad = mkWordsExact([["a", 1.0, 0.5]]);
    expect(() => chunkWords(bad, makeChunkerOptions())).toThrow();
  });
});
