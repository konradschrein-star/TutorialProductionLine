import { eq } from "drizzle-orm";
import { contentJobs } from "@repo/db";
import { createRedisConnection, createDramaTTSQueue } from "@repo/queue";
import type { DramaTTSPayload } from "@repo/contracts";
import { CfApiError } from "../errors.js";
import type { CfRuntime } from "../runtime.js";

const MAX_RETRIES = 10;

/**
 * Retry a failed job by resetting state and re-dispatching to its
 * format-appropriate queue. Currently supports LONG_FORM_DRAMA — the
 * format Hermes drives. The legacy hub-web route at
 * apps/hub-web/src/app/api/jobs/[id]/retry/route.ts still handles
 * BUNDESTAG + classic-pipeline formats with their own retry strategy.
 */
export async function retryJob(
  rt: CfRuntime,
  jobId: string,
  retriedByUserId?: string,
): Promise<{ new_status: string; retry_count: number }> {
  const [job] = await rt.db
    .select()
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);
  if (!job) throw new CfApiError("NOT_FOUND", `Job ${jobId} not found`);

  if (job.status === "FAILED_IRRECOVERABLE") {
    throw new CfApiError(
      "CONFLICT",
      "Cannot retry FAILED_IRRECOVERABLE jobs — requires human intervention",
    );
  }
  if (!job.status.startsWith("FAILED_")) {
    throw new CfApiError(
      "BAD_REQUEST",
      `Cannot retry job in status: ${job.status}`,
    );
  }

  const meta = (job.metadata as Record<string, unknown> | null) ?? {};
  const retryCount = ((meta["retry_count"] as number | undefined) ?? 0) + 1;
  if (retryCount > MAX_RETRIES) {
    throw new CfApiError(
      "FAILED_PRECONDITION",
      `Job has exceeded the maximum of ${MAX_RETRIES} retries`,
    );
  }

  let newStatus: string;
  switch (job.format) {
    case "LONG_FORM_DRAMA":
      newStatus = "DRAMA_TTS_GENERATING";
      break;
    default:
      throw new CfApiError(
        "BAD_REQUEST",
        `cf-api retry not implemented for format ${job.format}. Use the legacy hub-web retry endpoint.`,
      );
  }

  await rt.db
    .update(contentJobs)
    .set({
      status: newStatus as never,
      status_updated_at: new Date(),
      updated_at: new Date(),
      metadata: {
        ...meta,
        retry_count: retryCount,
        last_retry_at: new Date().toISOString(),
        last_retry_by: retriedByUserId ?? "api",
        retry_reason: `Manual retry from ${job.status}`,
      },
    })
    .where(eq(contentJobs.id, jobId));

  const conn = createRedisConnection({ url: rt.redisUrl, mode: "queue" });
  try {
    if (job.format === "LONG_FORM_DRAMA") {
      const dramaConfig = (meta["drama_config"] ?? {}) as Record<
        string,
        unknown
      >;
      const queue = createDramaTTSQueue(conn);
      const payload: DramaTTSPayload = {
        jobId,
        // Cast through unknown — the schema validates at the worker.
        config: dramaConfig as unknown as DramaTTSPayload["config"],
      };
      await queue.add(`retry-${jobId}`, payload, { attempts: 2 });
    }
  } finally {
    await conn.quit();
  }

  return { new_status: newStatus, retry_count: retryCount };
}
