import { describe, it, expect } from "vitest";
import { chunkWords } from "../chunker.js";
import { selectKeywords } from "../keyword-selector.js";
import { mkWords, makeChunkerOptions } from "./_fixtures.js";
import type { RemotionSubtitleConfig } from "@repo/db";

type KeywordConfig = RemotionSubtitleConfig["keyword"];

const kw = (overrides: Partial<KeywordConfig> = {}): KeywordConfig => ({
  enabled: true,
  wordClasses: ["noun", "verb", "adjective", "adverb", "number"],
  aggressiveness: 100,
  colors: ["#111111", "#222222", "#333333"],
  bold: true,
  italic: false,
  background: null,
  ...overrides,
});

const plan = (tokens: string[], wordsPerChunk = 8) =>
  chunkWords(mkWords(tokens), makeChunkerOptions({ wordsPerChunk }));

describe("selectKeywords", () => {
  it("returns the plan unchanged when disabled (all normal)", () => {
    const p = plan(["the", "quick", "brown", "fox"]);
    selectKeywords(p, kw({ enabled: false }));
    for (const w of p.flatMap((c) => c.words)) {
      expect(w.role).toBe("normal");
      expect(w.keywordColor).toBeUndefined();
    }
  });

  it("selects zero keywords at aggressiveness 0", () => {
    const p = plan(["fox", "jumps", "quickly", "dogs"]);
    selectKeywords(p, kw({ aggressiveness: 0 }));
    const kwCount = p
      .flatMap((c) => c.words)
      .filter((w) => w.role === "keyword").length;
    expect(kwCount).toBe(0);
  });

  it("tags all eligible words at aggressiveness 100", () => {
    // nouns: fox, dogs ; non-eligible: the, over
    const p = plan(["the", "fox", "over", "dogs"]);
    selectKeywords(p, kw({ aggressiveness: 100, wordClasses: ["noun"] }));
    const roles = Object.fromEntries(
      p.flatMap((c) => c.words).map((w) => [w.word, w.role]),
    );
    expect(roles["fox"]).toBe("keyword");
    expect(roles["dogs"]).toBe("keyword");
    expect(roles["the"]).toBe("normal");
    expect(roles["over"]).toBe("normal");
  });

  it("respects the wordClasses filter (numbers only)", () => {
    const p = plan(["fox", "42", "dogs", "99"]);
    selectKeywords(p, kw({ aggressiveness: 100, wordClasses: ["number"] }));
    const roles = Object.fromEntries(
      p.flatMap((c) => c.words).map((w) => [w.word, w.role]),
    );
    expect(roles["42"]).toBe("keyword");
    expect(roles["99"]).toBe("keyword");
    expect(roles["fox"]).toBe("normal");
    expect(roles["dogs"]).toBe("normal");
  });

  it("rotates colors across selected keywords within a chunk", () => {
    const p = plan(["cat", "dog", "fox", "cow"]); // 4 nouns, one chunk
    selectKeywords(p, kw({ aggressiveness: 100, wordClasses: ["noun"] }));
    const colors = p[0]!.words
      .filter((w) => w.role === "keyword")
      .map((w) => w.keywordColor);
    expect(colors).toEqual(["#111111", "#222222", "#333333", "#111111"]);
  });

  it("prioritises the most salient eligible word at low aggressiveness", () => {
    // Two nouns; the proper noun (London) should be picked before the common one (cat)
    const p = plan(["cat", "London"]);
    selectKeywords(
      p,
      kw({ aggressiveness: 50, wordClasses: ["noun"] }), // pick 1 of 2
    );
    const roles = Object.fromEntries(
      p.flatMap((c) => c.words).map((w) => [w.word, w.role]),
    );
    expect(roles["London"]).toBe("keyword");
    expect(roles["cat"]).toBe("normal");
  });
});
