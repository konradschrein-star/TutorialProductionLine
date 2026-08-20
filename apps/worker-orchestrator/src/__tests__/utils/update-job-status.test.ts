import { vi, beforeEach } from "vitest";
import { makeMockDb, makeDbJob } from "../helpers.js";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@repo/db", () => ({
  contentJobs: "contentJobs_table",
  systemEvents: "systemEvents_table",
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => "eq_condition"),
}));

// Partial mock: ONLY transitionJob is faked. `isFailureState` must stay real,
// because the already-failed guard's whole correctness argument rests on the
// domain's actual FAILURE_STATES list — a hand-copied list in a mock would let
// the two drift and quietly re-open the FAILED_GENERAL trap.
vi.mock("@repo/domain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/domain")>();
  return { ...actual, transitionJob: vi.fn() };
});

// ─── Import after mocks ───────────────────────────────────────────────────────

import { updateJobStatus } from "../../utils/update-job-status.js";
import { transitionJob } from "@repo/domain";

// TransitionError is imported directly from the class source to avoid the mocked @repo/domain.
// The mocked transitionJob returns it as the error value — the test just needs an Error instance
// that carries the right message shape.
class FakeTransitionError extends Error {
  constructor(
    public fromStatus: string,
    public toStatus: string,
    reason: string,
  ) {
    super(`Illegal transition from ${fromStatus} to ${toStatus}: ${reason}`);
    this.name = "TransitionError";
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const JOB_ID = "00000000-0000-0000-0000-000000000001";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("updateJobStatus", () => {
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = makeMockDb();

    // Default: valid transition
    vi.mocked(transitionJob).mockReturnValue({
      success: true,
      value: "ASSET_COLLECTION" as any,
    });
  });

  // ─── Happy path ──────────────────────────────────────────────────────────

  describe("successful transition", () => {
    it("fetches the job from DB before updating", async () => {
      const job = makeDbJob({ status: "SCRIPTING" });
      const updatedJob = makeDbJob({ status: "ASSET_COLLECTION" });
      mockDb.limit.mockResolvedValue([job]);
      mockDb.returning.mockResolvedValue([updatedJob]);

      await updateJobStatus(mockDb, JOB_ID, "ASSET_COLLECTION");

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.from).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
      expect(mockDb.limit).toHaveBeenCalled();
    });

    it("calls transitionJob with the correct current and target status", async () => {
      const job = makeDbJob({ status: "SCRIPTING" });
      const updatedJob = makeDbJob({ status: "ASSET_COLLECTION" });
      mockDb.limit.mockResolvedValue([job]);
      mockDb.returning.mockResolvedValue([updatedJob]);

      await updateJobStatus(mockDb, JOB_ID, "ASSET_COLLECTION");

      expect(transitionJob).toHaveBeenCalledWith(
        "SCRIPTING",
        "ASSET_COLLECTION",
        null,
      );
    });

    it("calls transitionJob with paused_from_status when present", async () => {
      const job = makeDbJob({
        status: "PAUSED",
        paused_from_status: "SCRIPTING",
      });
      const updatedJob = makeDbJob({ status: "SCRIPTING" });
      mockDb.limit.mockResolvedValue([job]);
      mockDb.returning.mockResolvedValue([updatedJob]);
      vi.mocked(transitionJob).mockReturnValue({
        success: true,
        value: "SCRIPTING" as any,
      });

      await updateJobStatus(mockDb, JOB_ID, "SCRIPTING");

      expect(transitionJob).toHaveBeenCalledWith(
        "PAUSED",
        "SCRIPTING",
        "SCRIPTING",
      );
    });

    it("updates job status in DB within a transaction", async () => {
      const job = makeDbJob({ status: "SCRIPTING" });
      const updatedJob = makeDbJob({ status: "ASSET_COLLECTION" });
      mockDb.limit.mockResolvedValue([job]);
      mockDb.returning.mockResolvedValue([updatedJob]);

      await updateJobStatus(mockDb, JOB_ID, "ASSET_COLLECTION");

      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    });

    it("writes a system_event inside the transaction", async () => {
      const job = makeDbJob({ status: "SCRIPTING" });
      const updatedJob = makeDbJob({ status: "ASSET_COLLECTION" });
      mockDb.limit.mockResolvedValue([job]);
      mockDb.returning.mockResolvedValue([updatedJob]);

      await updateJobStatus(mockDb, JOB_ID, "ASSET_COLLECTION");

      // insert() is called for systemEvents inside the transaction
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalled();
    });

    it("appends a new entry to state_machine_history", async () => {
      const existingHistory = [
        {
          from_status: "IDEA_GENERATION",
          to_status: "SCRIPTING",
          timestamp: "2026-04-01T00:00:00.000Z",
        },
      ];
      const job = makeDbJob({
        status: "SCRIPTING",
        state_machine_history: existingHistory,
      });
      const updatedJob = makeDbJob({ status: "ASSET_COLLECTION" });
      mockDb.limit.mockResolvedValue([job]);
      mockDb.returning.mockResolvedValue([updatedJob]);

      await updateJobStatus(mockDb, JOB_ID, "ASSET_COLLECTION");

      // The set() call inside the transaction should include a history with 2 entries
      const setCalls = mockDb.set.mock.calls;
      const historySetCall = setCalls.find((args: any[]) =>
        Array.isArray(args[0]?.state_machine_history),
      );
      expect(historySetCall).toBeDefined();
      const history: any[] = historySetCall?.[0]?.state_machine_history;
      expect(history).toHaveLength(2);
      expect(history[1]).toMatchObject({
        from_status: "SCRIPTING",
        to_status: "ASSET_COLLECTION",
      });
    });

    it("sets the target status on the updated job row", async () => {
      const job = makeDbJob({ status: "SCRIPTING" });
      const updatedJob = makeDbJob({ status: "ASSET_COLLECTION" });
      mockDb.limit.mockResolvedValue([job]);
      mockDb.returning.mockResolvedValue([updatedJob]);

      await updateJobStatus(mockDb, JOB_ID, "ASSET_COLLECTION");

      const setCalls = mockDb.set.mock.calls;
      const statusSetCall = setCalls.find(
        (args: any[]) => args[0]?.status === "ASSET_COLLECTION",
      );
      expect(statusSetCall).toBeDefined();
    });

    it("returns the updated job row", async () => {
      const job = makeDbJob({ status: "SCRIPTING" });
      const updatedJob = makeDbJob({ status: "ASSET_COLLECTION" });
      mockDb.limit.mockResolvedValue([job]);
      mockDb.returning.mockResolvedValue([updatedJob]);

      const result = await updateJobStatus(mockDb, JOB_ID, "ASSET_COLLECTION");

      expect(result).toEqual(updatedJob);
    });
  });

  // ─── Error cases ─────────────────────────────────────────────────────────

  describe("error cases", () => {
    it("throws when job is not found in DB", async () => {
      mockDb.limit.mockResolvedValue([]); // no rows

      await expect(
        updateJobStatus(mockDb, JOB_ID, "ASSET_COLLECTION"),
      ).rejects.toThrow(`Job ${JOB_ID} not found`);
    });

    it("throws when the domain transition is invalid", async () => {
      const job = makeDbJob({ status: "SCRIPTING" });
      mockDb.limit.mockResolvedValue([job]);
      vi.mocked(transitionJob).mockReturnValue({
        success: false,
        error: new FakeTransitionError(
          "SCRIPTING",
          "PUBLISHED",
          "Transition not allowed",
        ),
      });

      await expect(
        updateJobStatus(mockDb, JOB_ID, "PUBLISHED"),
      ).rejects.toThrow("Invalid transition from SCRIPTING to PUBLISHED");
    });

    it("does NOT call transaction when transition is invalid", async () => {
      const job = makeDbJob({ status: "SCRIPTING" });
      mockDb.limit.mockResolvedValue([job]);
      vi.mocked(transitionJob).mockReturnValue({
        success: false,
        error: new FakeTransitionError(
          "SCRIPTING",
          "PUBLISHED",
          "Transition not allowed",
        ),
      });

      await expect(
        updateJobStatus(mockDb, JOB_ID, "PUBLISHED"),
      ).rejects.toThrow();

      expect(mockDb.transaction).not.toHaveBeenCalled();
    });
  });

  // ─── The FAILED_GENERAL trap ─────────────────────────────────────────────

  /**
   * A processor fails, writes FAILED_GENERAL, and rethrows. BullMQ retries.
   * The retry fails again and writes FAILED_GENERAL a second time — but no
   * failure state permits itself, so the write used to throw "Invalid
   * transition from FAILED_GENERAL to FAILED_GENERAL" from inside the
   * caller's catch block. The genuine second error was lost and the job
   * looked like a state-machine bug. Affects every format.
   */
  describe("already-failed jobs record the repeat instead of throwing", () => {
    const invalidSelfTransition = (status: string) =>
      vi.mocked(transitionJob).mockReturnValue({
        success: false,
        error: new FakeTransitionError(
          status,
          status,
          "Transition not allowed",
        ),
      } as any);

    it("does not throw when a failed job fails again", async () => {
      const job = makeDbJob({ status: "FAILED_GENERAL" });
      mockDb.limit.mockResolvedValue([job]);
      invalidSelfTransition("FAILED_GENERAL");

      await expect(
        updateJobStatus(
          mockDb,
          JOB_ID,
          "FAILED_GENERAL",
          "deepseek returned 401",
        ),
      ).resolves.toBeDefined();
    });

    it("persists the repeat failure instead of discarding it", async () => {
      const job = makeDbJob({ status: "FAILED_GENERAL" });
      mockDb.limit.mockResolvedValue([job]);
      invalidSelfTransition("FAILED_GENERAL");

      await updateJobStatus(
        mockDb,
        JOB_ID,
        "FAILED_GENERAL",
        "deepseek returned 401",
      );

      const metaCall = mockDb.set.mock.calls.find(
        (args: any[]) => args[0]?.error_metadata?.subsequent_failures,
      );
      expect(metaCall).toBeDefined();
      const recorded = metaCall?.[0]?.error_metadata?.subsequent_failures;
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        attempted_status: "FAILED_GENERAL",
        error_message: "deepseek returned 401",
      });
    });

    it("keeps the ORIGINAL error_message as the root cause", async () => {
      const job = makeDbJob({ status: "FAILED_GENERAL" });
      mockDb.limit.mockResolvedValue([job]);
      invalidSelfTransition("FAILED_GENERAL");

      await updateJobStatus(mockDb, JOB_ID, "FAILED_GENERAL", "second error");

      // The guard writes only error_metadata — it must never overwrite the
      // first failure's message with a downstream symptom.
      const setCalls = mockDb.set.mock.calls;
      expect(
        setCalls.some((args: any[]) => args[0]?.error_message !== undefined),
      ).toBe(false);
    });

    it("accumulates repeats and caps them at 20", async () => {
      const prior = Array.from({ length: 25 }, (_, i) => ({
        attempted_status: "FAILED_GENERAL",
        error_message: `attempt ${i}`,
      }));
      const job = makeDbJob({
        status: "FAILED_GENERAL",
        error_metadata: { subsequent_failures: prior },
      });
      mockDb.limit.mockResolvedValue([job]);
      invalidSelfTransition("FAILED_GENERAL");

      await updateJobStatus(mockDb, JOB_ID, "FAILED_GENERAL", "newest");

      const metaCall = mockDb.set.mock.calls.find(
        (args: any[]) => args[0]?.error_metadata?.subsequent_failures,
      );
      const recorded = metaCall?.[0]?.error_metadata?.subsequent_failures;
      expect(recorded).toHaveLength(20);
      // Newest kept, oldest dropped.
      expect(recorded[19]).toMatchObject({ error_message: "newest" });
    });

    it("does NOT transition the job", async () => {
      const job = makeDbJob({ status: "FAILED_RENDER" });
      mockDb.limit.mockResolvedValue([job]);
      invalidSelfTransition("FAILED_RENDER");

      await updateJobStatus(mockDb, JOB_ID, "FAILED_RENDER", "again");

      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it("still throws for a genuine state-machine violation", async () => {
      // SCRIPTING → PUBLISHED is not a failure-to-failure write; it is a real
      // bug and must keep surfacing.
      const job = makeDbJob({ status: "SCRIPTING" });
      mockDb.limit.mockResolvedValue([job]);
      vi.mocked(transitionJob).mockReturnValue({
        success: false,
        error: new FakeTransitionError("SCRIPTING", "PUBLISHED", "nope"),
      } as any);

      await expect(
        updateJobStatus(mockDb, JOB_ID, "PUBLISHED"),
      ).rejects.toThrow("Invalid transition from SCRIPTING to PUBLISHED");
    });

    it("still throws when a NON-failure target is invalid from a failed state", async () => {
      // FAILED_GENERAL → ASSET_COLLECTION is genuinely illegal and is not the
      // retry-storm case; it must not be silently swallowed.
      const job = makeDbJob({ status: "FAILED_GENERAL" });
      mockDb.limit.mockResolvedValue([job]);
      vi.mocked(transitionJob).mockReturnValue({
        success: false,
        error: new FakeTransitionError(
          "FAILED_GENERAL",
          "ASSET_COLLECTION",
          "nope",
        ),
      } as any);

      await expect(
        updateJobStatus(mockDb, JOB_ID, "ASSET_COLLECTION"),
      ).rejects.toThrow("Invalid transition");
    });
  });

  // ─── A failed status write must not mask the caller's error ──────────────

  describe("failure-status write errors never replace the original error", () => {
    it("returns the job instead of throwing when the DB write fails", async () => {
      const job = makeDbJob({ status: "SCRIPTING" });
      mockDb.limit.mockResolvedValue([job]);
      vi.mocked(transitionJob).mockReturnValue({
        success: true,
        value: "FAILED_GENERAL" as any,
      });
      mockDb.transaction.mockRejectedValue(new Error("deadlock detected"));

      // Callers do `await updateJobStatus(...FAILED...); throw error;` — if
      // this rejected, the storage error would replace their real diagnosis.
      const result = await updateJobStatus(
        mockDb,
        JOB_ID,
        "FAILED_GENERAL",
        "the real cause",
      );
      expect(result).toEqual(job);
    });

    it("still throws when a NON-failure write fails", async () => {
      const job = makeDbJob({ status: "SCRIPTING" });
      mockDb.limit.mockResolvedValue([job]);
      vi.mocked(transitionJob).mockReturnValue({
        success: true,
        value: "ASSET_COLLECTION" as any,
      });
      mockDb.transaction.mockRejectedValue(new Error("deadlock detected"));

      await expect(
        updateJobStatus(mockDb, JOB_ID, "ASSET_COLLECTION"),
      ).rejects.toThrow("deadlock detected");
    });
  });

  // ─── Error message truncation ────────────────────────────────────────────

  describe("error message truncation", () => {
    it("truncates error messages longer than 2000 chars", async () => {
      const longMessage = "x".repeat(3000);
      const job = makeDbJob({ status: "SCRIPTING" });
      const updatedJob = makeDbJob({ status: "FAILED_QMS" });
      mockDb.limit.mockResolvedValue([job]);
      mockDb.returning.mockResolvedValue([updatedJob]);
      vi.mocked(transitionJob).mockReturnValue({
        success: true,
        value: "FAILED_QMS" as any,
      });

      await updateJobStatus(mockDb, JOB_ID, "FAILED_QMS", longMessage);

      const setCalls = mockDb.set.mock.calls;
      const errorSetCall = setCalls.find(
        (args: any[]) => args[0]?.error_message !== undefined,
      );
      const storedMessage: string = errorSetCall?.[0]?.error_message;
      expect(storedMessage).toBeDefined();
      expect(storedMessage.length).toBeLessThanOrEqual(2000);
    });

    it("stores error messages at exactly 2000 chars without truncation", async () => {
      const exactMessage = "e".repeat(2000);
      const job = makeDbJob({ status: "SCRIPTING" });
      const updatedJob = makeDbJob({ status: "FAILED_QMS" });
      mockDb.limit.mockResolvedValue([job]);
      mockDb.returning.mockResolvedValue([updatedJob]);
      vi.mocked(transitionJob).mockReturnValue({
        success: true,
        value: "FAILED_QMS" as any,
      });

      await updateJobStatus(mockDb, JOB_ID, "FAILED_QMS", exactMessage);

      const setCalls = mockDb.set.mock.calls;
      const errorSetCall = setCalls.find(
        (args: any[]) => args[0]?.error_message !== undefined,
      );
      expect(errorSetCall?.[0]?.error_message).toBe(exactMessage);
    });

    it("stores undefined error_message when none is provided", async () => {
      const job = makeDbJob({ status: "SCRIPTING" });
      const updatedJob = makeDbJob({ status: "ASSET_COLLECTION" });
      mockDb.limit.mockResolvedValue([job]);
      mockDb.returning.mockResolvedValue([updatedJob]);

      await updateJobStatus(mockDb, JOB_ID, "ASSET_COLLECTION");

      const setCalls = mockDb.set.mock.calls;
      const statusSetCall = setCalls.find(
        (args: any[]) => args[0]?.status === "ASSET_COLLECTION",
      );
      // truncatedErrorMessage is undefined → falls back to existing job.error_message (null)
      expect(statusSetCall?.[0]?.error_message).toBeNull();
    });
  });

  // ─── error_detail ────────────────────────────────────────────────────────

  describe("error_detail", () => {
    it("stores errorDetail when provided", async () => {
      const job = makeDbJob({ status: "SCRIPTING" });
      const updatedJob = makeDbJob({ status: "FAILED_QMS" });
      mockDb.limit.mockResolvedValue([job]);
      mockDb.returning.mockResolvedValue([updatedJob]);
      vi.mocked(transitionJob).mockReturnValue({
        success: true,
        value: "FAILED_QMS" as any,
      });

      const errorDetail = {
        code: "QMS_VALIDATION_FAILED",
        message: "Asset missing",
        category: "media_validation" as const,
        retryable: false,
        timestamp: new Date().toISOString(),
      };

      await updateJobStatus(
        mockDb,
        JOB_ID,
        "FAILED_QMS",
        "Asset missing",
        errorDetail,
      );

      const setCalls = mockDb.set.mock.calls;
      const detailSetCall = setCalls.find(
        (args: any[]) => args[0]?.error_detail !== undefined,
      );
      expect(detailSetCall?.[0]?.error_detail).toEqual(errorDetail);
    });

    it("falls back to existing job error_detail when none is provided", async () => {
      const existingDetail = {
        code: "PREVIOUS_ERROR",
        message: "Previous failure",
        category: "unknown" as const,
        retryable: false,
        timestamp: "2026-04-01T00:00:00.000Z",
      };
      const job = makeDbJob({
        status: "SCRIPTING",
        error_detail: existingDetail,
      });
      const updatedJob = makeDbJob({ status: "ASSET_COLLECTION" });
      mockDb.limit.mockResolvedValue([job]);
      mockDb.returning.mockResolvedValue([updatedJob]);

      await updateJobStatus(mockDb, JOB_ID, "ASSET_COLLECTION");

      const setCalls = mockDb.set.mock.calls;
      const detailSetCall = setCalls.find(
        (args: any[]) => args[0]?.error_detail !== undefined,
      );
      expect(detailSetCall?.[0]?.error_detail).toEqual(existingDetail);
    });
  });

  // ─── system event payload ────────────────────────────────────────────────

  describe("system event", () => {
    it("writes a system event with from/to status in the payload", async () => {
      const job = makeDbJob({ status: "SCRIPTING" });
      const updatedJob = makeDbJob({ status: "ASSET_COLLECTION" });
      mockDb.limit.mockResolvedValue([job]);
      mockDb.returning.mockResolvedValue([updatedJob]);

      await updateJobStatus(mockDb, JOB_ID, "ASSET_COLLECTION");

      // The systemEvents insert values call
      const insertValuesCalls = mockDb.values.mock.calls;
      const eventInsertCall = insertValuesCalls.find(
        (args: any[]) => args[0]?.event_type === "job_status_changed",
      );
      expect(eventInsertCall).toBeDefined();
      expect(eventInsertCall?.[0]).toMatchObject({
        event_type: "job_status_changed",
        job_id: JOB_ID,
        payload: expect.objectContaining({
          from_status: "SCRIPTING",
          to_status: "ASSET_COLLECTION",
        }),
      });
    });
  });
});
