"use server";

import { unlink, rm, access } from "node:fs/promises";
import * as path from "node:path";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, contentJobs, users } from "@/lib/db";
import { eq, inArray, and, ne, asc, count, isNotNull } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  createQMSValidationQueue,
  createIngestQueue,
  createRedisConnection,
  createGarbageCollectionQueue,
  createThumbnailQueue,
} from "@repo/queue";
import { transitionJob } from "@repo/domain";
import {
  extractRanking,
  pendingCount,
  rankedCount,
} from "@/lib/ranking-blocks";

/** Ported from apps/worker-orchestrator/src/utils/thumbnail/prompt-builder.ts firstNSentences.
 * Duplicated here because hub-web must not import across app boundaries. */
function firstNSentences(script: string, n: number): string {
  const parts = script.match(/[^.!?]+[.!?]+(\s|$)/g);
  if (!parts) return script.trim();
  return parts
    .slice(0, n)
    .map((s) => s.trim())
    .join(" ")
    .trim();
}

/**
 * Job Server Actions
 *
 * Server-side actions for job operations (pause, resume, delete, assign VA, etc.).
 * All actions enforce RBAC and validate session.
 */

/**
 * Clean up job filesystem directory
 *
 * Recursively deletes LOCAL_MEDIA_ROOT/{format}/{job_id}/ directory.
 * Logs cleanup actions for auditing. Does not throw on error.
 *
 * @param jobId - Job ID
 * @param format - Content format (e.g., "BUNDESTAG", "EXPLAINER", "TECH_COMPARISON")
 * @returns Cleanup result with success status
 */
async function cleanupJobFilesystem(
  jobId: string,
  format: string,
): Promise<{ success: boolean; error?: string }> {
  const LOCAL_MEDIA_ROOT = process.env["LOCAL_MEDIA_ROOT"];
  if (!LOCAL_MEDIA_ROOT) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message:
          "Job filesystem cleanup skipped: LOCAL_MEDIA_ROOT not configured",
        job_id: jobId,
        format: format,
        timestamp: new Date().toISOString(),
      }),
    );
    return { success: false, error: "LOCAL_MEDIA_ROOT not configured" };
  }

  const jobDir = path.join(LOCAL_MEDIA_ROOT, format, jobId);

  try {
    // Check if directory exists
    await access(jobDir);

    // Recursively delete directory
    await rm(jobDir, { recursive: true, force: true });

    console.warn(
      JSON.stringify({
        level: "info",
        message: "Job filesystem cleanup completed",
        job_id: jobId,
        format: format,
        directory: jobDir,
        timestamp: new Date().toISOString(),
      }),
    );

    return { success: true };
  } catch (error: any) {
    if (error.code === "ENOENT") {
      // Directory doesn't exist - not an error
      console.warn(
        JSON.stringify({
          level: "info",
          message:
            "Job filesystem cleanup: directory does not exist (already clean)",
          job_id: jobId,
          format: format,
          directory: jobDir,
          timestamp: new Date().toISOString(),
        }),
      );
      return { success: true };
    }

    console.error(
      JSON.stringify({
        level: "error",
        message: "Job filesystem cleanup failed",
        job_id: jobId,
        format: format,
        directory: jobDir,
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
    );

    return { success: false, error: error.message };
  }
}

export interface ActionResult {
  success: boolean;
  error?: string;
}

/**
 * Pause a job
 *
 * @param jobId - Job ID to pause
 * @param formData - Form data (unused, required for form action)
 * @returns Action result
 */
export async function pauseJob(
  jobId: string,
  formData?: FormData,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "pause:job")) {
    return { success: false, error: "Permission denied" };
  }

  try {
    // Get current job to check status
    const job = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, jobId))
      .limit(1);

    if (job.length === 0) {
      return { success: false, error: "Job not found" };
    }

    const currentStatus = job[0].status;

    // Don't pause terminal or failed states
    if (
      currentStatus === "PUBLISHED" ||
      currentStatus === "PAUSED" ||
      currentStatus.startsWith("FAILED_")
    ) {
      return { success: false, error: "Cannot pause job in this state" };
    }

    // Update job to PAUSED and store previous status
    await db
      .update(contentJobs)
      .set({
        status: "PAUSED",
        paused_from_status: currentStatus,
        updated_at: new Date(),
      })
      .where(eq(contentJobs.id, jobId));

    revalidatePath("/jobs");
    revalidatePath(`/jobs/${jobId}`);

    return { success: true };
  } catch (error) {
    console.error("Failed to pause job:", error);
    return { success: false, error: "Failed to pause job" };
  }
}

/**
 * Resume a paused job
 *
 * @param jobId - Job ID to resume
 * @param formData - Form data (unused, required for form action)
 * @returns Action result
 */
export async function resumeJob(
  jobId: string,
  formData?: FormData,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "resume:job")) {
    return { success: false, error: "Permission denied" };
  }

  try {
    // Get current job
    const job = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, jobId))
      .limit(1);

    if (job.length === 0) {
      return { success: false, error: "Job not found" };
    }

    if (job[0].status !== "PAUSED" || !job[0].paused_from_status) {
      return { success: false, error: "Job is not paused" };
    }

    // Restore previous status
    await db
      .update(contentJobs)
      .set({
        status: job[0].paused_from_status,
        paused_from_status: null,
        updated_at: new Date(),
      })
      .where(eq(contentJobs.id, jobId));

    revalidatePath("/jobs");
    revalidatePath(`/jobs/${jobId}`);

    return { success: true };
  } catch (error) {
    console.error("Failed to resume job:", error);
    return { success: false, error: "Failed to resume job" };
  }
}

/**
 * Delete a job
 *
 * @param jobId - Job ID to delete
 * @param formData - Form data (unused, required for form action)
 * @returns Action result
 */
export async function deleteJob(
  jobId: string,
  formData?: FormData,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "delete:job")) {
    return { success: false, error: "Permission denied" };
  }

  try {
    // Fetch the job's asset manifest and format before deletion
    const [job] = await db
      .select({
        r2_asset_manifest: contentJobs.r2_asset_manifest,
        format: contentJobs.format,
      })
      .from(contentJobs)
      .where(eq(contentJobs.id, jobId))
      .limit(1);

    await db.delete(contentJobs).where(eq(contentJobs.id, jobId));

    // Clean up filesystem (LOCAL_MEDIA_ROOT/{format}/{job_id}/)
    // Non-blocking: cleanup failure does not prevent job deletion
    if (job && job.format) {
      await cleanupJobFilesystem(jobId, job.format);
    }

    // Dispatch garbage collection to clean up R2 assets
    const redisUrl = process.env["REDIS_URL"];
    if (
      redisUrl &&
      job &&
      Array.isArray(job.r2_asset_manifest) &&
      job.r2_asset_manifest.length > 0
    ) {
      const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
      const gcQueue = createGarbageCollectionQueue(conn);
      await gcQueue.add("gc-job", { job_id: jobId, force: true });
      await conn.quit();
    }

    revalidatePath("/jobs");

    return { success: true };
  } catch (error) {
    console.error("Failed to delete job:", error);
    return { success: false, error: "Failed to delete job" };
  }
}

/**
 * Bulk pause jobs
 *
 * @param jobIds - Array of job IDs
 * @returns Action result
 */
export async function bulkPauseJobs(jobIds: string[]): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "pause:job")) {
    return { success: false, error: "Permission denied" };
  }

  if (jobIds.length === 0) {
    return { success: false, error: "No jobs selected" };
  }

  try {
    // For bulk operations, we don't preserve pausedFromStatus (simplification)
    await db
      .update(contentJobs)
      .set({
        status: "PAUSED",
        updated_at: new Date(),
      })
      .where(inArray(contentJobs.id, jobIds));

    revalidatePath("/jobs");

    return { success: true };
  } catch (error) {
    console.error("Failed to bulk pause jobs:", error);
    return { success: false, error: "Failed to pause jobs" };
  }
}

/**
 * Bulk delete jobs
 *
 * @param jobIds - Array of job IDs
 * @returns Action result
 */
export async function bulkDeleteJobs(jobIds: string[]): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "delete:job")) {
    return { success: false, error: "Permission denied" };
  }

  if (jobIds.length === 0) {
    return { success: false, error: "No jobs selected" };
  }

  try {
    // Fetch manifests and formats for all jobs before deletion
    const jobs = await db
      .select({
        id: contentJobs.id,
        r2_asset_manifest: contentJobs.r2_asset_manifest,
        format: contentJobs.format,
      })
      .from(contentJobs)
      .where(inArray(contentJobs.id, jobIds));

    await db.delete(contentJobs).where(inArray(contentJobs.id, jobIds));

    // Clean up filesystem for all jobs (non-blocking)
    // Use Promise.allSettled to continue even if some cleanups fail
    await Promise.allSettled(
      jobs.map((j) => cleanupJobFilesystem(j.id, j.format)),
    );

    // Dispatch garbage collection for each deleted job that had assets
    const redisUrl = process.env["REDIS_URL"];
    if (redisUrl) {
      const jobsWithAssets = jobs.filter(
        (j) =>
          Array.isArray(j.r2_asset_manifest) && j.r2_asset_manifest.length > 0,
      );
      if (jobsWithAssets.length > 0) {
        const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
        const gcQueue = createGarbageCollectionQueue(conn);
        await Promise.all(
          jobsWithAssets.map((j) =>
            gcQueue.add("gc-job", { job_id: j.id, force: true }),
          ),
        );
        await conn.quit();
      }
    }

    revalidatePath("/jobs");

    return { success: true };
  } catch (error) {
    console.error("Failed to bulk delete jobs:", error);
    return { success: false, error: "Failed to delete jobs" };
  }
}

/**
 * Finalize HeyGen footage upload for a job.
 *
 * Called after the file has been saved to local storage via /api/upload.
 * Updates r2_asset_manifest and transitions job to QMS_VALIDATING.
 *
 * @param jobId    - Job ID
 * @param r2Key    - Asset key (local file path) returned by /api/upload
 * @param sizeBytes - File size in bytes
 * @returns Action result
 */
export async function finalizeHeyGenFootageUpload(
  jobId: string,
  r2Key: string,
  sizeBytes: number,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "upload:heygen-footage")) {
    return { success: false, error: "Permission denied" };
  }

  try {
    // Get job
    const job = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, jobId))
      .limit(1);

    if (job.length === 0) {
      return { success: false, error: "Job not found" };
    }

    const jobData = job[0];

    // Check status
    if (jobData.status !== "AWAITING_PRODUCTION_VA") {
      return {
        success: false,
        error: "Job is not awaiting HeyGen footage upload",
      };
    }

    // Check if VA is assigned and matches session user (or is ADMIN)
    if (
      session.role !== "ADMIN" &&
      jobData.assigned_production_va_id !== session.userId
    ) {
      return {
        success: false,
        error: "You are not assigned to this job",
      };
    }

    const assetInfo = {
      key: r2Key,
      type: "video/raw-va-footage",
      size_bytes: sizeBytes,
    };

    // Validate state transition via domain state machine
    const transitionResult = transitionJob(
      jobData.status as any,
      "QMS_VALIDATING" as any,
      jobData.paused_from_status as any,
    );
    if (!transitionResult.success) {
      return {
        success: false,
        error: `Invalid state transition: ${transitionResult.error.message}`,
      };
    }

    // Update job with asset manifest and transition to QMS_VALIDATING
    const currentManifest =
      (jobData.r2_asset_manifest as Array<{
        key: string;
        type: string;
        size_bytes: number;
      }>) || [];

    const updatedManifest = [
      ...currentManifest,
      {
        key: assetInfo.key,
        type: assetInfo.type,
        size_bytes: assetInfo.size_bytes,
      },
    ];

    const existingHistory = (jobData.state_machine_history as Array<any>) || [];

    await db
      .update(contentJobs)
      .set({
        r2_asset_manifest: updatedManifest,
        status: "QMS_VALIDATING",
        state_machine_history: [
          ...existingHistory,
          {
            from: jobData.status,
            to: "QMS_VALIDATING",
            timestamp: new Date().toISOString(),
            actor: session.userId,
            reason: "HeyGen footage uploaded",
          },
        ],
        updated_at: new Date(),
      })
      .where(eq(contentJobs.id, jobId));

    // Dispatch to qms-validation queue so the worker picks it up immediately
    const redisUrl = process.env["REDIS_URL"];
    if (redisUrl) {
      const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
      const qmsQueue = createQMSValidationQueue(conn);
      await qmsQueue.add("validate-pre-render", {
        job_id: jobId,
        validation_stage: "pre-render" as const,
      });
      await conn.quit();
    }

    revalidatePath("/jobs");
    revalidatePath(`/jobs/${jobId}`);

    return { success: true };
  } catch (error) {
    console.error("Failed to upload HeyGen footage:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Upload failed",
    };
  }
}

/**
 * Retry a failed job
 *
 * Determines the appropriate re-queue target based on failure type:
 * - FAILED_QMS → QMS_VALIDATING → qms-validation queue
 * - FAILED_RENDER → ROUTING_RENDER → render-heavy queue
 * - FAILED_UPLOAD → UPLOADING (no dispatch — handled by uploader extension)
 * - FAILED_GENERAL → IDEA_GENERATION (restart from beginning, no dispatch)
 *
 * @param jobId - Job ID to retry
 * @returns Action result
 */
export async function retryJob(jobId: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "retry:job")) {
    return { success: false, error: "Permission denied" };
  }

  try {
    const [job] = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, jobId))
      .limit(1);

    if (!job) {
      return { success: false, error: "Job not found" };
    }

    const failureMap: Record<string, string> = {
      FAILED_QMS: "QMS_VALIDATING",
      FAILED_RENDER: "ROUTING_RENDER",
      FAILED_UPLOAD: "UPLOADING",
      FAILED_GENERAL: "IDEA_GENERATION",
    };

    const targetStatus = failureMap[job.status];
    if (!targetStatus) {
      return {
        success: false,
        error: `Job is not in a retryable failed state (current: ${job.status})`,
      };
    }

    const transitionResult = transitionJob(
      job.status as any,
      targetStatus as any,
      job.paused_from_status as any,
    );
    if (!transitionResult.success) {
      return {
        success: false,
        error: `Invalid state transition: ${transitionResult.error.message}`,
      };
    }

    const existingHistory = (job.state_machine_history as Array<any>) || [];

    await db
      .update(contentJobs)
      .set({
        status: targetStatus as any,
        error_message: null,
        state_machine_history: [
          ...existingHistory,
          {
            from: job.status,
            to: targetStatus,
            timestamp: new Date().toISOString(),
            actor: session.userId,
            reason: "Manual retry by operator",
          },
        ],
        updated_at: new Date(),
      })
      .where(eq(contentJobs.id, jobId));

    // Dispatch to the appropriate queue
    const redisUrl = process.env["REDIS_URL"];
    if (redisUrl) {
      const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
      if (targetStatus === "QMS_VALIDATING") {
        const qmsQueue = createQMSValidationQueue(conn);
        await qmsQueue.add("validate-pre-render", {
          job_id: jobId,
          validation_stage: "pre-render" as const,
        });
      } else if (targetStatus === "ROUTING_RENDER") {
        const { createRenderHeavyQueue } = await import("@repo/queue");
        const renderQueue = createRenderHeavyQueue(conn);
        await renderQueue.add("route-render", { job_id: jobId, priority: 5 });
      }
      // UPLOADING and IDEA_GENERATION do not need queue dispatch from Hub
      await conn.quit();
    }

    revalidatePath("/jobs");
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/system-health");

    return { success: true };
  } catch (error) {
    console.error("Failed to retry job:", error);
    return { success: false, error: "Failed to retry job" };
  }
}

/**
 * Approve a job after QC review
 *
 * Transitions job from AWAITING_QC to AWAITING_UPLOADER.
 *
 * @param jobId - Job ID
 * @returns Action result
 */
export async function approveQC(jobId: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "review:qc")) {
    return { success: false, error: "Permission denied" };
  }

  try {
    const job = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, jobId))
      .limit(1);

    if (job.length === 0) {
      return { success: false, error: "Job not found" };
    }

    const jobData = job[0];

    if (jobData.status !== "AWAITING_QC") {
      return { success: false, error: "Job is not awaiting QC review" };
    }

    const transitionResult = transitionJob(
      jobData.status as any,
      "AWAITING_UPLOADER" as any,
      jobData.paused_from_status as any,
    );
    if (!transitionResult.success) {
      return {
        success: false,
        error: `Invalid state transition: ${transitionResult.error.message}`,
      };
    }

    const existingHistory = (jobData.state_machine_history as Array<any>) || [];

    // Auto-assign the first active uploader VA — no manual admin step needed
    // when there is only one uploader in the system.
    const [defaultUploader] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "UPLOADER_VA"), eq(users.is_active, true)))
      .orderBy(asc(users.created_at))
      .limit(1);

    await db
      .update(contentJobs)
      .set({
        status: "AWAITING_UPLOADER",
        qc_reviewed_at: new Date(),
        qc_feedback: null,
        assigned_uploader_va_id:
          defaultUploader?.id ?? jobData.assigned_uploader_va_id,
        state_machine_history: [
          ...existingHistory,
          {
            from: jobData.status,
            to: "AWAITING_UPLOADER",
            timestamp: new Date().toISOString(),
            actor: session.userId,
            reason: "QC approved",
          },
        ],
        updated_at: new Date(),
      })
      .where(eq(contentJobs.id, jobId));

    // Side-effect only: auto-generate a thumbnail so it's ready before the
    // uploader VA opens the job. Non-blocking — a failure here must never
    // undo the QC approval, which has already committed.
    if (jobData.channel_id) {
      const redisUrl = process.env["REDIS_URL"];
      if (redisUrl) {
        const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
        try {
          const thumbnailQueue = createThumbnailQueue(conn);
          await thumbnailQueue.add(
            "thumbnail",
            {
              subjectKind: "content_job",
              subjectId: jobData.id,
              format: jobData.format,
              channelId: jobData.channel_id,
              title: jobData.title,
              topic: jobData.initial_topic ?? jobData.title,
              scriptExcerpt: firstNSentences(jobData.script ?? "", 5),
              language: "en",
            },
            { jobId: `thumbnail-${jobData.id}`, attempts: 2 },
          );
        } catch (thumbErr) {
          console.error(
            "Failed to enqueue content_job thumbnail (non-fatal):",
            thumbErr,
          );
        } finally {
          await conn.quit();
        }
      }
    }

    revalidatePath("/jobs");
    revalidatePath(`/jobs/${jobId}`);

    return { success: true };
  } catch (error) {
    console.error("Failed to approve QC:", error);
    return { success: false, error: "Failed to approve QC" };
  }
}

/**
 * Reject a job after QC review
 *
 * Transitions job from AWAITING_QC back to ROUTING_RENDER for re-render.
 *
 * @param jobId - Job ID
 * @param feedback - Reviewer feedback explaining the rejection
 * @returns Action result
 */
export async function rejectQC(
  jobId: string,
  feedback: string,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "review:qc")) {
    return { success: false, error: "Permission denied" };
  }

  if (!feedback.trim()) {
    return { success: false, error: "Feedback is required when rejecting" };
  }

  try {
    const job = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, jobId))
      .limit(1);

    if (job.length === 0) {
      return { success: false, error: "Job not found" };
    }

    const jobData = job[0];

    if (jobData.status !== "AWAITING_QC") {
      return { success: false, error: "Job is not awaiting QC review" };
    }

    const transitionResult = transitionJob(
      jobData.status as any,
      "ROUTING_RENDER" as any,
      jobData.paused_from_status as any,
    );
    if (!transitionResult.success) {
      return {
        success: false,
        error: `Invalid state transition: ${transitionResult.error.message}`,
      };
    }

    const existingHistory = (jobData.state_machine_history as Array<any>) || [];

    await db
      .update(contentJobs)
      .set({
        status: "ROUTING_RENDER",
        qc_reviewed_at: new Date(),
        qc_feedback: feedback.trim(),
        state_machine_history: [
          ...existingHistory,
          {
            from: jobData.status,
            to: "ROUTING_RENDER",
            timestamp: new Date().toISOString(),
            actor: session.userId,
            reason: `QC rejected: ${feedback.trim()}`,
          },
        ],
        updated_at: new Date(),
      })
      .where(eq(contentJobs.id, jobId));

    // Dispatch to render-heavy queue so the worker picks it up for re-render
    const redisUrl = process.env["REDIS_URL"];
    if (redisUrl) {
      const { createRenderHeavyQueue } = await import("@repo/queue");
      const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
      const renderQueue = createRenderHeavyQueue(conn);
      await renderQueue.add("route-render", { job_id: jobId, priority: 5 });
      await conn.quit();
    }

    revalidatePath("/jobs");
    revalidatePath(`/jobs/${jobId}`);

    return { success: true };
  } catch (error) {
    console.error("Failed to reject QC:", error);
    return { success: false, error: "Failed to reject QC" };
  }
}

/**
 * Assign a Production VA to a job
 *
 * @param jobId - Job ID
 * @param userId - User ID of the Production VA to assign
 * @returns Action result
 */
export async function assignProductionVA(
  jobId: string,
  userId: string,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "assign:job")) {
    return { success: false, error: "Permission denied" };
  }

  try {
    await db
      .update(contentJobs)
      .set({
        assigned_production_va_id: userId,
        updated_at: new Date(),
      })
      .where(eq(contentJobs.id, jobId));

    revalidatePath("/jobs");
    revalidatePath(`/jobs/${jobId}`);

    return { success: true };
  } catch (error) {
    console.error("Failed to assign Production VA:", error);
    return { success: false, error: "Failed to assign Production VA" };
  }
}

/**
 * Assign an Uploader VA to a job
 */
export async function assignUploaderVA(
  jobId: string,
  userId: string,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "assign:job")) {
    return { success: false, error: "Permission denied" };
  }

  try {
    await db
      .update(contentJobs)
      .set({
        assigned_uploader_va_id: userId,
        updated_at: new Date(),
      })
      .where(eq(contentJobs.id, jobId));

    revalidatePath("/jobs");
    revalidatePath(`/jobs/${jobId}`);

    return { success: true };
  } catch (error) {
    console.error("Failed to assign Uploader VA:", error);
    return { success: false, error: "Failed to assign Uploader VA" };
  }
}

/**
 * Create a new content job by dispatching to the ingest queue
 *
 * @param data - Job creation data
 * @returns Action result
 */
export async function createJob(data: {
  channel_id: string;
  template_id: string;
  format: string;
  production_version?: string;
  initial_topic?: string;
  script_text?: string;
  language?: string;
  image_generation_mode?: "auto" | "manual";
  narration_source_path?: string;
  metadata?: Record<string, unknown>;
  skip_research?: boolean;
}): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "create:job")) {
    return { success: false, error: "Permission denied" };
  }

  try {
    const redisUrl = process.env["REDIS_URL"];
    if (!redisUrl) {
      return { success: false, error: "Redis not configured" };
    }

    const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
    const ingestQueue = createIngestQueue(conn);

    await ingestQueue.add("ingest-job", {
      channel_id: data.channel_id,
      format: data.format as any,
      template_id: data.template_id,
      production_version: (data.production_version as any) || "V2",
      initial_topic: data.initial_topic || undefined,
      script_text: data.script_text || undefined,
      skip_image_qc: false,
      skip_final_qc: false,
      skip_research: data.skip_research ?? false,
      language: data.language ?? "en",
      image_generation_mode: data.image_generation_mode || "auto",
      narration_source_path: data.narration_source_path || undefined,
      metadata: data.metadata,
      aspect_ratio: "16:9",
    });

    await conn.quit();

    revalidatePath("/jobs");
    return { success: true };
  } catch (error) {
    console.error("Failed to create job:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create job",
    };
  }
}

/**
 * Approve image QC — transition AWAITING_IMAGE_QC → QMS_VALIDATING and dispatch to QMS queue.
 * VA has reviewed scene images and is satisfied — proceed to render.
 */
export async function approveImageQC(jobId: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "review:qc")) {
    return { success: false, error: "Permission denied" };
  }

  try {
    const [job] = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, jobId))
      .limit(1);
    if (!job) return { success: false, error: "Job not found" };
    if (job.status !== "AWAITING_IMAGE_QC") {
      return {
        success: false,
        error: `Job is not in AWAITING_IMAGE_QC (current: ${job.status})`,
      };
    }

    const transition = transitionJob(job.status as any, "QMS_VALIDATING");
    if (!transition.success)
      return {
        success: false,
        error: transition.error?.message ?? "Invalid transition",
      };

    await db
      .update(contentJobs)
      .set({ status: "QMS_VALIDATING", updated_at: new Date() })
      .where(eq(contentJobs.id, jobId));

    const redisUrl = process.env["REDIS_URL"];
    if (redisUrl) {
      const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
      const qmsQueue = createQMSValidationQueue(conn);
      await qmsQueue.add("validate-pre-render", {
        job_id: jobId,
        validation_stage: "pre-render",
      });
      await conn.quit();
    }

    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/jobs/${jobId}/image-qc`);
    return { success: true };
  } catch (error) {
    console.error("Failed to approve image QC:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to approve image QC",
    };
  }
}

/**
 * Regenerate a single scene image — re-dispatches to ai-generation queue.
 * Used from the image QC page when a scene image is missing or unsatisfactory.
 */
export async function regenerateSceneImage(
  jobId: string,
  sceneIndex: number,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "review:qc")) {
    return { success: false, error: "Permission denied" };
  }

  try {
    const [job] = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, jobId))
      .limit(1);
    if (!job) return { success: false, error: "Job not found" };

    const manifest = job.assembly_manifest as any;
    const scene = manifest?.scenes?.find(
      (s: any) => s.scene_index === sceneIndex,
    );
    if (!scene)
      return { success: false, error: `Scene ${sceneIndex} not found` };

    // Clear the existing visual_asset_key for this scene so asset-collection re-dispatches it
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      UPDATE content_jobs
      SET
        assembly_manifest = jsonb_set(
          COALESCE(assembly_manifest, '{"scenes":[]}'::jsonb),
          ${`{scenes,${sceneIndex},visual_asset_key}`},
          'null'::jsonb
        ),
        updated_at = NOW()
      WHERE id = ${jobId}
    `);

    const redisUrl = process.env["REDIS_URL"];
    if (redisUrl) {
      const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
      const { createAIGenerationQueue } = await import("@repo/queue");
      const aiQueue = createAIGenerationQueue(conn);
      await aiQueue.add(`regenerate-scene-image-${sceneIndex}`, {
        job_id: jobId,
        generation_type: "scene_image" as const,
        scene_index: sceneIndex,
        image_prompt: scene.image_prompt ?? "",
        enriched_image_prompt: scene.enriched_image_prompt ?? undefined,
        aspect_ratio: "16:9",
      });
      await conn.quit();
    }

    revalidatePath(`/jobs/${jobId}/image-qc`);
    return { success: true };
  } catch (error) {
    console.error("Failed to regenerate scene image:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to regenerate scene image",
    };
  }
}

/**
 * Replace a scene image with a VA-uploaded custom image.
 * Saves to local storage, updates r2_asset_manifest and assembly_manifest.visual_asset_key.
 */
export async function replaceSceneImage(
  jobId: string,
  sceneIndex: number,
  formData: FormData,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "review:qc")) {
    return { success: false, error: "Permission denied" };
  }

  try {
    const [job] = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, jobId))
      .limit(1);
    if (!job) return { success: false, error: "Job not found" };

    const file = formData.get("file") as File | null;
    if (!file) return { success: false, error: "No file provided" };
    if (!file.type.startsWith("image/"))
      return { success: false, error: "File must be an image" };

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { uploadAsset, generateAssetKey } =
      await import("@/lib/services/r2-service");
    const extension = file.name.split(".").pop() || "jpg";
    const assetKey = generateAssetKey(
      job.channel_id,
      jobId,
      `scene-${sceneIndex}-custom`,
      extension,
    );

    const assetInfo = await uploadAsset({
      key: assetKey,
      buffer,
      contentType: file.type,
      metadata: {
        asset_type: "image/broll",
        scene_index: String(sceneIndex),
        uploaded_by: session.userId,
        source: "manual_upload",
      },
    });

    // Update assembly_manifest visual_asset_key and r2_asset_manifest
    const { sql } = await import("drizzle-orm");
    const currentManifest =
      (job.r2_asset_manifest as Array<{
        key: string;
        type: string;
        size_bytes: number;
        scene_index?: number;
      }>) || [];
    const updatedManifest = [
      // Remove any existing image/broll entry for this scene
      ...currentManifest.filter(
        (a) => !(a.type === "image/broll" && a.scene_index === sceneIndex),
      ),
      {
        key: assetInfo.key,
        type: "image/broll",
        size_bytes: assetInfo.size_bytes,
        scene_index: sceneIndex,
      },
    ];

    await db.execute(sql`
      UPDATE content_jobs
      SET
        assembly_manifest = jsonb_set(
          COALESCE(assembly_manifest, '{"scenes":[]}'::jsonb),
          ${`{scenes,${sceneIndex},visual_asset_key}`},
          ${JSON.stringify(assetKey)}::jsonb
        ),
        r2_asset_manifest = ${JSON.stringify(updatedManifest)}::jsonb,
        updated_at = NOW()
      WHERE id = ${jobId}
    `);

    revalidatePath(`/jobs/${jobId}/image-qc`);
    return { success: true };
  } catch (error) {
    console.error("Failed to replace scene image:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to replace scene image",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Human-in-the-loop routing: queues, soft claims, next-item handout
// ─────────────────────────────────────────────────────────────────────────────
//
// Several VAs work these gates at the same time. Every getNext* query used to be
// `ORDER BY updated_at LIMIT 1` with no notion of who is already on a job, so
// two people were routinely handed the SAME item and both did the work.
//
// There is no task-queue table and no human lease column on content_jobs
// (`worker_lease_id` belongs to the machine workers and must not be borrowed —
// a worker reclaiming a job would stomp a VA's "claim" and vice versa). Rather
// than invent an assignment system with a migration, this is a SOFT CLAIM: a
// short-lived advisory lock, in Redis when REDIS_URL is configured (survives a
// hub-web restart, correct across processes) and in-process otherwise.
//
// A claim only affects ROUTING — which job the next-item handout gives you. It
// never blocks anyone from opening a job by URL and never gates an approval, so
// an expired or lost claim degrades to today's behaviour instead of locking work
// out. Claims are not released on approve: the job leaves the queue's status, so
// it drops out of the candidate query anyway and the key just expires.

type HITLQueue = "image-qc" | "final-qc" | "production-va" | "va-review";

const HITL_QUEUE_STATUS: Record<HITLQueue, string> = {
  "image-qc": "AWAITING_IMAGE_QC",
  "final-qc": "AWAITING_QC",
  "production-va": "AWAITING_PRODUCTION_VA",
  "va-review": "AWAITING_VA_REVIEW",
};

/** How long a claim survives without being renewed, per queue handling time. */
const HITL_CLAIM_TTL_MS: Record<HITLQueue, number> = {
  "image-qc": 15 * 60_000,
  "final-qc": 15 * 60_000,
  "production-va": 30 * 60_000,
  // B-roll selection is the 15–45 min gate; a short TTL would hand the job to a
  // second VA while the first is still trimming.
  "va-review": 60 * 60_000,
};

/** After you skip a job, you are not handed it again for this long. */
const HITL_SKIP_TTL_MS = 30 * 60_000;

/** How many queue entries to walk before giving up on finding a free one. */
const HITL_CLAIM_SCAN_LIMIT = 50;

const claimKey = (jobId: string) => `hitl:claim:${jobId}`;
const skipKey = (ownerId: string, jobId: string) =>
  `hitl:skip:${ownerId}:${jobId}`;

/** In-process fallback used when REDIS_URL is not configured. */
const memoryClaims = new Map<string, { value: string; expiresAt: number }>();

function memoryGet(key: string): string | null {
  const hit = memoryClaims.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    memoryClaims.delete(key);
    return null;
  }
  return hit.value;
}

function memorySetNX(key: string, value: string, ttlMs: number): boolean {
  if (memoryGet(key) !== null) return false;
  memoryClaims.set(key, { value, expiresAt: Date.now() + ttlMs });
  return true;
}

/** Lazily-created, module-scoped Redis client. `null` = not configured. */
let hitlRedis: ReturnType<typeof createRedisConnection> | null | undefined;

function getHITLRedis(): ReturnType<typeof createRedisConnection> | null {
  if (hitlRedis !== undefined) return hitlRedis;
  const url = process.env["REDIS_URL"];
  if (!url) {
    hitlRedis = null;
    return null;
  }
  try {
    hitlRedis = createRedisConnection({ url, mode: "queue" });
  } catch (error) {
    console.error("HITL claims: Redis unavailable, using in-process claims", {
      error: error instanceof Error ? error.message : String(error),
    });
    hitlRedis = null;
  }
  return hitlRedis;
}

/** Read the current owner of a claim, or null when unclaimed/expired. */
async function claimOwnerOf(jobId: string): Promise<string | null> {
  const redis = getHITLRedis();
  if (!redis) return memoryGet(claimKey(jobId));
  try {
    return await redis.get(claimKey(jobId));
  } catch {
    return memoryGet(claimKey(jobId));
  }
}

/** Owners for many jobs at once (dropdowns / worklists). */
async function claimOwnersOf(
  jobIds: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (jobIds.length === 0) return out;
  const redis = getHITLRedis();
  if (redis) {
    try {
      const values = await redis.mget(...jobIds.map(claimKey));
      jobIds.forEach((id, i) => out.set(id, values[i] ?? null));
      return out;
    } catch {
      /* fall through to in-process */
    }
  }
  for (const id of jobIds) out.set(id, memoryGet(claimKey(id)));
  return out;
}

/**
 * Take (or renew) the claim on a job. Returns false when somebody else holds it.
 */
async function tryClaimJob(
  jobId: string,
  ownerId: string,
  ttlMs: number,
): Promise<boolean> {
  const redis = getHITLRedis();
  if (!redis) {
    const key = claimKey(jobId);
    if (memorySetNX(key, ownerId, ttlMs)) return true;
    if (memoryGet(key) !== ownerId) return false;
    memoryClaims.set(key, { value: ownerId, expiresAt: Date.now() + ttlMs });
    return true;
  }
  try {
    const key = claimKey(jobId);
    const taken = await redis.set(key, ownerId, "PX", ttlMs, "NX");
    if (taken === "OK") return true;
    const current = await redis.get(key);
    if (current !== ownerId) return false;
    // Ours already — renew so a long review does not expire mid-flight.
    await redis.pexpire(key, ttlMs);
    return true;
  } catch {
    return memorySetNX(claimKey(jobId), ownerId, ttlMs);
  }
}

async function releaseClaim(jobId: string, ownerId: string): Promise<void> {
  const redis = getHITLRedis();
  if (!redis) {
    if (memoryGet(claimKey(jobId)) === ownerId)
      memoryClaims.delete(claimKey(jobId));
    return;
  }
  try {
    const current = await redis.get(claimKey(jobId));
    if (current === ownerId) await redis.del(claimKey(jobId));
  } catch {
    if (memoryGet(claimKey(jobId)) === ownerId)
      memoryClaims.delete(claimKey(jobId));
  }
}

async function rememberSkip(jobId: string, ownerId: string): Promise<void> {
  const redis = getHITLRedis();
  const key = skipKey(ownerId, jobId);
  if (!redis) {
    memoryClaims.set(key, {
      value: "1",
      expiresAt: Date.now() + HITL_SKIP_TTL_MS,
    });
    return;
  }
  try {
    await redis.set(key, "1", "PX", HITL_SKIP_TTL_MS);
  } catch {
    memoryClaims.set(key, {
      value: "1",
      expiresAt: Date.now() + HITL_SKIP_TTL_MS,
    });
  }
}

async function skippedRecently(
  jobIds: string[],
  ownerId: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (jobIds.length === 0) return out;
  const redis = getHITLRedis();
  if (redis) {
    try {
      const values = await redis.mget(
        ...jobIds.map((id) => skipKey(ownerId, id)),
      );
      jobIds.forEach((id, i) => {
        if (values[i]) out.add(id);
      });
      return out;
    } catch {
      /* fall through */
    }
  }
  for (const id of jobIds) {
    if (memoryGet(skipKey(ownerId, id)) !== null) out.add(id);
  }
  return out;
}

/** The ids currently parked in a queue, oldest first. */
async function queueJobIds(
  queue: HITLQueue,
  excludeJobId: string | undefined,
  limit: number,
): Promise<string[]> {
  const conditions = [
    eq(contentJobs.status, HITL_QUEUE_STATUS[queue] as any),
    ...(excludeJobId ? [ne(contentJobs.id, excludeJobId)] : []),
  ];
  const rows = await db
    .select({ id: contentJobs.id })
    .from(contentJobs)
    .where(and(...conditions))
    .orderBy(asc(contentJobs.updated_at))
    .limit(limit);
  return rows.map((r) => r.id);
}

interface NextHITLJobResult {
  jobId: string | null;
  /** How many jobs are parked in this queue right now (excluding the current). */
  remaining: number;
  /**
   * True when there ARE jobs left but every one of them is claimed by another
   * VA (or was just skipped by you). The UI must say that rather than pretend
   * the queue is empty.
   */
  allClaimed: boolean;
}

/**
 * Hand out the next job in a HITL queue and claim it for the caller.
 *
 * Walks the queue oldest-first and returns the first job that is neither
 * claimed by somebody else nor skipped by this user in the last 30 minutes.
 */
export async function claimNextHITLJob(
  queue: HITLQueue,
  excludeJobId?: string,
): Promise<NextHITLJobResult> {
  const session = await getSession();
  if (!session) return { jobId: null, remaining: 0, allClaimed: false };

  const ids = await queueJobIds(queue, excludeJobId, HITL_CLAIM_SCAN_LIMIT);
  if (ids.length === 0) {
    return { jobId: null, remaining: 0, allClaimed: false };
  }

  const skipped = await skippedRecently(ids, session.userId);
  const ttl = HITL_CLAIM_TTL_MS[queue];

  for (const id of ids) {
    if (skipped.has(id)) continue;
    if (await tryClaimJob(id, session.userId, ttl)) {
      return { jobId: id, remaining: ids.length, allClaimed: false };
    }
  }

  return { jobId: null, remaining: ids.length, allClaimed: true };
}

/**
 * Claim a specific job for the current user — called when a VA opens a gate
 * directly (URL, worklist row, queue dropdown) so that everybody else's
 * next-item handout routes around it.
 *
 * Returns who holds the claim; `mine: false` means someone else is on it and
 * the UI should warn rather than silently double-book the work.
 */
export async function claimHITLJob(
  queue: HITLQueue,
  jobId: string,
): Promise<{ mine: boolean; ownerId: string | null }> {
  const session = await getSession();
  if (!session) return { mine: false, ownerId: null };
  const mine = await tryClaimJob(
    jobId,
    session.userId,
    HITL_CLAIM_TTL_MS[queue],
  );
  if (mine) return { mine: true, ownerId: session.userId };
  return { mine: false, ownerId: await claimOwnerOf(jobId) };
}

/**
 * Skip a job: drop our claim so another VA can pick it up, remember not to hand
 * it back to US for a while, and route on to the next free item.
 */
export async function skipHITLJob(
  queue: HITLQueue,
  jobId: string,
): Promise<NextHITLJobResult> {
  const session = await getSession();
  if (!session) return { jobId: null, remaining: 0, allClaimed: false };
  await releaseClaim(jobId, session.userId);
  await rememberSkip(jobId, session.userId);
  return claimNextHITLJob(queue, jobId);
}

/** Drop our claim without recording a skip (used when leaving a gate). */
export async function releaseHITLJob(jobId: string): Promise<void> {
  const session = await getSession();
  if (!session) return;
  await releaseClaim(jobId, session.userId);
}

/**
 * Get next job awaiting image QC (excluding the current one).
 * Used for "next job" navigation after approve or skip on image-qc page.
 * Claims the job it hands out — see claimNextHITLJob.
 */
export async function getNextImageQCJob(
  excludeJobId: string,
): Promise<{ jobId: string | null }> {
  const { jobId } = await claimNextHITLJob("image-qc", excludeJobId);
  return { jobId };
}

/**
 * Get next job awaiting final QC (excluding the current one).
 * Used for "next job" navigation after approve on final video QC page.
 * Claims the job it hands out — see claimNextHITLJob.
 */
export async function getNextQCJob(
  excludeJobId: string,
): Promise<{ jobId: string | null }> {
  const { jobId } = await claimNextHITLJob("final-qc", excludeJobId);
  return { jobId };
}

/**
 * Get the next job parked at AWAITING_VA_REVIEW (B-Roll Selection Studio).
 * Claims the job it hands out — see claimNextHITLJob.
 */
export async function getNextVAReviewJob(
  excludeJobId?: string,
): Promise<{ jobId: string | null }> {
  const { jobId } = await claimNextHITLJob("va-review", excludeJobId);
  return { jobId };
}

/**
 * Get QC queue statistics.
 * Returns count of jobs awaiting QC and jobs with render errors.
 */
export async function getQCStats(): Promise<{
  awaitingQCCount: number;
  errorCount: number;
}> {
  const [awaitingCount] = await db
    .select({ count: count() })
    .from(contentJobs)
    .where(eq(contentJobs.status, "AWAITING_QC" as any));

  const [errorCount] = await db
    .select({ count: count() })
    .from(contentJobs)
    .where(
      and(
        eq(contentJobs.status, "AWAITING_QC" as any),
        isNotNull(contentJobs.error_message),
      ),
    );

  return {
    awaitingQCCount: awaitingCount?.count ?? 0,
    errorCount: errorCount?.count ?? 0,
  };
}

/**
 * Get next production VA job waiting for HeyGen upload.
 * Excludes the current job from results.
 */
export async function getNextProductionVAJob(
  excludeJobId: string,
): Promise<{ jobId: string | null }> {
  const { jobId } = await claimNextHITLJob("production-va", excludeJobId);
  return { jobId };
}

/**
 * Get production VA queue statistics.
 * Returns count of jobs awaiting production VA and jobs with upload errors.
 */
export async function getProductionVAStats(): Promise<{
  awaitingProductionVACount: number;
  errorCount: number;
}> {
  const [awaitingCount] = await db
    .select({ count: count() })
    .from(contentJobs)
    .where(eq(contentJobs.status, "AWAITING_PRODUCTION_VA" as any));

  const [errorCount] = await db
    .select({ count: count() })
    .from(contentJobs)
    .where(
      and(
        eq(contentJobs.status, "AWAITING_PRODUCTION_VA" as any),
        isNotNull(contentJobs.error_message),
      ),
    );

  return {
    awaitingProductionVACount: awaitingCount?.count ?? 0,
    errorCount: errorCount?.count ?? 0,
  };
}

/**
 * Set the narration source path for a job.
 * Called after a file has been saved via /api/narration-upload.
 */
export async function setNarrationSource(
  jobId: string,
  filePath: string,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "create:job")) {
    return { success: false, error: "Permission denied" };
  }

  const [job] = await db
    .select({
      id: contentJobs.id,
      narration_source_path: contentJobs.narration_source_path,
    })
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);

  if (!job) return { success: false, error: "Job not found" };

  // Delete previous narration source file if one exists
  if (job.narration_source_path) {
    await unlink(job.narration_source_path).catch(() => {});
  }

  await db
    .update(contentJobs)
    .set({ narration_source_path: filePath, updated_at: new Date() })
    .where(eq(contentJobs.id, jobId));

  return { success: true };
}

/**
 * Approve comparison VA review — AWAITING_PRODUCTION_VA → QMS_VALIDATING.
 *
 * Called when the VA has:
 *   1. Uploaded a hero image for both Product A and Product B
 *   2. Confirmed the data grid (audited_at is set)
 *
 * Source verification (facts_sources_verified_count ≥ 1) is encouraged but not
 * a hard gate here — QMS handles that check and can surface it as a warning.
 */
export async function approveComparisonVAReview(
  jobId: string,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "upload:heygen-footage")) {
    return { success: false, error: "Permission denied" };
  }

  const [job] = await db
    .select({
      id: contentJobs.id,
      format: contentJobs.format,
      status: contentJobs.status,
      paused_from_status: contentJobs.paused_from_status,
      metadata: contentJobs.metadata,
      state_machine_history: contentJobs.state_machine_history,
    })
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);

  if (!job) return { success: false, error: "Job not found" };
  if (job.format !== "TECH_COMPARISON") {
    return { success: false, error: "Not a comparison job" };
  }
  if (job.status !== "AWAITING_PRODUCTION_VA") {
    return {
      success: false,
      error: `Job is in ${job.status} — expected AWAITING_PRODUCTION_VA`,
    };
  }

  const meta = (job.metadata as Record<string, unknown>) ?? {};
  const comp = (meta["comparison"] as Record<string, unknown>) ?? {};
  const products: Array<Record<string, unknown>> =
    (comp["products"] as Array<Record<string, unknown>>) ?? [];
  const dataGrid = comp["data_grid"] as
    | Record<string, unknown>
    | null
    | undefined;

  // Validate that both hero images are set
  const productA = products.find((p) => p["slot"] === "A");
  const productB = products.find((p) => p["slot"] === "B");
  if (!productA?.["hero_asset_key"]) {
    return {
      success: false,
      error: "Product A hero image has not been uploaded",
    };
  }
  if (!productB?.["hero_asset_key"]) {
    return {
      success: false,
      error: "Product B hero image has not been uploaded",
    };
  }

  // Validate that data grid has been audited
  if (!dataGrid?.["audited_at"]) {
    return {
      success: false,
      error: "Data grid has not been audited — confirm the data grid first",
    };
  }

  // Validate state transition via domain state machine
  const transitionResult = transitionJob(
    job.status as any,
    "QMS_VALIDATING" as any,
    job.paused_from_status as any,
  );
  if (!transitionResult.success) {
    return {
      success: false,
      error: `Invalid state transition: ${transitionResult.error.message}`,
    };
  }

  const existingHistory = (job.state_machine_history as Array<any>) ?? [];

  await db
    .update(contentJobs)
    .set({
      status: "QMS_VALIDATING",
      state_machine_history: [
        ...existingHistory,
        {
          from: job.status,
          to: "QMS_VALIDATING",
          timestamp: new Date().toISOString(),
          actor: session.userId,
          reason: "Comparison VA review approved",
        },
      ],
      updated_at: new Date(),
    })
    .where(eq(contentJobs.id, jobId));

  // Dispatch to QMS queue so the worker picks it up immediately
  try {
    const redisUrl = process.env["REDIS_URL"] ?? "";
    const redis = createRedisConnection(redisUrl);
    const qmsQueue = createQMSValidationQueue(redis);
    await qmsQueue.add("validate-pre-render", {
      job_id: jobId,
      validation_stage: "pre-render",
    });
    await redis.quit();
  } catch (queueErr) {
    console.error(
      "[approveComparisonVAReview] Failed to dispatch QMS job:",
      queueErr,
    );
    // Non-fatal: status is already updated; QMS will be picked up on next poll
  }

  revalidatePath(`/jobs/${jobId}`);
  return { success: true };
}

/**
 * Clear the narration source for a job and delete the file from disk.
 */
export async function clearNarrationSource(
  jobId: string,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "create:job")) {
    return { success: false, error: "Permission denied" };
  }

  const [job] = await db
    .select({
      id: contentJobs.id,
      narration_source_path: contentJobs.narration_source_path,
    })
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);

  if (!job) return { success: false, error: "Job not found" };

  if (job.narration_source_path) {
    await unlink(job.narration_source_path).catch(() => {});
  }

  await db
    .update(contentJobs)
    .set({ narration_source_path: null, updated_at: new Date() })
    .where(eq(contentJobs.id, jobId));

  return { success: true };
}

/**
 * Update QC skip flags for a job
 *
 * @param jobId - Job ID
 * @param settings - QC settings to update (skip_image_qc and/or skip_final_qc)
 * @returns Action result
 */
export async function updateJobQCSettings(
  jobId: string,
  settings: { skip_image_qc?: boolean; skip_final_qc?: boolean },
): Promise<ActionResult> {
  "use server";
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:job")) {
    return { success: false, error: "Permission denied" };
  }

  try {
    await db
      .update(contentJobs)
      .set({
        ...settings,
        updated_at: new Date(),
      })
      .where(eq(contentJobs.id, jobId));

    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/jobs");

    return { success: true };
  } catch (error) {
    console.error("Failed to update QC settings:", error);
    return { success: false, error: "Failed to update QC settings" };
  }
}

/**
 * Get all HITL jobs by type for navigation
 * Returns jobs in queue order (by updated_at, oldest first), annotated with who
 * is currently on each one so the queue dropdown can show "taken" instead of
 * routing a second VA into work somebody else is already doing.
 */
export async function getHITLJobsByStatus(
  status:
    | "AWAITING_IMAGE_QC"
    | "AWAITING_QC"
    | "AWAITING_PRODUCTION_VA"
    | "AWAITING_VA_REVIEW",
): Promise<
  Array<{
    id: string;
    title?: string;
    claimedByOther?: boolean;
    mine?: boolean;
  }>
> {
  const session = await getSession();
  const jobs = await db
    .select({
      id: contentJobs.id,
      title: contentJobs.title,
    })
    .from(contentJobs)
    .where(eq(contentJobs.status, status as any))
    .orderBy(asc(contentJobs.updated_at));

  const owners = await claimOwnersOf(jobs.map((j) => j.id));

  return jobs.map((job) => {
    const owner = owners.get(job.id) ?? null;
    return {
      ...job,
      mine: owner !== null && owner === session?.userId,
      claimedByOther: owner !== null && owner !== session?.userId,
    };
  });
}

/**
 * Get HITL queue statistics for all queue types
 */
export async function getHITLStats(): Promise<{
  imageQCCount: number;
  finalQCCount: number;
  productionVACount: number;
  vaReviewCount: number;
}> {
  const [imageQCCount] = await db
    .select({ count: count() })
    .from(contentJobs)
    .where(eq(contentJobs.status, "AWAITING_IMAGE_QC" as any));

  const [finalQCCount] = await db
    .select({ count: count() })
    .from(contentJobs)
    .where(eq(contentJobs.status, "AWAITING_QC" as any));

  const [productionVACount] = await db
    .select({ count: count() })
    .from(contentJobs)
    .where(eq(contentJobs.status, "AWAITING_PRODUCTION_VA" as any));

  const [vaReviewCount] = await db
    .select({ count: count() })
    .from(contentJobs)
    .where(eq(contentJobs.status, "AWAITING_VA_REVIEW" as any));

  return {
    imageQCCount: imageQCCount?.count ?? 0,
    finalQCCount: finalQCCount?.count ?? 0,
    productionVACount: productionVACount?.count ?? 0,
    vaReviewCount: vaReviewCount?.count ?? 0,
  };
}

/**
 * Worklist for the B-Roll Selection Studio (AWAITING_VA_REVIEW).
 *
 * This is the heaviest human gate in the system (15–45 min per job) and until
 * now it had no list at all: the only link to /jobs/[id]/va-review lived on the
 * job detail page, so a VA had to find each job through the generic jobs list
 * and click in. Returns queue order (oldest first) plus per-job block progress
 * and claim state.
 */
export async function getVAReviewWorklist(): Promise<
  Array<{
    id: string;
    topic: string;
    format: string;
    blocksTotal: number;
    blocksPending: number;
    waitingSince: string;
    claimedByOther: boolean;
    mine: boolean;
  }>
> {
  const session = await getSession();

  const rows = await db
    .select({
      id: contentJobs.id,
      title: contentJobs.title,
      format: contentJobs.format,
      metadata: contentJobs.metadata,
      status_updated_at: contentJobs.status_updated_at,
    })
    .from(contentJobs)
    .where(eq(contentJobs.status, "AWAITING_VA_REVIEW" as any))
    .orderBy(asc(contentJobs.updated_at));

  const owners = await claimOwnersOf(rows.map((r) => r.id));

  return rows.map((row) => {
    const ranking = extractRanking(row.metadata);
    const owner = owners.get(row.id) ?? null;
    return {
      id: row.id,
      topic: ranking?.topic ?? row.title ?? "Untitled",
      format: String(row.format),
      blocksTotal: ranking ? rankedCount(ranking) : 0,
      blocksPending: ranking ? pendingCount(ranking) : 0,
      waitingSince: new Date(row.status_updated_at).toISOString(),
      mine: owner !== null && owner === session?.userId,
      claimedByOther: owner !== null && owner !== session?.userId,
    };
  });
}
