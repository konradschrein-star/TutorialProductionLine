import { describe, it, expect } from "vitest";
import {
  simulateWordTimings,
  simulatedDuration,
  estimateSyllables,
  trailingPause,
  MIN_WORD_SECONDS,
  MAX_WORD_SECONDS,
  DEFAULT_WPM,
} from "../simulate-timings";

describe("estimateSyllables", () => {
  it("counts vowel groups", () => {
    expect(estimateSyllables("cat")).toBe(1);
    expect(estimateSyllables("hello")).toBe(2);
    expect(estimateSyllables("banana")).toBe(3);
  });

  it("never returns less than 1", () => {
    expect(estimateSyllables("")).toBe(1);
    expect(estimateSyllables("!!!")).toBe(1);
    expect(estimateSyllables("rhythm")).toBeGreaterThanOrEqual(1);
  });

  it("drops a silent trailing e", () => {
    expect(estimateSyllables("time")).toBe(1);
    expect(estimateSyllables("large")).toBe(1);
  });

  it("keeps consonant + le as its own syllable", () => {
    expect(estimateSyllables("table")).toBe(2);
    expect(estimateSyllables("little")).toBe(2);
  });

  it("gives long words more syllables than short ones", () => {
    expect(estimateSyllables("extraordinary")).toBeGreaterThan(
      estimateSyllables("a"),
    );
  });
});

describe("trailingPause", () => {
  it("pauses longest on an ellipsis", () => {
    expect(trailingPause("wait...")).toBeGreaterThan(trailingPause("wait."));
  });

  it("pauses more at a sentence end than at a comma", () => {
    expect(trailingPause("done.")).toBeGreaterThan(trailingPause("done,"));
    expect(trailingPause("really?")).toBeGreaterThan(trailingPause("really;"));
  });

  it("is zero for a bare word", () => {
    expect(trailingPause("hello")).toBe(0);
  });

  it("looks through a trailing quote or bracket", () => {
    expect(trailingPause('he said."')).toBeGreaterThan(0);
  });
});

describe("simulateWordTimings", () => {
  it("returns nothing for blank input", () => {
    expect(simulateWordTimings("")).toEqual([]);
    expect(simulateWordTimings("   \n  ")).toEqual([]);
  });

  it("emits one entry per whitespace-separated token, punctuation kept", () => {
    const words = simulateWordTimings("Hello there, world.");
    expect(words.map((w) => w.word)).toEqual(["Hello", "there,", "world."]);
  });

  it("produces monotonic, non-overlapping timings", () => {
    const words = simulateWordTimings(
      "The quick brown fox jumps over the lazy dog, again and again.",
    );
    for (let i = 0; i < words.length; i++) {
      expect(words[i]!.end).toBeGreaterThan(words[i]!.start);
      if (i > 0) {
        expect(words[i]!.start).toBeGreaterThanOrEqual(words[i - 1]!.end);
      }
    }
  });

  it("clamps every word duration into the speech range", () => {
    const words = simulateWordTimings(
      "a incomprehensibility antidisestablishmentarianism I",
      { wordsPerMinute: 40 },
    );
    for (const w of words) {
      const d = w.end - w.start;
      expect(d).toBeGreaterThanOrEqual(MIN_WORD_SECONDS - 1e-6);
      expect(d).toBeLessThanOrEqual(MAX_WORD_SECONDS + 1e-6);
    }
  });

  it("is deterministic", () => {
    const a = simulateWordTimings("Same text, same timings.");
    const b = simulateWordTimings("Same text, same timings.");
    expect(a).toEqual(b);
  });

  it("a higher WPM produces a shorter total", () => {
    const text = "This is a reasonably long sentence used to compare rates.";
    const slow = simulatedDuration(
      simulateWordTimings(text, { wordsPerMinute: 90 }),
    );
    const fast = simulatedDuration(
      simulateWordTimings(text, { wordsPerMinute: 240 }),
    );
    expect(fast).toBeLessThan(slow);
  });

  it("lands near the requested words-per-minute", () => {
    // 20 plain words, no punctuation pauses -> effective rate should be close
    // to the requested rate.
    const text = Array.from({ length: 20 }, () => "word").join(" ");
    const words = simulateWordTimings(text, {
      wordsPerMinute: DEFAULT_WPM,
      leadIn: 0,
    });
    const total = simulatedDuration(words);
    const effectiveWpm = (words.length / total) * 60;
    expect(effectiveWpm).toBeGreaterThan(DEFAULT_WPM * 0.85);
    expect(effectiveWpm).toBeLessThan(DEFAULT_WPM * 1.15);
  });

  it("inserts a real pause after a sentence end", () => {
    const words = simulateWordTimings("stop. go", { leadIn: 0 });
    const gap = words[1]!.start - words[0]!.end;
    expect(gap).toBeGreaterThan(0.3);
  });

  it("honours leadIn", () => {
    const words = simulateWordTimings("hello", { leadIn: 1.5 });
    expect(words[0]!.start).toBeCloseTo(1.5, 3);
  });

  it("holds a long word longer than a short one at the same rate", () => {
    const words = simulateWordTimings("a extraordinary", { leadIn: 0 });
    const shortDur = words[0]!.end - words[0]!.start;
    const longDur = words[1]!.end - words[1]!.start;
    expect(longDur).toBeGreaterThan(shortDur);
  });
});
