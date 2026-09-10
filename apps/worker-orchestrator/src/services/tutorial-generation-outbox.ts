import { sql } from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";

type GenerationQueue = {
  add: (
    name: string,
    data: { jobId: string; stage: "script" },
    options: { jobId: string; attempts: number },
  ) => Promise<unknown>;
};

export function generationDispatchRetrySeconds(attempts: number): number {
  return Math.min(300, 5 * 2 ** Math.min(Math.max(attempts, 1), 6));
}

/** Lease and publish one durable PostgreSQL -> BullMQ dispatch intent. */
export async function dispatchTutorialGeneration(
  db: DrizzleClient,
  queue: GenerationQueue,
  options: { jobId?: string } = {},
): Promise<{ pending: boolean; dispatched: boolean }> {
  const rows = await db.execute(sql`
    WITH candidate AS (
      SELECT o.tutorial_job_id
      FROM tutorial_generation_outbox o
      WHERE o.dispatched_at IS NULL
        AND o.available_at <= now()
        AND (${options.jobId ?? null}::uuid IS NULL OR o.tutorial_job_id = ${options.jobId ?? null}::uuid)
        AND (o.lease_until IS NULL OR o.lease_until < now())
      ORDER BY o.available_at, o.tutorial_job_id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE tutorial_generation_outbox o
    SET lease_until = now() + interval '30 seconds', attempts = attempts + 1
    FROM candidate
    WHERE o.tutorial_job_id = candidate.tutorial_job_id
    RETURNING o.tutorial_job_id, o.bull_job_id, o.stage, o.attempts,
      (SELECT status::text FROM tutorial_jobs WHERE id = o.tutorial_job_id) AS tutorial_status
  `);
  const row = rows[0] as {
    tutorial_job_id: string;
    bull_job_id: string;
    stage: "script";
    attempts: number;
    tutorial_status: string;
  } | undefined;
  if (!row) return { pending: false, dispatched: false };

  // A crash may occur after BullMQ accepted the job but before the outbox was
  // acknowledged. An advanced DB state is durable proof that it ran; do not
  // create a replacement queue job after BullMQ retention removes the first.
  if (row.tutorial_status !== "QUEUED") {
    await db.execute(sql`
      UPDATE tutorial_generation_outbox
      SET dispatched_at = now(), lease_until = NULL, last_error = NULL
      WHERE tutorial_job_id = ${row.tutorial_job_id}::uuid
        AND attempts = ${row.attempts}
    `);
    return { pending: true, dispatched: true };
  }

  try {
    await queue.add(
      "tutorial-generate",
      { jobId: row.tutorial_job_id, stage: "script" },
      { jobId: row.bull_job_id, attempts: 2 },
    );
    await db.execute(sql`
      UPDATE tutorial_generation_outbox
      SET dispatched_at = now(), lease_until = NULL, last_error = NULL
      WHERE tutorial_job_id = ${row.tutorial_job_id}::uuid
        AND attempts = ${row.attempts}
    `);
    return { pending: true, dispatched: true };
  } catch {
    const delay = generationDispatchRetrySeconds(row.attempts);
    await db.execute(sql`
      UPDATE tutorial_generation_outbox
      SET lease_until = NULL,
          available_at = now() + ${delay} * interval '1 second',
          last_error = 'BullMQ dispatch unavailable; retry scheduled'
      WHERE tutorial_job_id = ${row.tutorial_job_id}::uuid
        AND attempts = ${row.attempts}
    `);
    return { pending: true, dispatched: false };
  }
}

export function startTutorialGenerationOutbox(
  db: DrizzleClient,
  queue: GenerationQueue,
) {
  let busy = false;
  let stopped = false;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      for (let count = 0; count < 20 && !stopped; count += 1) {
        if (!(await dispatchTutorialGeneration(db, queue)).pending) break;
      }
    } catch {
      console.warn("Tutorial generation dispatch unavailable; durable intents retained");
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), 5_000);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
