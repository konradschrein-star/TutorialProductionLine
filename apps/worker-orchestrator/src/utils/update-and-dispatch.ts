import type { DrizzleClient } from "@repo/db";
import type { JobStatus as JobStatusType } from "@repo/contracts";
import type { Queue } from "bullmq";
import { updateJobStatus } from "./update-job-status.js";
import { dispatchNext } from "./dispatch-next.js";

/**
 * Update Job Status and Dispatch Next
 *
 * Combines status update and queue dispatch into a single call.
 * If dispatch fails after status update, attempts to revert the status
 * to prevent jobs from getting stuck.
 *
 * @param db - Drizzle client
 * @param jobId - Job ID to update
 * @param targetStatus - Target status
 * @param queues - Queue instances for dispatch routing
 * @param errorMessage - Optional error message (for failure states)
 * @returns Updated job record and queue name dispatched to
 * @throws {Error} If status update fails, or if dispatch fails (after rollback attempt)
 */
export async function updateJobStatusAndDispatch(
  db: DrizzleClient,
  jobId: string,
  targetStatus: JobStatusType,
  queues: {
    aiGeneration?: Queue;
    qmsValidation?: Queue;
    renderHeavy?: Queue;
    assetCollection?: Queue;
    autoLabel?: Queue;
    clipSelection?: Queue;
  },
  errorMessage?: string,
): Promise<{ updatedJob: any; dispatchedTo: string | null }> {
  // 1. Update status in database (validated, transactional)
  const updatedJob = await updateJobStatus(
    db,
    jobId,
    targetStatus,
    errorMessage,
  );

  // 2. Dispatch to next queue
  try {
    const dispatchedTo = await dispatchNext(db, jobId, targetStatus, queues);
    return { updatedJob, dispatchedTo };
  } catch (dispatchError) {
    // Dispatch failed — attempt to revert status to prevent stuck job
    const history = updatedJob.state_machine_history as Array<{
      from_status: string;
      to_status: string;
      timestamp: string;
      reason?: string;
    }>;
    const previousStatus = history?.at(-1)?.from_status;

    console.error(
      JSON.stringify({
        level: "error",
        message:
          "Queue dispatch failed after status update — attempting rollback",
        job_id: jobId,
        target_status: targetStatus,
        previous_status: previousStatus,
        dispatch_error:
          dispatchError instanceof Error
            ? dispatchError.message
            : String(dispatchError),
        timestamp: new Date().toISOString(),
      }),
    );

    if (previousStatus) {
      try {
        await updateJobStatus(db, jobId, previousStatus as JobStatusType);
        console.log(
          JSON.stringify({
            level: "info",
            message: "Status rollback succeeded",
            job_id: jobId,
            rolled_back_to: previousStatus,
          }),
        );
      } catch (rollbackError) {
        console.error(
          JSON.stringify({
            level: "error",
            message: "Status rollback ALSO failed — job may be stuck",
            job_id: jobId,
            stuck_in_status: targetStatus,
            rollback_error:
              rollbackError instanceof Error
                ? rollbackError.message
                : String(rollbackError),
          }),
        );
      }
    }

    throw dispatchError;
  }
}
