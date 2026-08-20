import { describe, it, expect, vi } from "vitest";
import {
  computeBackoffDelayMs,
  nextDelayMs,
  shouldRetry,
  withRetry,
  type Attempt,
  type BackoffOptions,
  type RetryDeps,
} from "../retry.js";
import { storageError, isRetryable } from "../errors.js";

const OPTS: BackoffOptions = {
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  maxAttempts: 5,
  jitter: 0,
};

function fakeDeps(rng = 0.5): RetryDeps & { slept: number[] } {
  const slept: number[] = [];
  return {
    slept,
    sleep: async (ms: number) => {
      slept.push(ms);
    },
    rng: () => rng,
  };
}

describe("computeBackoffDelayMs", () => {
  it("doubles each attempt with jitter disabled", () => {
    expect(computeBackoffDelayMs(1, OPTS)).toBe(1_000);
    expect(computeBackoffDelayMs(2, OPTS)).toBe(2_000);
    expect(computeBackoffDelayMs(3, OPTS)).toBe(4_000);
    expect(computeBackoffDelayMs(4, OPTS)).toBe(8_000);
  });

  it("caps at maxDelayMs however many attempts pass", () => {
    expect(computeBackoffDelayMs(10, OPTS)).toBe(30_000);
    expect(computeBackoffDelayMs(50, OPTS)).toBe(30_000);
  });

  it("applies full jitter as a uniform sample of [0, exponential]", () => {
    const jittered: BackoffOptions = { ...OPTS, jitter: 1 };
    expect(computeBackoffDelayMs(3, jittered, () => 0)).toBe(0);
    expect(computeBackoffDelayMs(3, jittered, () => 1)).toBe(4_000);
    expect(computeBackoffDelayMs(3, jittered, () => 0.5)).toBe(2_000);
  });

  it("applies partial jitter within [floor, exponential]", () => {
    const half: BackoffOptions = { ...OPTS, jitter: 0.5 };
    // exponential for attempt 3 = 4000, floor = 2000
    expect(computeBackoffDelayMs(3, half, () => 0)).toBe(2_000);
    expect(computeBackoffDelayMs(3, half, () => 1)).toBe(4_000);
  });

  it("spreads concurrent callers apart (the whole point of jitter)", () => {
    const jittered: BackoffOptions = { ...OPTS, jitter: 1 };
    const samples = new Set(
      Array.from({ length: 50 }, (_, i) =>
        computeBackoffDelayMs(4, jittered, () => i / 50),
      ),
    );
    expect(samples.size).toBeGreaterThan(40);
  });

  it("rejects a non-positive attempt number rather than guessing", () => {
    expect(() => computeBackoffDelayMs(0, OPTS)).toThrow(
      /attempt must be >= 1/,
    );
  });
});

describe("nextDelayMs", () => {
  it("honours a longer server Retry-After over our own backoff", () => {
    const err = storageError("rate_limited", "slow down", {
      retryAfterMs: 20_000,
    });
    expect(nextDelayMs(1, err, OPTS)).toBe(20_000);
  });

  it("ignores a Retry-After shorter than our computed backoff", () => {
    const err = storageError("rate_limited", "slow down", {
      retryAfterMs: 100,
    });
    expect(nextDelayMs(3, err, OPTS)).toBe(4_000);
  });

  it("clamps an absurd Retry-After so a worker cannot hang for a day", () => {
    const err = storageError("rate_limited", "slow", {
      retryAfterMs: 86_400_000,
    });
    expect(nextDelayMs(1, err, OPTS)).toBe(OPTS.maxDelayMs * 4);
  });
});

describe("shouldRetry", () => {
  it("retries transient kinds", () => {
    for (const kind of ["rate_limited", "server", "network"] as const) {
      expect(isRetryable(kind)).toBe(true);
      expect(shouldRetry(1, storageError(kind, "x"), OPTS)).toBe(true);
    }
  });

  it("never retries a full Drive, bad credentials, or a bad request", () => {
    for (const kind of [
      "quota_exceeded",
      "auth",
      "bad_request",
      "local_file",
      "unknown",
    ] as const) {
      expect(shouldRetry(1, storageError(kind, "x"), OPTS)).toBe(false);
    }
  });

  it("stops at maxAttempts", () => {
    const err = storageError("server", "boom");
    expect(shouldRetry(4, err, OPTS)).toBe(true);
    expect(shouldRetry(5, err, OPTS)).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns immediately on success without sleeping", async () => {
    const deps = fakeDeps();
    const fn = vi.fn(
      async (): Promise<Attempt<string>> => ({ ok: true, value: "v" }),
    );
    const result = await withRetry(fn, OPTS, deps);
    expect(result).toEqual({ ok: true, value: "v" });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(deps.slept).toEqual([]);
  });

  it("retries a transient failure and succeeds", async () => {
    const deps = fakeDeps();
    let calls = 0;
    const result = await withRetry<string>(
      async () => {
        calls += 1;
        if (calls < 3)
          return { ok: false, error: storageError("server", "500") };
        return { ok: true, value: "eventually" };
      },
      OPTS,
      deps,
    );
    expect(result).toEqual({ ok: true, value: "eventually" });
    expect(calls).toBe(3);
    expect(deps.slept).toEqual([1_000, 2_000]);
  });

  it("gives up after maxAttempts and returns the LAST error, not a success", async () => {
    const deps = fakeDeps();
    let calls = 0;
    const result = await withRetry<string>(
      async () => {
        calls += 1;
        return {
          ok: false,
          error: storageError("rate_limited", `attempt ${calls}`),
        };
      },
      OPTS,
      deps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe("attempt 5");
    expect(calls).toBe(5);
    expect(deps.slept).toEqual([1_000, 2_000, 4_000, 8_000]);
  });

  it("does not retry a non-retryable failure at all", async () => {
    const deps = fakeDeps();
    let calls = 0;
    const result = await withRetry<string>(
      async () => {
        calls += 1;
        return {
          ok: false,
          error: storageError("quota_exceeded", "Drive full"),
        };
      },
      OPTS,
      deps,
    );
    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
    expect(deps.slept).toEqual([]);
  });

  it("reports each retry so the failure is never invisible", async () => {
    const seen: string[] = [];
    const deps: RetryDeps = {
      sleep: async () => undefined,
      rng: () => 0.5,
      onRetry: ({ attempt, error }) => seen.push(`${attempt}:${error.kind}`),
    };
    await withRetry<string>(
      async () => ({ ok: false, error: storageError("network", "ECONNRESET") }),
      { ...OPTS, maxAttempts: 3 },
      deps,
    );
    expect(seen).toEqual(["1:network", "2:network"]);
  });
});
