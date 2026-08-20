import { describe, it, expect } from "vitest";
import { TokenBucketRateLimiter } from "../rate-limiter.js";

/**
 * A controllable clock: `sleep` advances time instead of waiting, so the
 * limiter's behaviour is asserted exactly and the suite runs instantly.
 */
function fakeClock(start = 0) {
  let t = start;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleeps,
    advance: (ms: number) => {
      t += ms;
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
  };
}

describe("TokenBucketRateLimiter", () => {
  it("rejects nonsense configuration instead of silently misbehaving", () => {
    expect(
      () => new TokenBucketRateLimiter({ requestsPerSecond: 0, burst: 1 }),
    ).toThrow();
    expect(
      () => new TokenBucketRateLimiter({ requestsPerSecond: 1, burst: 0 }),
    ).toThrow();
  });

  it("allows an immediate burst then throttles", async () => {
    const clock = fakeClock();
    const limiter = new TokenBucketRateLimiter({
      requestsPerSecond: 4,
      burst: 4,
      now: clock.now,
      sleep: clock.sleep,
    });

    for (let i = 0; i < 4; i += 1) {
      expect(limiter.msUntilAvailable()).toBe(0);
      await limiter.acquire();
    }
    // Bucket empty: 4 rps => 250 ms per token.
    expect(limiter.msUntilAvailable()).toBe(250);
  });

  it("refills over time at the configured rate", async () => {
    const clock = fakeClock();
    const limiter = new TokenBucketRateLimiter({
      requestsPerSecond: 2,
      burst: 2,
      now: clock.now,
      sleep: clock.sleep,
    });

    await limiter.acquire();
    await limiter.acquire();
    expect(limiter.availableTokens()).toBeCloseTo(0, 5);

    clock.advance(1_000); // 2 rps for 1s => 2 tokens
    expect(limiter.availableTokens()).toBeCloseTo(2, 5);
  });

  it("never refills beyond the burst ceiling", () => {
    const clock = fakeClock();
    const limiter = new TokenBucketRateLimiter({
      requestsPerSecond: 10,
      burst: 3,
      now: clock.now,
      sleep: clock.sleep,
    });
    clock.advance(60_000);
    expect(limiter.availableTokens()).toBe(3);
  });

  it("serialises concurrent acquirers so the rate holds under parallelism", async () => {
    const clock = fakeClock();
    const limiter = new TokenBucketRateLimiter({
      requestsPerSecond: 1,
      burst: 1,
      now: clock.now,
      sleep: clock.sleep,
    });

    await Promise.all(Array.from({ length: 4 }, () => limiter.acquire()));

    // 1 rps, burst 1: the first acquirer is free, then one per second. The
    // sleep log is the honest record of what the limiter actually enforced
    // (reading the clock from a .then() races with the other waiters).
    expect(clock.sleeps).toEqual([1_000, 1_000, 1_000]);
    expect(clock.now()).toBe(3_000);
  });

  it("holds the rate even when callers arrive all at once", async () => {
    const clock = fakeClock();
    const limiter = new TokenBucketRateLimiter({
      requestsPerSecond: 2,
      burst: 2,
      now: clock.now,
      sleep: clock.sleep,
    });

    await Promise.all(Array.from({ length: 6 }, () => limiter.acquire()));

    // burst of 2 free, then 4 more at 2 rps => 500 ms apart, 2 s total.
    expect(clock.sleeps).toEqual([500, 500, 500, 500]);
    expect(clock.now()).toBe(2_000);
  });

  it("penalise() stalls every caller, not just the one that got a 429", async () => {
    const clock = fakeClock();
    const limiter = new TokenBucketRateLimiter({
      requestsPerSecond: 100,
      burst: 100,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(limiter.msUntilAvailable()).toBe(0);
    limiter.penalise(5_000);
    // Whole bucket drained and the refill clock pushed into the future.
    expect(limiter.msUntilAvailable()).toBeGreaterThan(4_000);

    await limiter.acquire();
    expect(clock.now()).toBeGreaterThanOrEqual(5_000);
  });

  it("ignores a non-positive penalty", () => {
    const clock = fakeClock();
    const limiter = new TokenBucketRateLimiter({
      requestsPerSecond: 5,
      burst: 5,
      now: clock.now,
      sleep: clock.sleep,
    });
    limiter.penalise(0);
    limiter.penalise(-100);
    expect(limiter.msUntilAvailable()).toBe(0);
  });
});
