import { eq } from "drizzle-orm";
import { contentJobs } from "@repo/db";
import { createRedisConnection, createAssetCollectionQueue } from "@repo/queue";
import { CfApiError } from "../errors.js";
import type { CfRuntime } from "../runtime.js";

/**
 * Read the script for a job. Drama jobs stash it inside
 * `metadata.drama_config.script`; classic-pipeline jobs use the
 * top-level `script` column.
 */
export async function getJobScript(
  rt: CfRuntime,
  jobId: string,
): Promise<string> {
  const [job] = await rt.db
    .select({
      script: contentJobs.script,
      metadata: contentJobs.metadata,
      format: contentJobs.format,
    })
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);
  if (!job) throw new CfApiError("NOT_FOUND", `Job ${jobId} not found`);

  if (job.format === "LONG_FORM_DRAMA") {
    const meta = (job.metadata ?? {}) as Record<string, unknown>;
    const cfg = (meta["drama_config"] as Record<string, unknown>) ?? {};
    const script = cfg["script"] as string | undefined;
    if (!script) {
      throw new CfApiError("NOT_FOUND", "Drama job has no script yet");
    }
    return script;
  }

  if (!job.script) {
    throw new CfApiError("NOT_FOUND", "Job has no script yet");
  }
  return job.script;
}

/**
 * Inject a manually-written script into a job stuck in SCRIPTING. Mirrors
 * apps/hub-web/src/app/api/jobs/[id]/script/route.ts — transitions to
 * ASSET_COLLECTION and dispatches to queue-asset-collection.
 */
export async function setJobScript(
  rt: CfRuntime,
  jobId: string,
  rawScript: string,
): Promise<{ new_status: string }> {
  const script = rawScript?.trim();
  if (!script || script.length < 10) {
    throw new CfApiError(
      "BAD_REQUEST",
      "Script must be at least 10 characters",
    );
  }

  const [job] = await rt.db
    .select({ id: contentJobs.id, status: contentJobs.status })
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);
  if (!job) throw new CfApiError("NOT_FOUND", `Job ${jobId} not found`);

  if (job.status !== "SCRIPTING") {
    throw new CfApiError(
      "CONFLICT",
      `Cannot inject script: job is in status ${job.status}, expected SCRIPTING`,
    );
  }

  await rt.db
    .update(contentJobs)
    .set({
      script,
      status: "ASSET_COLLECTION" as never,
      updated_at: new Date(),
      status_updated_at: new Date(),
    })
    .where(eq(contentJobs.id, jobId));

  const conn = createRedisConnection({ url: rt.redisUrl, mode: "queue" });
  try {
    const queue = createAssetCollectionQueue(conn);
    await queue.add(`script-inject-${jobId}`, { job_id: jobId });
  } finally {
    await conn.quit();
  }

  return { new_status: "ASSET_COLLECTION" };
}
