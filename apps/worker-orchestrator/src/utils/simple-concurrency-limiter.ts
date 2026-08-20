/**
 * Fixed-capacity in-process concurrency limiter with FIFO queueing.
 *
 * Used by the clip-label worker to enforce a per-library cap on top of the
 * BullMQ worker-level concurrency. BullMQ gives us N total slots; this
 * limiter ensures no more than `clip_libraries.labeling_concurrency` of
 * those slots are spent on any single library at once.
 *
 * Distinct from AdaptiveRateLimiter (which ramps up/down on 429s). This is
 * a plain "no more than N at a time", swappable at runtime via setMax to
 * pick up DB config changes between jobs.
 */
export class SimpleConcurrencyLimiter {
  private active = 0;
  private waiters: Array<() => void> = [];
  private maxConcurrency: number;

  constructor(maxConcurrency: number) {
    this.maxConcurrency = Math.max(1, Math.floor(maxConcurrency));
  }

  /** Current cap. */
  get max(): number {
    return this.maxConcurrency;
  }

  /** Currently running. Useful in logs. */
  get inFlight(): number {
    return this.active;
  }

  /** Update the cap. Existing waiters get a chance to start if cap grew. */
  setMax(n: number): void {
    const next = Math.max(1, Math.floor(n));
    if (next === this.maxConcurrency) return;
    this.maxConcurrency = next;
    while (this.active < this.maxConcurrency && this.waiters.length > 0) {
      const w = this.waiters.shift();
      if (w) w();
    }
  }

  /** Run fn under the cap, queueing if at capacity. */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.waiters.shift();
      if (next) next();
    }
  }
}

// ── Per-library registry ─────────────────────────────────────────────────────
// One limiter per library_id, process-global. Lazily initialized on first
// use; cap re-read from clip_libraries.labeling_concurrency on every job so
// raising/lowering the setting in the DB takes effect on the next job.

const REGISTRY = new Map<string, SimpleConcurrencyLimiter>();

/**
 * Get (or create) the limiter for a library and sync its cap with the
 * current DB setting.
 */
export function getLibraryLabelLimiter(
  libraryId: string,
  maxConcurrency: number,
): SimpleConcurrencyLimiter {
  let limiter = REGISTRY.get(libraryId);
  if (!limiter) {
    limiter = new SimpleConcurrencyLimiter(maxConcurrency);
    REGISTRY.set(libraryId, limiter);
  } else {
    limiter.setMax(maxConcurrency);
  }
  return limiter;
}
