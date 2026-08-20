import type { NextRequest } from "next/server";
import { Queue } from "bullmq";
import { eq } from "drizzle-orm";
import { createRedisConnection, QUEUE_NAMES } from "@repo/queue";
import { withApiAuth } from "../../../_lib/auth";
import { db } from "@/lib/db";
import { cfJobFailures } from "@repo/db";
import { getHubConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Queues a dead-lettered Clip Forge job may be replayed onto.
 *
 * Restricting this to the four Clip Forge queues is deliberate: the `queue`
 * column is free text, and replaying an arbitrary string would let this route
 * push jobs onto any queue in the system.
 */
const REPLAYABLE = new Set<string>([
  QUEUE_NAMES.CF_INGEST,
  QUEUE_NAMES.CF_CLIP_DETECTION,
  QUEUE_NAMES.CF_RAW_RENDER,
  QUEUE_NAMES.CF_FINISHING_RENDER,
]);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * POST /api/v1/clip-forge/job-failures/:id  — requeue
 *
 * Re-adds the stored payload to the queue the job died on, then deletes the
 * failure row. The Errors console shipped with `requeue`, `discard` and
 * `jump to source` buttons that had no handlers, so a dead-lettered job could
 * only be recovered by hand on the box.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withApiAuth(req, async () => {
    const [row] = await db
      .select()
      .from(cfJobFailures)
      .where(eq(cfJobFailures.id, id))
      .limit(1);
    if (!row) return json({ error: "job failure not found" }, 404);

    if (!REPLAYABLE.has(row.queue)) {
      return json(
        {
          error: `queue '${row.queue}' is not a replayable Clip Forge queue`,
          replayable: [...REPLAYABLE],
        },
        400,
      );
    }
    const payload = row.payload as Record<string, unknown>;
    if (!payload || Object.keys(payload).length === 0) {
      return json(
        {
          error:
            "stored payload is empty — this job cannot be replayed, only discarded",
        },
        409,
      );
    }

    const cfg = getHubConfig();
    const conn = createRedisConnection({ url: cfg.REDIS_URL, mode: "queue" });
    try {
      const q = new Queue(row.queue, { connection: conn });
      try {
        await q.add(`${row.queue}-requeue`, payload);
      } finally {
        await q.close();
      }
    } finally {
      await conn.quit().catch(() => {});
    }

    // The row has served its purpose; a replayed job that fails again writes a
    // fresh failure. Leaving it would make the DLQ count permanently wrong.
    await db.delete(cfJobFailures).where(eq(cfJobFailures.id, id));

    return { requeued: true, queue: row.queue, payload };
  });
}

/**
 * DELETE /api/v1/clip-forge/job-failures/:id  — discard
 *
 * Drops the failure record without replaying it.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withApiAuth(req, async () => {
    const deleted = await db
      .delete(cfJobFailures)
      .where(eq(cfJobFailures.id, id))
      .returning({ id: cfJobFailures.id });
    if (deleted.length === 0) {
      return json({ error: "job failure not found" }, 404);
    }
    return { discarded: true };
  });
}
