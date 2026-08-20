import { describe, it, expect } from "vitest";
import { isFinalAttempt } from "../attempts.js";

/**
 * Tutorial jobs are enqueued with `attempts: 2`. Reporting FAILED_* on the
 * first of those two runs is what made the studio flash a red error card that
 * disappeared again once the automatic retry succeeded.
 */
describe("isFinalAttempt", () => {
  it("is false on the first of two attempts — the retry is still coming", () => {
    expect(isFinalAttempt({ attemptsMade: 0, opts: { attempts: 2 } })).toBe(
      false,
    );
  });

  it("is true on the second of two attempts — nothing left to try", () => {
    expect(isFinalAttempt({ attemptsMade: 1, opts: { attempts: 2 } })).toBe(
      true,
    );
  });

  it("is true when the job was queued with no retries at all", () => {
    expect(isFinalAttempt({ attemptsMade: 0, opts: { attempts: 1 } })).toBe(
      true,
    );
  });

  it("treats a missing attempts option as single-shot, so failures still surface", () => {
    expect(isFinalAttempt({ attemptsMade: 0, opts: {} })).toBe(true);
  });

  it("never swallows a terminal failure once attempts are exhausted", () => {
    expect(isFinalAttempt({ attemptsMade: 5, opts: { attempts: 2 } })).toBe(
      true,
    );
  });
});
