/**
 * Adaptive Rate Limiter
 *
 * Dynamically adjusts concurrency based on API response patterns.
 * Ramps up on consecutive successes, backs off on rate limit (429) errors.
 *
 * Ported from the previous political content automation project's proven pattern.
 */

export interface AdaptiveRateLimiterConfig {
  /** Starting concurrency (default: 3) */
  initialConcurrency?: number;
  /** Minimum concurrency floor (default: 1) */
  minConcurrency?: number;
  /** Maximum concurrency ceiling (default: 6) */
  maxConcurrency?: number;
  /** Consecutive successes before ramping up (default: 5) */
  successesBeforeRampUp?: number;
  /** Consecutive rate limits before ramping down (default: 2) */
  rateLimitsBeforeRampDown?: number;
}

export class AdaptiveRateLimiter {
  private concurrency: number;
  private readonly min: number;
  private readonly max: number;
  private readonly successesBeforeRampUp: number;
  private readonly rateLimitsBeforeRampDown: number;

  private consecutiveSuccesses = 0;
  private consecutiveRateLimits = 0;
  private activeCount = 0;
  private readonly queue: Array<() => void> = [];

  constructor(config: AdaptiveRateLimiterConfig = {}) {
    this.concurrency = config.initialConcurrency ?? 3;
    this.min = config.minConcurrency ?? 1;
    this.max = config.maxConcurrency ?? 6;
    this.successesBeforeRampUp = config.successesBeforeRampUp ?? 5;
    this.rateLimitsBeforeRampDown = config.rateLimitsBeforeRampDown ?? 2;
  }

  /**
   * Execute a function with rate-limited concurrency.
   * Queues execution if at capacity.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Wait for a slot if at capacity
    if (this.activeCount >= this.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }

    this.activeCount++;
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      if (this.isRateLimitError(error)) {
        this.onRateLimit();
      } else {
        // Non-rate-limit error: reset success streak but don't change concurrency
        this.consecutiveSuccesses = 0;
      }
      throw error;
    } finally {
      this.activeCount--;
      // Release next queued task
      const next = this.queue.shift();
      if (next) next();
    }
  }

  private onSuccess(): void {
    this.consecutiveRateLimits = 0;
    this.consecutiveSuccesses++;

    if (this.consecutiveSuccesses >= this.successesBeforeRampUp) {
      if (this.concurrency < this.max) {
        this.concurrency++;
        console.log(
          JSON.stringify({
            level: "info",
            message: "Rate limiter ramping up",
            new_concurrency: this.concurrency,
          })
        );
      }
      this.consecutiveSuccesses = 0;
    }
  }

  private onRateLimit(): void {
    this.consecutiveSuccesses = 0;
    this.consecutiveRateLimits++;

    if (this.consecutiveRateLimits >= this.rateLimitsBeforeRampDown) {
      if (this.concurrency > this.min) {
        this.concurrency--;
        console.log(
          JSON.stringify({
            level: "warn",
            message: "Rate limiter backing off",
            new_concurrency: this.concurrency,
          })
        );
      }
      this.consecutiveRateLimits = 0;
    }
  }

  private isRateLimitError(error: unknown): boolean {
    if (error instanceof Error) {
      return (
        error.message.includes("429") ||
        error.message.toLowerCase().includes("rate limit") ||
        error.message.toLowerCase().includes("too many requests")
      );
    }
    return false;
  }

  get currentConcurrency(): number {
    return this.concurrency;
  }

  get activeRequests(): number {
    return this.activeCount;
  }
}

/**
 * Simple concurrency limiter (non-adaptive).
 * Limits the number of concurrent executions of an async function.
 */
export function limitConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<PromiseSettledResult<T>[]> {
  return new Promise((resolve) => {
    const results: PromiseSettledResult<T>[] = new Array(tasks.length);
    let completed = 0;
    let started = 0;

    function runNext() {
      if (started >= tasks.length) return;
      const index = started++;

      tasks[index]()
        .then((value) => {
          results[index] = { status: "fulfilled", value };
        })
        .catch((reason) => {
          results[index] = { status: "rejected", reason };
        })
        .finally(() => {
          completed++;
          if (completed === tasks.length) {
            resolve(results);
          } else {
            runNext();
          }
        });
    }

    // Start initial batch
    const initialBatch = Math.min(concurrency, tasks.length);
    for (let i = 0; i < initialBatch; i++) {
      runNext();
    }

    // Handle empty task list
    if (tasks.length === 0) resolve([]);
  });
}
