import type { Job } from "bullmq";

/**
 * Whether the currently-executing processor run is the last one BullMQ will
 * make for this job.
 *
 * Tutorial jobs are enqueued with `attempts: 2`, so a transient failure on the
 * first run is followed by an automatic retry. Persisting a FAILED_* status on
 * that first run makes the studio render a red failure card with an error
 * message that disappears again seconds later when the retry succeeds — which
 * reads to the VA as the tool randomly erroring. Gate the FAILED_* write on
 * this so only a genuinely exhausted job is reported as failed.
 *
 * Inside a processor `attemptsMade` counts the runs that already *finished*, so
 * it is 0 on the first run. If a future BullMQ version counts the in-flight run
 * instead, this simply degrades to the old always-report behaviour rather than
 * silently swallowing a terminal failure.
 */
export function isFinalAttempt(
  job: Pick<Job, "attemptsMade" | "opts">,
): boolean {
  const made = job.attemptsMade ?? 0;
  const max = job.opts?.attempts ?? 1;
  return made + 1 >= max;
}
