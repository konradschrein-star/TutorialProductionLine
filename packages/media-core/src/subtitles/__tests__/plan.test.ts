import { describe, it, expect } from "vitest";
import { buildCaptionPlan } from "../plan.js";
import { mkWords, mkWordsExact, makeRemotionConfig } from "./_fixtures.js";

describe("buildCaptionPlan", () => {
  it("chunks words into a CaptionPlan", () => {
    const plan = buildCaptionPlan(
      mkWords(["a", "b", "c", "d", "e"]),
      makeRemotionConfig({ wordsPerChunk: 2 }),
    );
    // [a,b] [c,d] [e] — the trailing single-word cue is only 0.4s at the
    // fixture stride, under the minimum readable cue duration, so it is merged
    // back into its neighbour instead of flashing on screen.
    expect(plan.map((c) => c.words.length)).toEqual([2, 3]);
  });

  it("returns [] for empty input", () => {
    expect(buildCaptionPlan([], makeRemotionConfig())).toEqual([]);
  });

  it("applies keyword tagging when keyword.enabled", () => {
    const plan = buildCaptionPlan(
      mkWords(["the", "fox", "over", "dogs"]),
      makeRemotionConfig({
        wordsPerChunk: 8,
        keyword: {
          enabled: true,
          wordClasses: ["noun"],
          aggressiveness: 100,
          colors: ["#AAA", "#BBB", "#CCC"],
          bold: true,
          italic: false,
          background: null,
        },
      }),
    );
    const roles = Object.fromEntries(
      plan.flatMap((c) => c.words).map((w) => [w.word, w.role]),
    );
    expect(roles["fox"]).toBe("keyword");
    expect(roles["dogs"]).toBe("keyword");
  });

  it("does NOT tag secondary roles when secondaryFont is null", () => {
    const plan = buildCaptionPlan(
      mkWords(["hello", "world"]),
      makeRemotionConfig({ secondaryFont: null }),
    );
    for (const w of plan.flatMap((c) => c.words)) {
      expect(w.role).toBe("normal");
    }
  });

  it("tags non-keyword words as 'secondary' when secondaryFont is set", () => {
    const plan = buildCaptionPlan(
      mkWords(["hello", "world", "foo"]),
      makeRemotionConfig({
        secondaryFont: { fontId: null, fontFamily: "Roboto", fontWeight: 400 },
      }),
    );
    // keyword disabled by default -> every word becomes secondary
    for (const w of plan.flatMap((c) => c.words)) {
      expect(w.role).toBe("secondary");
    }
  });

  it("leaves keyword words as 'keyword' and others 'secondary' when both active", () => {
    const plan = buildCaptionPlan(
      mkWords(["the", "fox", "runs"]),
      makeRemotionConfig({
        wordsPerChunk: 8,
        secondaryFont: { fontId: null, fontFamily: "Roboto", fontWeight: 400 },
        keyword: {
          enabled: true,
          wordClasses: ["noun"],
          aggressiveness: 100,
          colors: ["#AAA"],
          bold: true,
          italic: false,
          background: null,
        },
      }),
    );
    const roles = Object.fromEntries(
      plan.flatMap((c) => c.words).map((w) => [w.word, w.role]),
    );
    expect(roles["fox"]).toBe("keyword");
    expect(roles["the"]).toBe("secondary");
    expect(roles["runs"]).toBe("secondary");
  });

  it("propagates malformed-input errors from the chunker", () => {
    const bad = mkWordsExact([
      ["a", 1.0, 1.4],
      ["b", 0.5, 0.9],
    ]);
    expect(() => buildCaptionPlan(bad, makeRemotionConfig())).toThrow();
  });
});
