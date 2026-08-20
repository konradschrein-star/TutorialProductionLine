import { and, lt, notInArray, eq } from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";
import { contentJobs } from "@repo/db";
import {
  createRedisConnection,
  createGarbageCollectionQueue,
} from "@repo/queue";

const AUTO_DELETE_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours
const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Statuses exempt from auto-deletion.
 *
 * ## Why this list grew (2026-08-04)
 *
 * It used to be exactly PUBLISHED / DELETED / MARKED_FOR_DELETION, which meant
 * this watchdog HARD-DELETED (`db.delete`, not a state transition) every other
 * job older than 48 hours — including every human-in-the-loop state.
 *
 * That is a direct data-loss path through the entire design of this pipeline:
 *
 *  - The owner is deliberately OUT of the loop; the VA owns every gate. A
 *    RANKING job parked at AWAITING_VA_REVIEW for clip selection over a
 *    weekend was deleted on the Sunday.
 *  - The VA reviews AT END OF DAY. A Friday-afternoon render sitting in
 *    AWAITING_UPLOADER did not survive to Monday.
 *  - The new output QA gate routes a suspect render to AWAITING_QC precisely
 *    so a human can look at it. This watchdog would have destroyed the
 *    evidence 48 hours later — the one thing the gate exists to preserve.
 *
 * A job waiting on a person must never be deleted by a timer. "The human has
 * not got to it yet" is not garbage; it is the normal state of a queue with a
 * human in it.
 *
 * PAUSED is exempt for the same reason: it is parked on purpose.
 */
export const EXEMPT_STATUSES = [
  "PUBLISHED",
  "DELETED",
  "MARKED_FOR_DELETION",
  // Human-in-the-loop. Every one of these means "waiting for a person".
  "AWAITING_RESEARCH",
  "AWAITING_CLIP_REVIEW",
  "AWAITING_PRODUCTION_VA",
  "AWAITING_IMAGE_QC",
  "AWAITING_VA_REVIEW",
  "AWAITING_QC",
  "AWAITING_UPLOADER",
  // Deliberately parked by an operator.
  "PAUSED",
] as const;

async function runAutoDelete(
  db: DrizzleClient,
  redisUrl: string,
): Promise<void> {
  const cutoff = new Date(Date.now() - AUTO_DELETE_AGE_MS);

  const expired = await db
    .select({
      id: contentJobs.id,
      r2_asset_manifest: contentJobs.r2_asset_manifest,
      format: contentJobs.format,
      status: contentJobs.status,
      created_at: contentJobs.created_at,
      status_updated_at: contentJobs.status_updated_at,
    })
    .from(contentJobs)
    .where(
      and(
        // Staleness is measured from the LAST STATE CHANGE, not from creation.
        // On created_at, a long multi-day job that was progressing perfectly
        // well became "expired" purely for having started three days ago.
        // What we actually want to collect is jobs that have STOPPED MOVING.
        lt(contentJobs.status_updated_at, cutoff),
        notInArray(contentJobs.status, [...EXEMPT_STATUSES]),
      ),
    );

  if (expired.length === 0) return;

  // Log WHAT is being deleted, not just how many. This previously emitted a
  // bare count, so a job that vanished left no record of ever having existed —
  // there was no way to answer "what happened to that video?" after the fact.
  console.log(
    JSON.stringify({
      level: "info",
      message: "[auto-delete] Removing expired jobs",
      count: expired.length,
      cutoff: cutoff.toISOString(),
      jobs: expired.map((j) => ({
        job_id: j.id,
        status: j.status,
        format: j.format,
        stalled_hours: Math.round(
          (Date.now() -
            new Date(j.status_updated_at ?? j.created_at).getTime()) /
            3_600_000,
        ),
      })),
    }),
  );

  const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
  const gcQueue = createGarbageCollectionQueue(conn);

  for (const job of expired) {
    try {
      await db.delete(contentJobs).where(eq(contentJobs.id, job.id));

      if (
        Array.isArray(job.r2_asset_manifest) &&
        job.r2_asset_manifest.length > 0
      ) {
        await gcQueue.add("gc-job", { job_id: job.id, force: true });
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "[auto-delete] Failed to delete job",
          job_id: job.id,
          error: String(err).slice(0, 200),
        }),
      );
    }
  }

  await conn.quit();
}

export function startJobAutoDeleteInterval(
  db: DrizzleClient,
  redisUrl: string,
  intervalMs = POLL_INTERVAL_MS,
): NodeJS.Timeout {
  runAutoDelete(db, redisUrl).catch(() => {});
  return setInterval(() => {
    runAutoDelete(db, redisUrl).catch(() => {});
  }, intervalMs);
}
