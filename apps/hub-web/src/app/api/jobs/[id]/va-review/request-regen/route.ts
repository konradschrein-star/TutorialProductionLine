import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db, contentJobs } from "@/lib/db";
import { loadRankingJob } from "@/lib/va-review-job";
import { transitionJob } from "@repo/domain";
import {
  createAssetCollectionQueue,
  createRedisConnection,
} from "@repo/queue";

export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/[id]/va-review/request-regen
 *
 * Transition AWAITING_VA_REVIEW → ASSET_COLLECTION and re-dispatch footage
 * collection. Matches how the pipeline enqueues asset collection
 * (queue-asset-collection, job name "asset-collection", payload { job_id }).
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
  const { job } = loaded;

  if (job.status !== "AWAITING_VA_REVIEW") {
    return NextResponse.json(
      { error: `Job is in ${job.status} — expected AWAITING_VA_REVIEW` },
      { status: 400 },
    );
  }

  const transition = transitionJob(
    job.status as never,
    "ASSET_COLLECTION" as never,
  );
  if (!transition.success) {
    return NextResponse.json(
      { error: `Invalid state transition: ${transition.error.message}` },
      { status: 400 },
    );
  }

  await db
    .update(contentJobs)
    .set({ status: "ASSET_COLLECTION", updated_at: new Date() })
    .where(eq(contentJobs.id, id));

  // Re-dispatch asset collection the same way the pipeline / enqueue script does.
  const redisUrl = process.env["REDIS_URL"];
  if (redisUrl) {
    try {
      const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
      const queue = createAssetCollectionQueue(conn);
      await queue.add(
        "asset-collection",
        { job_id: id },
        { attempts: 1, removeOnComplete: true },
      );
      await conn.quit();
    } catch (err) {
      // Non-fatal: status is already ASSET_COLLECTION; a worker sweep can re-pick.
      console.error(
        "[va-review/request-regen] Failed to dispatch asset-collection job:",
        err,
      );
    }
  }

  return NextResponse.json({ success: true, status: "ASSET_COLLECTION" });
}
