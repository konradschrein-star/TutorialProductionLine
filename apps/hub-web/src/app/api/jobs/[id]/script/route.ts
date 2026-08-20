import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, contentJobs } from "@/lib/db";
import { getHubConfig } from "@/lib/config";
import { createRedisConnection, createAssetCollectionQueue } from "@repo/queue";

export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/:id/script
 *
 * Inject a manually-written script into a job that is stuck in SCRIPTING state.
 * Transitions job → ASSET_COLLECTION and dispatches to queue-asset-collection.
 *
 * Body: { script: string }
 * Authorization: Requires 'edit:job' permission
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:job")) {
    return NextResponse.json(
      { error: "Insufficient permissions" },
      { status: 403 },
    );
  }

  const { id: jobId } = await params;
  if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json({ error: "Invalid job ID" }, { status: 400 });
  }

  let body: { script?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const script = body.script?.trim();
  if (!script || script.length < 10) {
    return NextResponse.json(
      { error: "Script must be at least 10 characters" },
      { status: 400 },
    );
  }

  const [job] = await db
    .select()
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.status !== "SCRIPTING") {
    return NextResponse.json(
      {
        error: `Cannot inject script: job is in status ${job.status}, expected SCRIPTING`,
      },
      { status: 409 },
    );
  }

  await db
    .update(contentJobs)
    .set({
      script: script,
      status: "ASSET_COLLECTION" as any,
      updated_at: new Date(),
      status_updated_at: new Date(),
    })
    .where(eq(contentJobs.id, jobId));

  const config = getHubConfig();
  const conn = createRedisConnection({ url: config.REDIS_URL, mode: "queue" });
  try {
    const queue = createAssetCollectionQueue(conn);
    await queue.add(`script-inject-${jobId}`, { job_id: jobId });
  } finally {
    await conn.quit();
  }

  return NextResponse.json({ success: true, new_status: "ASSET_COLLECTION" });
}
