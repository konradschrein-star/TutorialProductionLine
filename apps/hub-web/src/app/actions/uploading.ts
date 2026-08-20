"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray, and, sql } from "drizzle-orm";
import { Queue } from "bullmq";
import { db, contentJobs } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { QUEUE_NAMES } from "@repo/queue";
import { getRedisClient } from "@/lib/redis";

/**
 * Uploading Server Actions
 *
 * Batch status transitions for the Uploader VA workflow.
 * Only transitions from valid source states are applied.
 */

export interface ActionResult {
  success: boolean;
  error?: string;
  updated?: number;
  skipped?: number;
}

/**
 * Mark jobs as UPLOADING (uploader is working on them).
 * Only transitions jobs that are in AWAITING_UPLOADER or FAILED_UPLOAD state.
 */
export async function markJobsUploading(
  jobIds: string[],
): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "upload:youtube-video")) {
    return { success: false, error: "Permission denied" };
  }

  if (jobIds.length === 0) {
    return { success: false, error: "No jobs selected" };
  }

  try {
    const now = new Date();
    const nowIso = now.toISOString();

    // Only update jobs that are actually in a valid source state
    const result = await db
      .update(contentJobs)
      .set({
        status: "UPLOADING",
        assigned_uploader_va_id: session.userId,
        status_updated_at: now,
        updated_at: now,
        state_machine_history: sql`${contentJobs.state_machine_history} || ${JSON.stringify(
          [
            {
              from_status: "AWAITING_UPLOADER",
              to_status: "UPLOADING",
              timestamp: nowIso,
              reason: "Marked by uploader VA",
            },
          ],
        )}::jsonb`,
      })
      .where(
        and(
          inArray(contentJobs.id, jobIds),
          inArray(contentJobs.status, [
            "AWAITING_UPLOADER",
            "FAILED_UPLOAD",
          ] as any[]),
        ),
      )
      .returning({ id: contentJobs.id });

    const updated = result.length;
    const skipped = jobIds.length - updated;

    revalidatePath("/jobs");

    return { success: true, updated, skipped };
  } catch (error) {
    console.error("Failed to mark jobs as uploading:", error);
    return { success: false, error: "Failed to update jobs" };
  }
}

/**
 * Mark jobs as PUBLISHED (upload complete).
 * Only transitions jobs that are in UPLOADING state.
 */
export async function markJobsPublished(
  jobIds: string[],
): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "upload:youtube-video")) {
    return { success: false, error: "Permission denied" };
  }

  if (jobIds.length === 0) {
    return { success: false, error: "No jobs selected" };
  }

  try {
    const now = new Date();
    const nowIso = now.toISOString();

    const result = await db
      .update(contentJobs)
      .set({
        status: "PUBLISHED",
        published_at: now,
        status_updated_at: now,
        updated_at: now,
        state_machine_history: sql`${contentJobs.state_machine_history} || ${JSON.stringify(
          [
            {
              from_status: "UPLOADING",
              to_status: "PUBLISHED",
              timestamp: nowIso,
              reason: "Upload confirmed by VA",
            },
          ],
        )}::jsonb`,
      })
      .where(
        and(
          inArray(contentJobs.id, jobIds),
          eq(contentJobs.status, "UPLOADING" as any),
        ),
      )
      .returning({ id: contentJobs.id });

    const updated = result.length;
    const skipped = jobIds.length - updated;

    // Dispatch auto-label job for each newly published job
    if (result.length > 0) {
      try {
        const autoLabelQueue = new Queue<{ job_id: string }>(
          QUEUE_NAMES.AUTO_LABEL,
          {
            connection: getRedisClient(),
          },
        );
        await Promise.all(
          result.map(({ id }) =>
            autoLabelQueue.add(
              "auto-label",
              { job_id: id },
              { jobId: `auto-label-${id}`, removeOnComplete: true },
            ),
          ),
        );
      } catch (queueError) {
        // Auto-label is best-effort — log but do not fail the publish action
        console.error("Failed to dispatch auto-label jobs:", queueError);
      }
    }

    revalidatePath("/jobs");

    return { success: true, updated, skipped };
  } catch (error) {
    console.error("Failed to mark jobs as published:", error);
    return { success: false, error: "Failed to update jobs" };
  }
}
