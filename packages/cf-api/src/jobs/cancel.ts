import { eq } from "drizzle-orm";
import { contentJobs } from "@repo/db";
import { CfApiError } from "../errors.js";
import type { CfRuntime } from "../runtime.js";

/**
 * Cancel a job by transitioning it to FAILED_GENERAL with a reason
 * stamped into metadata. Mirrors the existing repository behaviour at
 * apps/hub-web/src/lib/repositories/upload-repository.ts.
 *
 * Terminal-state jobs (PUBLISHED, FAILED_IRRECOVERABLE) reject.
 */
export async function cancelJob(
  rt: CfRuntime,
  jobId: string,
  reason: string,
  cancelledByUserId?: string,
): Promise<void> {
  if (!reason || reason.trim().length < 10) {
    throw new CfApiError(
      "BAD_REQUEST",
      "Cancel reason must be at least 10 characters",
    );
  }

  const [job] = await rt.db
    .select({
      id: contentJobs.id,
      status: contentJobs.status,
      metadata: contentJobs.metadata,
    })
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);
  if (!job) throw new CfApiError("NOT_FOUND", `Job ${jobId} not found`);

  if (job.status === "PUBLISHED" || job.status === "FAILED_IRRECOVERABLE") {
    throw new CfApiError(
      "CONFLICT",
      `Cannot cancel job in terminal state ${job.status}`,
    );
  }

  const meta = (job.metadata as Record<string, unknown> | null) ?? {};
  await rt.db
    .update(contentJobs)
    .set({
      status: "FAILED_GENERAL" as never,
      status_updated_at: new Date(),
      updated_at: new Date(),
      metadata: {
        ...meta,
        cancel_reason: reason,
        cancelled_at: new Date().toISOString(),
        cancelled_by: cancelledByUserId ?? "api",
      },
    })
    .where(eq(contentJobs.id, jobId));
}
