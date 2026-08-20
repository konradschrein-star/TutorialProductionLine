import { isRetryable, type StorageError } from "./errors.js";

/**
 * Retry / backoff policy. Deliberately pure and dependency-injected (`rng`,
 * `sleep`) so the whole thing is unit-testable with no timers and no network.
 */

export interface BackoffOptions {
  /** Delay before the 2nd attempt, in ms. */
  baseDelayMs: number;
  /** Hard ceiling on any single delay, in ms. */
  maxDelayMs: number;
  /** Total attempts including the first. */
  maxAttempts: number;
  /**
   * Jitter fraction in [0, 1]. 0 = deterministic exponential,
   * 1 = "full jitter" (delay uniformly sampled from [0, exponential]).
   */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
  maxAttempts: 5,
  jitter: 1,
};

/**
 * Exponential backoff with jitter for `attempt` (1-based: attempt 1 is the
 * first *retry*, i.e. it runs after the initial try failed).
 *
 * `rng` must return [0, 1). Injecting it makes the jitter deterministic in
 * tests.
 */
export function computeBackoffDelayMs(
  attempt: number,
  opts: BackoffOptions = DEFAULT_BACKOFF,
  rng: () => number = Math.random,
): number {
  if (attempt < 1) {
    throw new Error(
      `computeBackoffDelayMs: attempt must be >= 1, got ${attempt}`,
    );
  }

  const exponential = opts.baseDelayMs * Math.pow(2, attempt - 1);
  const capped = Math.min(exponential, opts.maxDelayMs);

  if (opts.jitter <= 0) return Math.round(capped);

  const jitterFraction = Math.min(opts.jitter, 1);
  // Sample from [capped * (1 - jitter), capped]. With jitter = 1 this is the
  // classic "full jitter" strategy, which is what spreads a thundering herd
  // of parallel uploads off a single rate-limit wall.
  const floor = capped * (1 - jitterFraction);
  return Math.round(floor + rng() * (capped - floor));
}

/**
 * How long to wait before the next attempt, honouring a server-supplied
 * Retry-After when it is longer than our own computed backoff. Never shorter
 * than the server asked for — that is the whole point of the header.
 */
export function nextDelayMs(
  attempt: number,
  err: StorageError,
  opts: BackoffOptions = DEFAULT_BACKOFF,
  rng: () => number = Math.random,
): number {
  const computed = computeBackoffDelayMs(attempt, opts, rng);
  if (err.retryAfterMs !== undefined && err.retryAfterMs > computed) {
    return Math.min(err.retryAfterMs, opts.maxDelayMs * 4);
  }
  return computed;
}

export function shouldRetry(
  attempt: number,
  err: StorageError,
  opts: BackoffOptions = DEFAULT_BACKOFF,
): boolean {
  if (!isRetryable(err.kind)) return false;
  return attempt < opts.maxAttempts;
}

export type Attempt<T> =
  | { ok: true; value: T }
  | { ok: false; error: StorageError };

export interface RetryDeps {
  sleep: (ms: number) => Promise<void>;
  rng: () => number;
  onRetry?: (info: {
    attempt: number;
    delayMs: number;
    error: StorageError;
  }) => void;
}

export const realRetryDeps: RetryDeps = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  rng: Math.random,
};

/**
 * Run `fn` under the retry policy. `fn` returns an `Attempt` rather than
 * throwing, so error classification stays explicit at the call site.
 *
 * NOTE: this never converts a failure into a success. There is no fallback
 * path here by design — a Drive failure must surface, not be swallowed.
 */
export async function withRetry<T>(
  fn: (attemptNumber: number) => Promise<Attempt<T>>,
  opts: BackoffOptions = DEFAULT_BACKOFF,
  deps: RetryDeps = realRetryDeps,
): Promise<Attempt<T>> {
  let attempt = 1;
  for (;;) {
    const result = await fn(attempt);
    if (result.ok) return result;

    if (!shouldRetry(attempt, result.error, opts)) {
      return result;
    }

    const delayMs = nextDelayMs(attempt, result.error, opts, deps.rng);
    deps.onRetry?.({ attempt, delayMs, error: result.error });
    await deps.sleep(delayMs);
    attempt += 1;
  }
}
