/**
 * Clause Splitter Tests
 *
 * Covers splitIntoClauses's word-alignment behavior, including the ≥50%
 * match-rate gate and per-clause `matched` provenance flag added to bring
 * this module in line with packages/domain/src/pacing.ts's established
 * "throw with diagnostics, never silently fabricate a timing" policy.
 */

import { describe, it, expect } from "vitest";
import { splitIntoClauses } from "../clause-splitter.js";
import type { WordTimestamp } from "@repo/contracts";

/** Build a synthetic sequence of WordTimestamp objects (seconds). */
function makeWordTimings(
  words: string[],
  durationPerWord = 0.3,
): WordTimestamp[] {
  return words.map((word, i) => ({
    word,
    start: i * durationPerWord,
    end: i * durationPerWord + durationPerWord,
  }));
}

// ---------------------------------------------------------------------------
// Basic behavior
// ---------------------------------------------------------------------------

describe("splitIntoClauses — basic behavior", () => {
  it("returns [] for empty script", () => {
    const words = makeWordTimings(["alpha", "beta"]);
    expect(splitIntoClauses("", words)).toEqual([]);
    expect(splitIntoClauses("   ", words)).toEqual([]);
  });

  it("returns [] for empty wordTimings", () => {
    expect(splitIntoClauses("Alpha beta gamma.", [])).toEqual([]);
  });

  it("splits two sentences into two clauses with correct ms timings when all words match", () => {
    const words = makeWordTimings([
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
    ]);
    const result = splitIntoClauses(
      "Alpha beta gamma. Delta epsilon zeta.",
      words,
    );

    expect(result).toHaveLength(2);
    expect(result[0]!.matched).toBe(true);
    expect(result[1]!.matched).toBe(true);
    expect(result[0]!.start_ms).toBe(0);
    expect(result[0]!.end_ms).toBe(900);
    expect(result[1]!.start_ms).toBe(900);
    expect(result[1]!.end_ms).toBe(1800);
  });

  it("splits a single sentence into multiple clauses at comma/conjunction boundaries", () => {
    const words = makeWordTimings([
      "we",
      "went",
      "home",
      "because",
      "rain",
      "started",
    ]);
    const result = splitIntoClauses(
      "We went home because rain started.",
      words,
    );
    expect(result.length).toBeGreaterThanOrEqual(2);
    for (const clause of result) {
      expect(clause.matched).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Match-rate gate (no synthetic fallback)
// ---------------------------------------------------------------------------

describe("splitIntoClauses — match-rate gate (no synthetic fallback)", () => {
  it("throws with diagnostics when fewer than 50% of clauses match", () => {
    const script =
      "Alpha beta gamma. Zzzzz yyyyy xxxxx. Wwwww vvvvv uuuuu. Ttttt sssss rrrrr.";
    // Only the first clause's words actually appear in the transcript.
    const words = makeWordTimings(["alpha", "beta", "gamma"]);

    expect(() => splitIntoClauses(script, words)).toThrow(
      /Clause alignment failed/,
    );
  });

  it("error message includes per-clause diagnostics", () => {
    const script =
      "Completely unmatched text here. Another unmatched clause now.";
    const words = makeWordTimings(["foo", "bar", "baz", "qux"]);

    try {
      splitIntoClauses(script, words);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.message).toContain("Clause alignment failed");
      expect(err.message).toContain("Require");
      expect(err.message).toContain("match rate");
      expect(err.message).toContain("Completely unmatched text here.");
    }
  });

  it("does not throw when at least 50% of clauses match", () => {
    // 4 clauses; 3 of 4 (75%) resolve real Whisper anchors.
    const script =
      "Alpha beta gamma. Delta epsilon zeta. Wwwww vvvvv uuuuu. Theta iota kappa.";
    const words = makeWordTimings([
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "theta",
      "iota",
      "kappa",
    ]);

    expect(() => splitIntoClauses(script, words)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Per-clause match provenance
// ---------------------------------------------------------------------------

describe("splitIntoClauses — per-clause match provenance", () => {
  it("marks a clause matched:false when interpolated, others matched:true, within a passing majority", () => {
    // Clause index 2 ("Wwwww vvvvv uuuuu.") never appears in the transcript;
    // clauses 0, 1, 3 do. Overall rate is 75% (>= 50%), so this passes the
    // gate but clause 2 must still be flagged as an interpolated guess.
    const script =
      "Alpha beta gamma. Delta epsilon zeta. Wwwww vvvvv uuuuu. Theta iota kappa.";
    const words = makeWordTimings([
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "theta",
      "iota",
      "kappa",
    ]);

    const result = splitIntoClauses(script, words);

    expect(result).toHaveLength(4);
    expect(result[0]!.matched).toBe(true);
    expect(result[1]!.matched).toBe(true);
    expect(result[2]!.matched).toBe(false);
    expect(result[3]!.matched).toBe(true);

    // Interpolated clause still produces a valid, gapless timeline.
    expect(result[2]!.start_ms).toBeGreaterThanOrEqual(result[1]!.end_ms);
    expect(result[3]!.start_ms).toBeGreaterThanOrEqual(result[2]!.end_ms);
  });

  it("clamps and flags matched:false when the first/last clause has no anchor at all", () => {
    // Middle clause matches; first and last clauses' words are absent, so
    // Pass 3/4 clamp them to 0 / audioDurationMs respectively. Still 1/3
    // matched (33%) — below the gate — so this should throw instead of
    // silently clamping. Verifies the gate fires even for edge clauses.
    const script = "Zzzzz yyyyy xxxxx. Alpha beta gamma. Wwwww vvvvv uuuuu.";
    const words = makeWordTimings(["alpha", "beta", "gamma"]);

    expect(() => splitIntoClauses(script, words)).toThrow(
      /Clause alignment failed/,
    );
  });
});
