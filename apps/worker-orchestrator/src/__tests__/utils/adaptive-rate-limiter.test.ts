import { AdaptiveRateLimiter, limitConcurrency } from "../../utils/adaptive-rate-limiter.js";

// ─── AdaptiveRateLimiter ───────────────────────────────────────────────────────

describe("AdaptiveRateLimiter", () => {
  // ─── execute() return value ────────────────────────────────────────────

  describe("execute() return value", () => {
    it("returns the resolved value of the task", async () => {
      const limiter = new AdaptiveRateLimiter({ initialConcurrency: 2 });
      const task = vi.fn().mockResolvedValue("hello");

      const result = await limiter.execute(task);

      expect(result).toBe("hello");
    });

    it("re-throws non-rate-limit errors", async () => {
      const limiter = new AdaptiveRateLimiter({ initialConcurrency: 2 });
      const task = vi.fn().mockRejectedValue(new Error("network failure"));

      await expect(limiter.execute(task)).rejects.toThrow("network failure");
    });

    it("re-throws rate-limit errors after recording them", async () => {
      const limiter = new AdaptiveRateLimiter({ initialConcurrency: 2 });
      const task = vi.fn().mockRejectedValue(new Error("429 Too Many Requests"));

      await expect(limiter.execute(task)).rejects.toThrow("429");
    });
  });

  // ─── Concurrency limiting ──────────────────────────────────────────────

  describe("concurrency limiting", () => {
    it("never exceeds the configured maxConcurrency", async () => {
      const maxConcurrency = 3;
      const limiter = new AdaptiveRateLimiter({
        initialConcurrency: maxConcurrency,
        maxConcurrency,
        successesBeforeRampUp: 999, // disable ramp-up
      });

      let peak = 0;

      const makeTask = () =>
        vi.fn().mockImplementation(async () => {
          peak = Math.max(peak, limiter.activeRequests);
          // yield to allow other tasks to start
          await Promise.resolve();
        });

      const tasks = Array.from({ length: 10 }, makeTask);
      await Promise.all(tasks.map((t) => limiter.execute(t)));

      expect(peak).toBeLessThanOrEqual(maxConcurrency);
    });

    it("with limit 1, tasks run strictly one at a time", async () => {
      const limiter = new AdaptiveRateLimiter({
        initialConcurrency: 1,
        maxConcurrency: 1,
        successesBeforeRampUp: 999,
      });

      const order: number[] = [];
      let peakActive = 0;

      const makeOrderedTask = (index: number) =>
        vi.fn().mockImplementation(async () => {
          peakActive = Math.max(peakActive, limiter.activeRequests);
          order.push(index);
          await Promise.resolve();
        });

      const tasks = [0, 1, 2, 3].map(makeOrderedTask);
      await Promise.all(tasks.map((t) => limiter.execute(t)));

      expect(peakActive).toBe(1);
      expect(order).toEqual([0, 1, 2, 3]);
    });

    it("all tasks eventually complete — no task is dropped", async () => {
      const limiter = new AdaptiveRateLimiter({
        initialConcurrency: 2,
        maxConcurrency: 4,
      });
      const results: number[] = [];

      await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          limiter.execute(async () => {
            results.push(i);
          })
        )
      );

      expect(results).toHaveLength(12);
    });
  });

  // ─── Rate limit detection ──────────────────────────────────────────────

  describe("isRateLimitError detection", () => {
    it("recognises '429' in the message", async () => {
      const limiter = new AdaptiveRateLimiter({
        initialConcurrency: 2,
        rateLimitsBeforeRampDown: 1,
      });
      const before = limiter.currentConcurrency;
      const task = vi.fn().mockRejectedValue(new Error("429 Too Many Requests"));

      await expect(limiter.execute(task)).rejects.toThrow();
      // After one rate-limit hit with threshold=1, concurrency decreases
      expect(limiter.currentConcurrency).toBeLessThanOrEqual(before);
    });

    it("recognises 'rate limit' in the message (case-insensitive)", async () => {
      const limiter = new AdaptiveRateLimiter({
        initialConcurrency: 3,
        minConcurrency: 1,
        rateLimitsBeforeRampDown: 1,
      });
      const before = limiter.currentConcurrency;
      const task = vi.fn().mockRejectedValue(new Error("Rate Limit exceeded"));

      await expect(limiter.execute(task)).rejects.toThrow();
      expect(limiter.currentConcurrency).toBeLessThanOrEqual(before);
    });

    it("recognises 'too many requests' in the message (case-insensitive)", async () => {
      const limiter = new AdaptiveRateLimiter({
        initialConcurrency: 3,
        minConcurrency: 1,
        rateLimitsBeforeRampDown: 1,
      });
      const task = vi.fn().mockRejectedValue(new Error("too many requests from this IP"));

      await expect(limiter.execute(task)).rejects.toThrow();
      // concurrency must not exceed initial after a rate-limit event
      expect(limiter.currentConcurrency).toBeLessThanOrEqual(3);
    });

    it("does NOT change concurrency for non-rate-limit errors", async () => {
      const limiter = new AdaptiveRateLimiter({ initialConcurrency: 3 });
      const before = limiter.currentConcurrency;
      const task = vi.fn().mockRejectedValue(new Error("internal server error"));

      await expect(limiter.execute(task)).rejects.toThrow();

      expect(limiter.currentConcurrency).toBe(before);
    });
  });

  // ─── Ramp-up ───────────────────────────────────────────────────────────

  describe("ramp-up", () => {
    it("increases concurrency after successesBeforeRampUp consecutive successes", async () => {
      const limiter = new AdaptiveRateLimiter({
        initialConcurrency: 2,
        maxConcurrency: 6,
        successesBeforeRampUp: 3,
      });

      const task = vi.fn().mockResolvedValue(undefined);

      // 3 successes → one ramp-up step
      await limiter.execute(task);
      await limiter.execute(task);
      await limiter.execute(task);

      expect(limiter.currentConcurrency).toBe(3);
    });

    it("does not exceed maxConcurrency during ramp-up", async () => {
      const limiter = new AdaptiveRateLimiter({
        initialConcurrency: 6,
        maxConcurrency: 6,
        successesBeforeRampUp: 1,
      });

      const task = vi.fn().mockResolvedValue(undefined);

      // Many successes — should stay capped at max
      for (let i = 0; i < 20; i++) {
        await limiter.execute(task);
      }

      expect(limiter.currentConcurrency).toBe(6);
    });

    it("resets success streak after ramp-up", async () => {
      const limiter = new AdaptiveRateLimiter({
        initialConcurrency: 2,
        maxConcurrency: 6,
        successesBeforeRampUp: 3,
      });

      const task = vi.fn().mockResolvedValue(undefined);

      // First ramp-up at 3 successes
      await limiter.execute(task);
      await limiter.execute(task);
      await limiter.execute(task);
      expect(limiter.currentConcurrency).toBe(3);

      // Two more successes — not enough for another ramp-up yet
      await limiter.execute(task);
      await limiter.execute(task);
      expect(limiter.currentConcurrency).toBe(3);

      // Third success triggers second ramp-up
      await limiter.execute(task);
      expect(limiter.currentConcurrency).toBe(4);
    });
  });

  // ─── Ramp-down ─────────────────────────────────────────────────────────

  describe("ramp-down", () => {
    it("decreases concurrency after rateLimitsBeforeRampDown consecutive rate-limit errors", async () => {
      const limiter = new AdaptiveRateLimiter({
        initialConcurrency: 4,
        minConcurrency: 1,
        rateLimitsBeforeRampDown: 2,
      });

      const rlError = new Error("429 Too Many Requests");
      const task = vi.fn().mockRejectedValue(rlError);

      await expect(limiter.execute(task)).rejects.toThrow();
      expect(limiter.currentConcurrency).toBe(4); // not yet

      await expect(limiter.execute(task)).rejects.toThrow();
      expect(limiter.currentConcurrency).toBe(3); // ramp-down triggered
    });

    it("does not go below minConcurrency", async () => {
      const limiter = new AdaptiveRateLimiter({
        initialConcurrency: 1,
        minConcurrency: 1,
        rateLimitsBeforeRampDown: 1,
      });

      const rlError = new Error("429");
      const task = vi.fn().mockRejectedValue(rlError);

      for (let i = 0; i < 5; i++) {
        await expect(limiter.execute(task)).rejects.toThrow();
      }

      expect(limiter.currentConcurrency).toBe(1);
    });

    it("resets rate-limit streak after ramp-down", async () => {
      const limiter = new AdaptiveRateLimiter({
        initialConcurrency: 4,
        minConcurrency: 1,
        rateLimitsBeforeRampDown: 2,
      });

      const rlError = new Error("rate limit");
      const task = vi.fn().mockRejectedValue(rlError);

      // First ramp-down at 2 hits
      await expect(limiter.execute(task)).rejects.toThrow();
      await expect(limiter.execute(task)).rejects.toThrow();
      expect(limiter.currentConcurrency).toBe(3);

      // One more rate-limit — streak restarted, no ramp-down yet
      await expect(limiter.execute(task)).rejects.toThrow();
      expect(limiter.currentConcurrency).toBe(3);

      // Second consecutive hit triggers second ramp-down
      await expect(limiter.execute(task)).rejects.toThrow();
      expect(limiter.currentConcurrency).toBe(2);
    });

    it("resets success streak on rate-limit error", async () => {
      const limiter = new AdaptiveRateLimiter({
        initialConcurrency: 2,
        maxConcurrency: 6,
        successesBeforeRampUp: 3,
        rateLimitsBeforeRampDown: 999,
      });

      const successTask = vi.fn().mockResolvedValue(undefined);
      const rlTask = vi.fn().mockRejectedValue(new Error("429"));

      // 2 successes (1 away from ramp-up threshold)
      await limiter.execute(successTask);
      await limiter.execute(successTask);

      // Rate-limit resets the streak
      await expect(limiter.execute(rlTask)).rejects.toThrow();

      // 2 more successes — still not enough (streak restarted from 0)
      await limiter.execute(successTask);
      await limiter.execute(successTask);

      expect(limiter.currentConcurrency).toBe(2); // no ramp-up yet
    });
  });

  // ─── activeRequests ────────────────────────────────────────────────────

  describe("activeRequests getter", () => {
    it("returns 0 when idle", () => {
      const limiter = new AdaptiveRateLimiter();
      expect(limiter.activeRequests).toBe(0);
    });

    it("reflects the number of in-flight tasks", async () => {
      const limiter = new AdaptiveRateLimiter({ initialConcurrency: 3 });
      let observedActive = 0;

      const task = vi.fn().mockImplementation(async () => {
        observedActive = limiter.activeRequests;
        await Promise.resolve();
      });

      await limiter.execute(task);
      expect(observedActive).toBe(1);
    });

    it("returns to 0 after all tasks complete", async () => {
      const limiter = new AdaptiveRateLimiter({ initialConcurrency: 3 });
      const task = vi.fn().mockResolvedValue(undefined);

      await Promise.all([
        limiter.execute(task),
        limiter.execute(task),
        limiter.execute(task),
      ]);

      expect(limiter.activeRequests).toBe(0);
    });
  });
});

// ─── limitConcurrency ─────────────────────────────────────────────────────────

describe("limitConcurrency", () => {
  it("resolves with an empty array for zero tasks", async () => {
    const result = await limitConcurrency([], 5);
    expect(result).toEqual([]);
  });

  it("returns fulfilled results for all successful tasks", async () => {
    const tasks = [
      vi.fn().mockResolvedValue(1),
      vi.fn().mockResolvedValue(2),
      vi.fn().mockResolvedValue(3),
    ];

    const results = await limitConcurrency(tasks, 2);

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ status: "fulfilled", value: 1 });
    expect(results[1]).toEqual({ status: "fulfilled", value: 2 });
    expect(results[2]).toEqual({ status: "fulfilled", value: 3 });
  });

  it("returns rejected result for failing tasks without stopping others", async () => {
    const err = new Error("task 2 failed");
    const tasks = [
      vi.fn().mockResolvedValue("a"),
      vi.fn().mockRejectedValue(err),
      vi.fn().mockResolvedValue("c"),
    ];

    const results = await limitConcurrency(tasks, 2);

    expect(results[0]).toEqual({ status: "fulfilled", value: "a" });
    expect(results[1]).toMatchObject({ status: "rejected", reason: err });
    expect(results[2]).toEqual({ status: "fulfilled", value: "c" });
  });

  it("preserves result order regardless of completion order", async () => {
    // task[0] resolves after task[1]
    const tasks = [
      vi.fn().mockImplementation(
        () => new Promise<number>((r) => setTimeout(() => r(0), 10))
      ),
      vi.fn().mockResolvedValue(1),
      vi.fn().mockResolvedValue(2),
    ];

    const results = await limitConcurrency(tasks, 3);

    expect(results[0]).toEqual({ status: "fulfilled", value: 0 });
    expect(results[1]).toEqual({ status: "fulfilled", value: 1 });
    expect(results[2]).toEqual({ status: "fulfilled", value: 2 });
  });

  it("never exceeds the configured concurrency", async () => {
    let peak = 0;
    let active = 0;
    const concurrency = 2;

    const makeTask = () =>
      vi.fn().mockImplementation(async () => {
        active++;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active--;
      });

    const tasks = Array.from({ length: 8 }, makeTask);
    await limitConcurrency(tasks, concurrency);

    expect(peak).toBeLessThanOrEqual(concurrency);
  });

  it("runs a single task list with concurrency=1 sequentially", async () => {
    const order: number[] = [];
    const tasks = [0, 1, 2, 3].map((i) =>
      vi.fn().mockImplementation(async () => {
        order.push(i);
      })
    );

    await limitConcurrency(tasks, 1);

    expect(order).toEqual([0, 1, 2, 3]);
  });
});
