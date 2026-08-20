import { Worker, Job } from "bullmq";
import type { JobProgress } from "bullmq";

/**
 * Event Helpers
 *
 * Reusable event listeners for BullMQ workers.
 * Provides structured logging for observability.
 *
 * Usage:
 * ```typescript
 * const worker = createIngestWorker(connection, processor);
 * attachStandardEventListeners(worker, "IngestWorker");
 * ```
 */

/**
 * Attach Standard Event Listeners
 *
 * Attaches completed, failed, and stalled event listeners to a worker.
 * Logs structured output for observability.
 *
 * @param worker - BullMQ Worker instance
 * @param workerName - Human-readable worker name for logs
 */
export interface WorkerEventHooks<T> {
  /**
   * Called when BullMQ gives up on a job, INCLUDING the stalled-out path where
   * the processor's own catch never runs.
   *
   * WHY THIS EXISTS: the `failed` listener below only ever logged. When BullMQ
   * killed a job with "job stalled more than allowable limit" — a worker
   * restart, an OOM, or work that outran lockDuration — the processor's catch
   * block never executed, so the database row was never updated. The job stayed
   * in its in-progress status forever: alive in the UI, dead in the queue,
   * invisible to everyone not reading pm2 logs.
   *
   * Verified on production 2026-08-03: three RANKING jobs sat in
   * ASSET_COLLECTION with error_message NULL for hours after BullMQ had already
   * abandoned them. This is the same silent-stranding class that hid 28
   * finished tutorial videos for up to 28 days.
   *
   * The hook lives here rather than a direct DB write because @repo/queue must
   * not depend on @repo/db. The caller supplies the persistence.
   *
   * Implementations MUST NOT throw — a hook that throws inside an event
   * listener produces an unhandled rejection and takes the worker down.
   */
  onFailed?: (
    error: Error,
    context: {
      workerName: string;
      bullJobId: string | undefined;
      attemptsMade: number | undefined;
      /**
       * The job PAYLOAD, passed through rather than re-fetched. The BullMQ job
       * id is not the domain row id — the payload carries that — and `Worker`
       * has no `getJob`, so the data must come from the event itself.
       * `undefined` when BullMQ could not load the job at all.
       */
      data: T | undefined;
    },
  ) => void | Promise<void>;
}

export function attachStandardEventListeners<T>(
  worker: Worker<T>,
  workerName: string,
  hooks?: WorkerEventHooks<T>,
): void {
  // Job completed successfully
  worker.on("completed", (job: Job<T>) => {
    console.log(
      JSON.stringify({
        event: "job_completed",
        status: "completed",
        worker: workerName,
        jobId: job.id,
        jobName: job.name,
        queueName: job.queueName,
        duration: job.finishedOn
          ? job.finishedOn - (job.processedOn || job.finishedOn)
          : 0,
        timestamp: new Date().toISOString(),
      }),
    );
  });

  // Job failed
  worker.on("failed", (job: Job<T> | undefined, error: Error) => {
    console.error(
      JSON.stringify({
        event: "job_failed",
        status: "failed",
        worker: workerName,
        jobId: job?.id,
        jobName: job?.name,
        queueName: job?.queueName,
        failureReason: error.message,
        error: error.message,
        stack: error.stack,
        attemptsMade: job?.attemptsMade,
        timestamp: new Date().toISOString(),
      }),
    );

    // Persist the failure if the caller supplied a hook. Wrapped so a throwing
    // hook can never take the worker down — an unhandled rejection in an event
    // listener is fatal, and the whole point of this hook is to make failures
    // MORE visible, not to introduce a new way to lose a worker.
    if (hooks?.onFailed) {
      void Promise.resolve(
        hooks.onFailed(error, {
          workerName,
          bullJobId: job?.id,
          attemptsMade: job?.attemptsMade,
          data: job?.data,
        }),
      ).catch((hookError: unknown) => {
        console.error(
          JSON.stringify({
            event: "job_failed_hook_error",
            worker: workerName,
            jobId: job?.id,
            error:
              hookError instanceof Error
                ? hookError.message
                : String(hookError),
            note: "the job row may still show an in-progress status — reconcile it",
            timestamp: new Date().toISOString(),
          }),
        );
      });
    }
  });

  // Job stalled (worker died mid-processing)
  worker.on("stalled", (jobId: string) => {
    console.warn(
      JSON.stringify({
        event: "job_stalled",
        worker: workerName,
        jobId,
        timestamp: new Date().toISOString(),
      }),
    );
  });

  // Worker error (not job-specific)
  worker.on("error", (error: Error) => {
    console.error(
      JSON.stringify({
        event: "worker_error",
        worker: workerName,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      }),
    );
  });

  // Worker active (started processing a job)
  worker.on("active", (job: Job<T>) => {
    console.log(
      JSON.stringify({
        event: "job_active",
        worker: workerName,
        jobId: job.id,
        jobName: job.name,
        queueName: job.queueName,
        timestamp: new Date().toISOString(),
      }),
    );
  });
}

/**
 * Attach Progress Event Listener
 *
 * Logs job progress updates (when job.updateProgress() is called).
 *
 * @param worker - BullMQ Worker instance
 * @param workerName - Human-readable worker name for logs
 */
export function attachProgressEventListener<T>(
  worker: Worker<T>,
  workerName: string,
): void {
  worker.on("progress", (job: Job<T>, progress: JobProgress) => {
    console.log(
      JSON.stringify({
        event: "job_progress",
        worker: workerName,
        jobId: job.id,
        jobName: job.name,
        progress,
        timestamp: new Date().toISOString(),
      }),
    );
  });
}

/**
 * Attach All Event Listeners
 *
 * Convenience function to attach both standard and progress listeners.
 *
 * @param worker - BullMQ Worker instance
 * @param workerName - Human-readable worker name for logs
 */
export function attachAllEventListeners<T>(
  worker: Worker<T>,
  workerName: string,
): void {
  attachStandardEventListeners(worker, workerName);
  attachProgressEventListener(worker, workerName);
}
