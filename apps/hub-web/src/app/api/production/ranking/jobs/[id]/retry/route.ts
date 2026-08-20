import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, contentJobs } from "@/lib/db";
import { getHubConfig } from "@/lib/config";
import {
  createRedisConnection,
  createAIGenerationQueue,
  createAssetCollectionQueue,
  createRenderHeavyQueue,
} from "@repo/queue";

export const dynamic = "force-dynamic";

const MAX_RETRIES = 10;

/**
 * POST /api/production/ranking/jobs/[id]/retry
 *
 * VA-scoped retry for a failed RANKING job.
 *
 * The generic `/api/jobs/[id]/retry` requires `retry:job`, which only ADMIN and
 * MANAGER hold. That is correct for the fleet at large, but it means a VA
 * running the RANKING lane cannot clear the single most common failure they
 * will see (a script-provider timeout) without escalating to Konrad — which is
 * exactly the loop this work is supposed to remove him from. So: same retry
 * semantics, narrowed to one format, authorised on the tutorial grant.
 *
 * Format-locked on purpose. This handler refuses anything that is not RANKING,
 * so holding `create:tutorial-job` never becomes a way to poke other formats'
 * jobs back into their queues.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "create:tutorial-job")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: jobId } = await params;
  if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json({ error: "Invalid job ID" }, { status: 400 });
  }

  const [job] = await db
    .select()
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (job.format !== "RANKING") {
    return NextResponse.json(
      { error: "This endpoint only retries RANKING jobs." },
      { status: 400 },
    );
  }
  if (job.status === "FAILED_IRRECOVERABLE") {
    return NextResponse.json(
      {
        error:
          "This job is marked irrecoverable and needs an admin, not a retry.",
      },
      { status: 409 },
    );
  }
  if (!job.status.startsWith("FAILED_")) {
    return NextResponse.json(
      { error: `Nothing to retry — the job is ${job.status}.` },
      { status: 400 },
    );
  }

  const metadata = (job.metadata as Record<string, unknown>) ?? {};
  const retryCount = ((metadata["retry_count"] as number) ?? 0) + 1;
  if (retryCount > MAX_RETRIES) {
    return NextResponse.json(
      {
        error: `This job has already been retried ${MAX_RETRIES} times. Something is wrong with it that retrying will not fix — flag it.`,
      },
      { status: 422 },
    );
  }

  // Same restart-point rule as the generic retry route: a job that never
  // produced a script failed in SCRIPTING and must re-run it; a job that has a
  // script failed downstream, and re-running SCRIPTING would throw away a good
  // script and re-pay the LLM for nothing.
  const hasScript = (job.script ?? "").trim().length > 0;
  const plan =
    job.status === "FAILED_RENDER"
      ? { status: "ROUTING_RENDER", queue: "render" as const }
      : hasScript
        ? { status: "ASSET_COLLECTION", queue: "assets" as const }
        : { status: "SCRIPTING", queue: "script" as const };

  const topic = (job.initial_topic ?? job.title ?? "").trim();
  if (plan.queue === "script" && !topic) {
    return NextResponse.json(
      {
        error:
          "This job has no topic recorded, so its script cannot be regenerated. Create a new one from the brief instead.",
      },
      { status: 422 },
    );
  }

  await db
    .update(contentJobs)
    .set({
      status: plan.status as never,
      metadata: {
        ...metadata,
        retry_count: retryCount,
        last_retry_at: new Date().toISOString(),
        last_retry_by: session.userId,
        retry_reason: `VA retry from ${job.status}`,
      } as never,
      updated_at: new Date(),
      status_updated_at: new Date(),
    })
    .where(eq(contentJobs.id, jobId));

  const config = getHubConfig();
  const conn = createRedisConnection({ url: config.REDIS_URL, mode: "queue" });
  try {
    if (plan.queue === "script") {
      await createAIGenerationQueue(conn).add(`retry-${jobId}`, {
        job_id: jobId,
        generation_type: "script" as const,
        template_id: job.template_id,
        topic,
      } as never);
    } else if (plan.queue === "assets") {
      await createAssetCollectionQueue(conn).add(`retry-${jobId}`, {
        job_id: jobId,
      } as never);
    } else {
      await createRenderHeavyQueue(conn).add(`retry-${jobId}`, {
        job_id: jobId,
        priority: 0,
      } as never);
    }
  } catch (err) {
    console.error("[production/ranking retry] dispatch failed", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to re-queue the job",
      },
      { status: 500 },
    );
  } finally {
    await conn.quit();
  }

  return NextResponse.json({
    success: true,
    newStatus: plan.status,
    retryCount,
  });
}
