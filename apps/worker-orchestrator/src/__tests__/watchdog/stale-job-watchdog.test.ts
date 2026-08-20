import { vi, beforeEach, afterEach } from "vitest";
import { makeMockDb } from "../helpers.js";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@repo/db", () => ({
  contentJobs: "contentJobs_table",
  systemEvents: "systemEvents_table",
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((..._args: unknown[]) => "and_condition"),
  lt: vi.fn((_col: unknown, _val: unknown) => "lt_condition"),
  eq: vi.fn((_col: unknown, _val: unknown) => "eq_condition"),
}));

vi.mock("@repo/contracts", () => ({
  buildErrorDetail: vi.fn(
    (params: {
      code: string;
      message: string;
      category: string;
      retryable: boolean;
      context?: Record<string, unknown>;
    }) => ({
      ...params,
      timestamp: new Date().toISOString(),
    }),
  ),
}));

vi.mock("@repo/config", () => ({
  isTestAgentMode: vi.fn().mockReturnValue(false),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { startStaleJobWatchdog } from "../../watchdog/stale-job-watchdog.js";
import { buildErrorDetail } from "@repo/contracts";

// ─── Constants ────────────────────────────────────────────────────────────────

const NOW = new Date("2026-04-14T12:00:00.000Z");
const POLL_MS = 5 * 60 * 1000; // 5 minutes — must match the source constant

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal stale-job row matching the SELECT projection in runWatchdogCycle. */
function makeStaleJobRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    updated_at: new Date("2026-04-01T00:00:00.000Z"), // far in the past
    status_updated_at: new Date("2026-04-01T00:00:00.000Z"),
    state_machine_history: [
      {
        from_status: "IDEA_GENERATION",
        to_status: "SCRIPTING",
        timestamp: "2026-04-01T00:00:00.000Z",
        reason: "initial",
      },
    ],
    ...overrides,
  };
}

/**
 * Advances fake timers by exactly one poll interval so a single watchdog
 * cycle runs, then clears the interval.
 *
 * NOTE: vi.runAllTimersAsync() must NOT be used here — the setInterval fires
 * indefinitely and Vitest aborts after 10 000 ticks.
 */
async function runOneCycle(timer: NodeJS.Timeout): Promise<void> {
  await vi.advanceTimersByTimeAsync(POLL_MS);
  clearInterval(timer);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("startStaleJobWatchdog", () => {
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockDb = makeMockDb();
    // Default: every rule query returns no stale jobs
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── Return value ────────────────────────────────────────────────────

  it("returns a NodeJS.Timeout (interval handle)", () => {
    const timer = startStaleJobWatchdog(mockDb);
    expect(timer).toBeDefined();
    clearInterval(timer);
  });

  // ─── No stale jobs ────────────────────────────────────────────────────

  describe("when no jobs are stale", () => {
    it("does not call transaction when no stale jobs are found", async () => {
      mockDb.where.mockResolvedValue([]);
      const timer = startStaleJobWatchdog(mockDb);

      await runOneCycle(timer);

      expect(mockDb.transaction).not.toHaveBeenCalled();
    });
  });

  // ─── Single stale job ─────────────────────────────────────────────────

  describe("when a stale job is found (RENDERING_REMOTION rule)", () => {
    /** Returns the stale job for the first rule query, nothing thereafter. */
    function setupOneStalJob(): void {
      let callCount = 0;
      mockDb.where.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? [makeStaleJobRow()] : [];
      });
    }

    it("wraps the stale-job transition in a transaction", async () => {
      setupOneStalJob();
      const timer = startStaleJobWatchdog(mockDb);

      await runOneCycle(timer);

      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    });

    it("updates the job status to the rule's failedStatus inside the transaction", async () => {
      setupOneStalJob();
      const timer = startStaleJobWatchdog(mockDb);

      await runOneCycle(timer);

      expect(mockDb.update).toHaveBeenCalled();
      const setCalls = mockDb.set.mock.calls;
      const statusCall = setCalls.find(
        (args: any[]) =>
          typeof args[0]?.status === "string" &&
          args[0].status.startsWith("FAILED_"),
      );
      expect(statusCall).toBeDefined();
      expect(statusCall?.[0]?.status).toBe("FAILED_RENDER");
    });

    it("writes an error_message that mentions the stuck status", async () => {
      setupOneStalJob();
      const timer = startStaleJobWatchdog(mockDb);

      await runOneCycle(timer);

      const setCalls = mockDb.set.mock.calls;
      const msgCall = setCalls.find(
        (args: any[]) => typeof args[0]?.error_message === "string",
      );
      expect(msgCall).toBeDefined();
      expect(msgCall?.[0]?.error_message).toMatch(/RENDERING_REMOTION/);
    });

    it("appends a new history entry with the correct from/to statuses", async () => {
      setupOneStalJob();
      const timer = startStaleJobWatchdog(mockDb);

      await runOneCycle(timer);

      const setCalls = mockDb.set.mock.calls;
      const historyCall = setCalls.find((args: any[]) =>
        Array.isArray(args[0]?.state_machine_history),
      );
      expect(historyCall).toBeDefined();
      const history: any[] = historyCall?.[0]?.state_machine_history;
      // Original row has 1 entry; watchdog appends one more
      expect(history).toHaveLength(2);
      expect(history[1]).toMatchObject({
        from_status: "RENDERING_REMOTION",
        to_status: "FAILED_RENDER",
      });
    });

    it("inserts a job_status_changed system event with correct payload", async () => {
      setupOneStalJob();
      const timer = startStaleJobWatchdog(mockDb);

      await runOneCycle(timer);

      const valuesCalls = mockDb.values.mock.calls;
      const statusEvent = valuesCalls.find(
        (args: any[]) => args[0]?.event_type === "job_status_changed",
      );
      expect(statusEvent).toBeDefined();
      expect(statusEvent?.[0]).toMatchObject({
        event_type: "job_status_changed",
        job_id: "00000000-0000-0000-0000-000000000001",
        payload: expect.objectContaining({
          from_status: "RENDERING_REMOTION",
          to_status: "FAILED_RENDER",
        }),
      });
    });

    it("inserts a watchdog_triggered system event with correct payload", async () => {
      setupOneStalJob();
      const timer = startStaleJobWatchdog(mockDb);

      await runOneCycle(timer);

      const valuesCalls = mockDb.values.mock.calls;
      const watchdogEvent = valuesCalls.find(
        (args: any[]) => args[0]?.event_type === "watchdog_triggered",
      );
      expect(watchdogEvent).toBeDefined();
      expect(watchdogEvent?.[0]).toMatchObject({
        event_type: "watchdog_triggered",
        job_id: "00000000-0000-0000-0000-000000000001",
        payload: expect.objectContaining({
          from_status: "RENDERING_REMOTION",
          to_status: "FAILED_RENDER",
        }),
      });
    });

    it("calls buildErrorDetail with WATCHDOG_TIMEOUT code and orchestration category", async () => {
      setupOneStalJob();
      const timer = startStaleJobWatchdog(mockDb);

      await runOneCycle(timer);

      expect(buildErrorDetail).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "WATCHDOG_TIMEOUT",
          category: "orchestration",
          retryable: false,
        }),
      );
    });
  });

  // ─── Multiple stale jobs ──────────────────────────────────────────────

  describe("when multiple stale jobs exist under a single rule", () => {
    it("processes each stale job in its own separate transaction", async () => {
      const jobA = makeStaleJobRow({
        id: "00000000-0000-0000-0000-00000000000a",
      });
      const jobB = makeStaleJobRow({
        id: "00000000-0000-0000-0000-00000000000b",
      });

      let callCount = 0;
      mockDb.where.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? [jobA, jobB] : [];
      });

      const timer = startStaleJobWatchdog(mockDb);
      await runOneCycle(timer);

      expect(mockDb.transaction).toHaveBeenCalledTimes(2);
    });
  });

  // ─── Time-based polling ───────────────────────────────────────────────

  describe("polling interval", () => {
    it("does NOT call the DB before the first 5-minute interval elapses", async () => {
      mockDb.where.mockResolvedValue([]);

      const timer = startStaleJobWatchdog(mockDb);

      // Advance less than the full interval
      await vi.advanceTimersByTimeAsync(POLL_MS - 1);
      expect(mockDb.select).not.toHaveBeenCalled();

      clearInterval(timer);
    });

    it("calls the DB after exactly one 5-minute interval", async () => {
      mockDb.where.mockResolvedValue([]);

      const timer = startStaleJobWatchdog(mockDb);
      await vi.advanceTimersByTimeAsync(POLL_MS);

      expect(mockDb.select).toHaveBeenCalled();

      clearInterval(timer);
    });

    it("runs a second cycle after 10 minutes total (two intervals)", async () => {
      mockDb.where.mockResolvedValue([]);

      const timer = startStaleJobWatchdog(mockDb);

      await vi.advanceTimersByTimeAsync(POLL_MS);
      const countAfterFirst = mockDb.select.mock.calls.length;

      await vi.advanceTimersByTimeAsync(POLL_MS);
      const countAfterSecond = mockDb.select.mock.calls.length;

      expect(countAfterSecond).toBeGreaterThan(countAfterFirst);

      clearInterval(timer);
    });
  });

  // ─── Error resilience ─────────────────────────────────────────────────

  describe("error resilience", () => {
    it("continues to the next stale job when one transaction throws", async () => {
      const jobA = makeStaleJobRow({
        id: "00000000-0000-0000-0000-00000000000a",
      });
      const jobB = makeStaleJobRow({
        id: "00000000-0000-0000-0000-00000000000b",
      });

      let callCount = 0;
      mockDb.where.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? [jobA, jobB] : [];
      });

      let txCall = 0;
      mockDb.transaction.mockImplementation(async (fn: (tx: any) => any) => {
        txCall++;
        if (txCall === 1) throw new Error("DB constraint violation");
        return fn(mockDb);
      });

      const timer = startStaleJobWatchdog(mockDb);
      // advanceTimersByTimeAsync must resolve — the watchdog swallows per-job errors
      await vi.advanceTimersByTimeAsync(POLL_MS);
      clearInterval(timer);

      // Both jobs were attempted; second one succeeded
      expect(mockDb.transaction).toHaveBeenCalledTimes(2);
    });

    it("does not propagate a full cycle error to the caller", async () => {
      // The entire DB query blows up — should not escape the watchdog
      mockDb.where.mockRejectedValue(new Error("connection lost"));

      const timer = startStaleJobWatchdog(mockDb);
      // Must resolve, not reject
      await vi.advanceTimersByTimeAsync(POLL_MS);
      clearInterval(timer);

      // Verify the cycle was attempted (select was called) despite the error
      expect(mockDb.select).toHaveBeenCalled();
    });
  });
});
