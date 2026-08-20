import { eq } from "drizzle-orm";
import { transitionJob, isFailureState } from "@repo/domain";
import type { JobStatus as JobStatusType, ErrorDetail } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { contentJobs, systemEvents } from "@repo/db";
import {
  isTerminalState,
  fireTerminalStateWebhook,
} from "./terminal-state-webhook.js";
import { notifyAios } from "./aios-notify.js";

/**
 * `isFailureState` is typed against the domain's JobStatus union, which is
 * NARROWER than both the DB enum (still carries TRANSLATING) and the contracts
 * union (carries the SPACE and DRAMA pipeline states). Same superset problem
 * `transitionJob` casts around below. A status the domain has never heard of is
 * by definition not one of its failure states, so `false` is the right answer.
 */
type DomainJobStatus = Parameters<typeof isFailureState>[0];
const isFailure = (status: string): boolean =>
  isFailureState(status as DomainJobStatus);

/**
 * Update Job Status Utility
 *
 * Validates state transition via @repo/domain, updates database,
 * and writes system event for SSE propagation.
 *
 * This is the ONLY way status updates should happen - ensures all
 * transitions are validated and all state changes are observable.
 *
 * @param db - Drizzle client
 * @param jobId - Job ID to update
 * @param targetStatus - Target status
 * @param errorMessage - Optional error message (for failure states)
 * @param errorDetail - Optional structured error detail (for app-level errors)
 * @param errorMetadata - Optional raw error metadata (for dead letter queue)
 * @returns Updated job record
 * @throws {Error} If transition is invalid or database operation fails
 */
export async function updateJobStatus(
  db: DrizzleClient,
  jobId: string,
  targetStatus: JobStatusType,
  errorMessage?: string,
  errorDetail?: ErrorDetail,
  errorMetadata?: Record<string, unknown>,
) {
  // 1. Fetch current job state
  const [job] = await db
    .select()
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);

  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  // 2. Validate transition via domain layer
  // Cast job.status — DB enum is a superset of the app-level JobStatus type
  // (e.g. TRANSLATING exists in PostgreSQL enum but is removed from the app state machine)
  const transitionResult = transitionJob(
    job.status as JobStatusType,
    targetStatus,
    job.paused_from_status as JobStatusType | null,
  );

  if (!transitionResult.success) {
    // ── The FAILED_GENERAL trap ────────────────────────────────────────────
    //
    // Every failure state is a dead end in TRANSITION_MAP: FAILED_GENERAL only
    // permits IDEA_GENERATION and MARKED_FOR_DELETION, and no failure state
    // permits itself. But failure writes come from `catch` blocks that then
    // rethrow, so BullMQ retries the job, the retry fails again, and the
    // handler calls us a second time with the SAME failure status.
    //
    // That second call used to throw "Invalid transition from FAILED_GENERAL
    // to FAILED_GENERAL" — from inside the caller's catch block. Three things
    // went wrong at once: the real second error was never persisted, the
    // transition error REPLACED it as the job's visible failure, and the job
    // looked like a state-machine bug rather than (say) a dead LLM provider.
    // This affects every format, not just RANKING.
    //
    // So: an invalid transition BETWEEN TWO FAILURE STATES is not a bug, it is
    // a job that has already failed. Record the additional error and return
    // cleanly. Anything else is still a genuine state-machine violation and
    // still throws.
    //
    // Keyed on the transition being invalid rather than on "both are failure
    // states", because one legal failure→failure edge exists
    // (TECH_FOOTAGE_FAILED → FAILED_GENERAL) and it must keep working.
    if (isFailure(job.status) && isFailure(targetStatus)) {
      const priorMeta =
        job.error_metadata &&
        typeof job.error_metadata === "object" &&
        !Array.isArray(job.error_metadata)
          ? (job.error_metadata as Record<string, unknown>)
          : {};
      const prior = Array.isArray(priorMeta["subsequent_failures"])
        ? (priorMeta["subsequent_failures"] as unknown[])
        : [];
      // Keep the ORIGINAL error_message: it is the root failure. Subsequent
      // attempts accumulate beside it so nothing is lost either way. Bounded
      // so a job retried forever cannot grow the row without limit.
      const subsequent = [
        ...prior,
        {
          attempted_status: targetStatus,
          error_message: errorMessage?.substring(0, 2000) ?? null,
          error_code: errorDetail?.code ?? null,
          at: new Date().toISOString(),
        },
      ].slice(-20);

      await db
        .update(contentJobs)
        .set({
          error_metadata: {
            ...priorMeta,
            subsequent_failures: subsequent,
          } as Record<string, unknown>,
          updated_at: new Date(),
        })
        .where(eq(contentJobs.id, jobId));

      console.warn(
        JSON.stringify({
          level: "warn",
          message:
            "Job already in a failure state; recorded repeat failure without transitioning",
          job_id: jobId,
          current_status: job.status,
          attempted_status: targetStatus,
          repeat_failure_count: subsequent.length,
          error: errorMessage ?? null,
        }),
      );

      return job;
    }

    throw new Error(
      `Invalid transition from ${job.status} to ${targetStatus}: ${transitionResult.error.message}`,
    );
  }

  // 3. Truncate error message to avoid PostgreSQL btree index size limit (2704 bytes)
  const truncatedErrorMessage = errorMessage
    ? errorMessage.substring(0, 2000)
    : undefined;

  // 4. Build state machine history entry
  const historyEntry = {
    from_status: job.status,
    to_status: targetStatus,
    timestamp: new Date().toISOString(),
    reason: truncatedErrorMessage,
  };

  const updatedHistory = [
    ...(job.state_machine_history as Array<typeof historyEntry>),
    historyEntry,
  ];

  // 5 & 6. Update job and write system event in transaction
  //
  // When the TARGET is a failure state we are, by construction, running inside
  // someone's catch block, and their original error is the valuable one. If
  // this write itself fails (DB blip, constraint, serialization error) throwing
  // would destroy that diagnosis and replace it with a storage error. So a
  // failure-status write logs BOTH loudly and returns the unchanged job; the
  // caller's `throw error` then carries the real cause up to BullMQ.
  //
  // Non-failure writes still throw: a broken write on the happy path is a real
  // bug and must not be swallowed.
  try {
    return await writeStatus();
  } catch (writeError) {
    if (!isFailure(targetStatus)) throw writeError;
    console.error(
      JSON.stringify({
        level: "error",
        message:
          "Failed to persist failure status; preserving the original error for the caller",
        job_id: jobId,
        from_status: job.status,
        attempted_status: targetStatus,
        status_write_error:
          writeError instanceof Error ? writeError.message : String(writeError),
        original_error: errorMessage ?? null,
      }),
    );
    return job;
  }

  async function writeStatus() {
    return await db.transaction(async (tx) => {
      // 5. Update job in database
      const [updatedJob] = await tx
        .update(contentJobs)
        .set({
          status: targetStatus,
          status_updated_at: new Date(),
          state_machine_history: updatedHistory,
          error_message: truncatedErrorMessage || job.error_message,
          error_detail: errorDetail ?? job.error_detail,
          error_metadata: errorMetadata ?? job.error_metadata,
          updated_at: new Date(),
        })
        .where(eq(contentJobs.id, jobId))
        .returning();

      if (!updatedJob) {
        throw new Error(`Failed to update job ${jobId}`);
      }

      // 6. Write system event for SSE
      await tx.insert(systemEvents).values({
        event_type: "job_status_changed",
        job_id: jobId,
        payload: {
          from_status: job.status,
          to_status: targetStatus,
          error_message: truncatedErrorMessage,
          error_detail: errorDetail,
        },
      });

      console.log(
        JSON.stringify({
          level: "info",
          message: "Job status updated",
          job_id: jobId,
          from_status: job.status,
          to_status: targetStatus,
          timestamp: new Date().toISOString(),
        }),
      );

      // Fire-and-forget webhook on terminal transitions. Awaiting QC,
      // ready to upload, or any failure — the human running overnight
      // runs gets notified. Errors are swallowed so a flaky webhook
      // never wedges the pipeline.
      if (isTerminalState(targetStatus) && !isTerminalState(job.status)) {
        fireTerminalStateWebhook({
          job_id: jobId,
          from_status: job.status,
          to_status: targetStatus,
          format: updatedJob.format,
          title: updatedJob.title,
          error_message: truncatedErrorMessage,
          timestamp: new Date().toISOString(),
        }).catch(() => {});
      }

      // Push every state change onto HCP's agent_message bus so Hermes
      // Workspace sees CF activity live. Fire-and-forget; HCP being down
      // never wedges CF.
      notifyAios({
        jobId,
        fromStatus: job.status,
        toStatus: targetStatus,
        format: updatedJob.format,
        title: updatedJob.title,
        errorMessage: truncatedErrorMessage ?? null,
      });

      return updatedJob;
    });
  }
}
