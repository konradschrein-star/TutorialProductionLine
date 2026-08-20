/**
 * Token-bucket rate limiter for Drive API calls.
 *
 * Google Drive's per-project quota is ~12,000 requests / 60s and ~100
 * requests/sec/user. We stay well under that on purpose: this subsystem is a
 * background nice-to-have, and starving the rest of the app's quota to push a
 * video faster is a bad trade.
 *
 * Time and sleep are injected so the whole thing is testable without timers.
 */

export interface RateLimiterOptions {
  /** Sustained request rate. */
  requestsPerSecond: number;
  /** Burst allowance — how many tokens the bucket can hold. */
  burst: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class TokenBucketRateLimiter {
  private readonly ratePerMs: number;
  private readonly burst: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  private tokens: number;
  private lastRefill: number;
  /** Serialises waiters so N concurrent callers do not all see a full bucket. */
  private queue: Promise<void> = Promise.resolve();

  constructor(opts: RateLimiterOptions) {
    if (opts.requestsPerSecond <= 0) {
      throw new Error("requestsPerSecond must be > 0");
    }
    if (opts.burst < 1) {
      throw new Error("burst must be >= 1");
    }
    this.ratePerMs = opts.requestsPerSecond / 1000;
    this.burst = opts.burst;
    this.now = opts.now ?? Date.now;
    this.sleep =
      opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.tokens = opts.burst;
    this.lastRefill = this.now();
  }

  private refill(): void {
    const t = this.now();
    const elapsed = t - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.ratePerMs);
    this.lastRefill = t;
  }

  /** Milliseconds until one token is available. 0 when a token is free now. */
  msUntilAvailable(): number {
    this.refill();
    // `penalise()` parks `lastRefill` in the future to stall the bucket. That
    // dead period has to be added on top of the token wait, otherwise a 429
    // penalty is silently ignored and we hammer straight back into the limit.
    const stalledForMs = Math.max(0, this.lastRefill - this.now());
    if (this.tokens >= 1 && stalledForMs === 0) return 0;
    const tokenWaitMs = Math.max(0, (1 - this.tokens) / this.ratePerMs);
    return Math.ceil(stalledForMs + tokenWaitMs);
  }

  /** Take a token, sleeping if necessary. Calls are served in arrival order. */
  async acquire(): Promise<void> {
    const mine = this.queue.then(async () => {
      for (;;) {
        const waitMs = this.msUntilAvailable();
        if (waitMs === 0) {
          this.tokens -= 1;
          return;
        }
        await this.sleep(waitMs);
      }
    });
    // Keep the chain alive even if a waiter rejects.
    this.queue = mine.catch(() => undefined);
    return mine;
  }

  /**
   * Pause the bucket for `ms` — used when the server tells us to back off, so
   * that a 429 on one request also slows every other in-flight request.
   */
  penalise(ms: number): void {
    if (ms <= 0) return;
    this.refill();
    this.tokens = 0;
    this.lastRefill = this.now() + ms;
  }

  /** Test/debug accessor. */
  availableTokens(): number {
    this.refill();
    return this.tokens;
  }
}
