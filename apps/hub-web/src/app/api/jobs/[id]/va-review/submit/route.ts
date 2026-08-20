import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db, contentJobs } from "@/lib/db";
import { loadRankingJob } from "@/lib/va-review-job";
import { pendingCount } from "@/lib/ranking-blocks";
import { transitionJob } from "@repo/domain";
import {
  createQMSValidationQueue,
  createRedisConnection,
} from "@repo/queue";

export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/[id]/va-review/submit
 *
 * If every ranked item is approved|skipped, transition AWAITING_VA_REVIEW →
 * QMS_VALIDATING and dispatch pre-render validation. Otherwise 400 with the
 * remaining count.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const loaded = await loadRankingJob(id);
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }
  const { job, ranking } = loaded;

  if (job.status !== "AWAITING_VA_REVIEW") {
    return NextResponse.json(
      { error: `Job is in ${job.status} — expected AWAITING_VA_REVIEW` },
      { status: 400 },
    );
  }

  const remaining = pendingCount(ranking);
  if (remaining > 0) {
    return NextResponse.json(
      { error: `${remaining} block(s) still pending review`, remaining },
      { status: 400 },
    );
  }

  const transition = transitionJob(job.status as never, "QMS_VALIDATING" as never);
  if (!transition.success) {
    return NextResponse.json(
      { error: `Invalid state transition: ${transition.error.message}` },
      { status: 400 },
    );
  }

  await db
    .update(contentJobs)
    .set({ status: "QMS_VALIDATING", updated_at: new Date() })
    .where(eq(contentJobs.id, id));

  // Dispatch pre-render validation so the worker picks it up immediately.
  const redisUrl = process.env["REDIS_URL"];
  if (redisUrl) {
    try {
      const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
      const qmsQueue = createQMSValidationQueue(conn);
      await qmsQueue.add("validate-pre-render", {
        job_id: id,
        validation_stage: "pre-render",
      });
      await conn.quit();
    } catch (err) {
      // Non-fatal: status is already advanced; QMS will be picked up on poll.
      console.error("[va-review/submit] Failed to dispatch QMS job:", err);
    }
  }

  return NextResponse.json({ success: true, status: "QMS_VALIDATING" });
}
