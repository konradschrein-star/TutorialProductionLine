/**
 * Job Repository
 *
 * Centralized data access layer for content_jobs table.
 * All job-related database operations should go through this repository.
 *
 * Features:
 * - CRUD operations with type safety
 * - Transaction support for atomic operations
 * - Status transition helpers
 * - State machine history tracking
 * - Asset manifest operations
 */

import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { contentJobs } from "../schema/content-jobs.js";
import type { Transaction } from "./transaction.js";
import { getDbOrTx } from "./transaction.js";
import type { JobStatus } from "@repo/contracts";

// Type for inserting a new job
export type NewJob = typeof contentJobs.$inferInsert;

// Type for a complete job record
export type Job = typeof contentJobs.$inferSelect;

// Type for updating a job
export type JobUpdate = Partial<Omit<Job, "id" | "created_at">>;

/**
 * Create a new job
 *
 * @param data - Job data to insert
 * @param tx - Optional transaction
 * @returns Created job
 */
export async function createJob(
  data: NewJob,
  tx?: Transaction
): Promise<Job> {
  const db = getDbOrTx(tx);

  const [job] = await db
    .insert(contentJobs)
    .values({
      ...data,
      status_updated_at: new Date(),
      state_machine_history: data.state_machine_history || [],
    })
    .returning();

  if (!job) {
    throw new Error("Failed to create job");
  }

  return job;
}

/**
 * Get job by ID
 *
 * @param id - Job ID
 * @param tx - Optional transaction
 * @returns Job or null if not found
 */
export async function getJobById(
  id: string,
  tx?: Transaction
): Promise<Job | null> {
  const db = getDbOrTx(tx);

  const [job] = await db
    .select()
    .from(contentJobs)
    .where(eq(contentJobs.id, id))
    .limit(1);

  return job || null;
}

/**
 * Get multiple jobs by IDs
 *
 * @param ids - Array of job IDs
 * @param tx - Optional transaction
 * @returns Array of jobs
 */
export async function getJobsByIds(
  ids: string[],
  tx?: Transaction
): Promise<Job[]> {
  if (ids.length === 0) return [];

  const db = getDbOrTx(tx);

  return await db
    .select()
    .from(contentJobs)
    .where(inArray(contentJobs.id, ids));
}

/**
 * Get jobs by status
 *
 * @param status - Job status
 * @param limit - Optional limit (default: 100)
 * @param tx - Optional transaction
 * @returns Array of jobs
 */
export async function getJobsByStatus(
  status: JobStatus,
  limit: number = 100,
  tx?: Transaction
): Promise<Job[]> {
  const db = getDbOrTx(tx);

  return await db
    .select()
    .from(contentJobs)
    .where(eq(contentJobs.status, status))
    .orderBy(desc(contentJobs.created_at))
    .limit(limit);
}

/**
 * Get jobs by channel
 *
 * @param channelId - Channel ID
 * @param limit - Optional limit (default: 100)
 * @param tx - Optional transaction
 * @returns Array of jobs
 */
export async function getJobsByChannel(
  channelId: string,
  limit: number = 100,
  tx?: Transaction
): Promise<Job[]> {
  const db = getDbOrTx(tx);

  return await db
    .select()
    .from(contentJobs)
    .where(eq(contentJobs.channel_id, channelId))
    .orderBy(desc(contentJobs.created_at))
    .limit(limit);
}

/**
 * Update job by ID
 *
 * @param id - Job ID
 * @param data - Fields to update
 * @param tx - Optional transaction
 * @returns Updated job
 */
export async function updateJob(
  id: string,
  data: JobUpdate,
  tx?: Transaction
): Promise<Job> {
  const db = getDbOrTx(tx);

  const [job] = await db
    .update(contentJobs)
    .set({
      ...data,
      updated_at: new Date(),
    })
    .where(eq(contentJobs.id, id))
    .returning();

  if (!job) {
    throw new Error(`Job ${id} not found`);
  }

  return job;
}

/**
 * Update job status with state machine history tracking
 *
 * @param id - Job ID
 * @param newStatus - New status
 * @param reason - Optional reason for the transition
 * @param tx - Optional transaction
 * @returns Updated job
 */
export async function updateJobStatus(
  id: string,
  newStatus: JobStatus,
  reason?: string,
  tx?: Transaction
): Promise<Job> {
  const db = getDbOrTx(tx);

  // Get current job to append to history
  const currentJob = await getJobById(id, tx);
  if (!currentJob) {
    throw new Error(`Job ${id} not found`);
  }

  const historyEntry = {
    from_status: currentJob.status,
    to_status: newStatus,
    timestamp: new Date().toISOString(),
    reason,
  };

  const newHistory = [...(currentJob.state_machine_history || []), historyEntry];

  return await updateJob(
    id,
    {
      status: newStatus,
      status_updated_at: new Date(),
      state_machine_history: newHistory,
    },
    tx
  );
}

/**
 * Update job asset manifest
 *
 * @param id - Job ID
 * @param manifest - New asset manifest (JSONB)
 * @param tx - Optional transaction
 * @returns Updated job
 */
export async function updateJobAssetManifest(
  id: string,
  manifest: any,
  tx?: Transaction
): Promise<Job> {
  return await updateJob(
    id,
    {
      r2_asset_manifest: manifest,
    },
    tx
  );
}

/**
 * Delete job by ID
 *
 * @param id - Job ID
 * @param tx - Optional transaction
 */
export async function deleteJob(
  id: string,
  tx?: Transaction
): Promise<void> {
  const db = getDbOrTx(tx);

  await db.delete(contentJobs).where(eq(contentJobs.id, id));
}

/**
 * Get job count by status
 *
 * @param status - Optional status filter
 * @param tx - Optional transaction
 * @returns Count of jobs
 */
export async function getJobCount(
  status?: JobStatus,
  tx?: Transaction
): Promise<number> {
  const db = getDbOrTx(tx);

  const query = db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(contentJobs);

  if (status) {
    query.where(eq(contentJobs.status, status));
  }

  const [result] = await query;
  return result?.count || 0;
}

/**
 * Get stale render jobs
 *
 * Returns jobs stuck in RENDERING_REMOTION or RENDERING_FFMPEG for more than a threshold.
 *
 * @param thresholdMinutes - Minutes since last update (default: 120)
 * @param tx - Optional transaction
 * @returns Array of stale jobs
 */
export async function getStaleRenderJobs(
  thresholdMinutes: number = 120,
  tx?: Transaction
): Promise<Job[]> {
  const db = getDbOrTx(tx);

  const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);

  return await db
    .select()
    .from(contentJobs)
    .where(
      and(
        sql`${contentJobs.status} IN ('RENDERING_REMOTION', 'RENDERING_FFMPEG')`,
        sql`${contentJobs.updated_at} < ${threshold}`
      )
    );
}

/**
 * Assign production VA to job
 *
 * @param id - Job ID
 * @param vaId - VA user ID
 * @param tx - Optional transaction
 * @returns Updated job
 */
export async function assignProductionVA(
  id: string,
  vaId: string,
  tx?: Transaction
): Promise<Job> {
  return await updateJob(
    id,
    {
      assigned_production_va_id: vaId,
    },
    tx
  );
}

/**
 * Assign uploader VA to job
 *
 * @param id - Job ID
 * @param vaId - VA user ID
 * @param tx - Optional transaction
 * @returns Updated job
 */
export async function assignUploaderVA(
  id: string,
  vaId: string,
  tx?: Transaction
): Promise<Job> {
  return await updateJob(
    id,
    {
      assigned_uploader_va_id: vaId,
    },
    tx
  );
}
