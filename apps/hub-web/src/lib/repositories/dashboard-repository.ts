import { sql, desc } from 'drizzle-orm';
import { db, contentJobs, systemEvents } from '../db';

/**
 * Dashboard Repository
 *
 * Data access layer for dashboard metrics and visualizations.
 * Provides aggregated data for job status counts, queue health, and activity timeline.
 */

export interface JobStatusCount {
  status: string;
  count: number;
}

export interface PipelineStageCount {
  stage: string;
  count: number;
  status: string;
}

export interface RecentActivity {
  id: string;
  eventType: string;
  jobId: string | null;
  payload: any;
  timestamp: Date;
}

/**
 * Get job counts grouped by status
 *
 * @returns Array of status counts
 */
export async function getJobStatusCounts(): Promise<JobStatusCount[]> {
  const result = await db
    .select({
      status: contentJobs.status,
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(contentJobs)
    .groupBy(contentJobs.status);

  return result.map((row) => ({
    status: row.status,
    count: row.count,
  }));
}

/**
 * Get total job count
 *
 * @returns Total number of jobs
 */
export async function getTotalJobCount(): Promise<number> {
  const result = await db
    .select({
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(contentJobs);

  return result[0]?.count || 0;
}

/**
 * Get active pipeline jobs count
 * (jobs not in terminal states: PUBLISHED, FAILED_QMS, FAILED_RENDER, FAILED_UPLOAD)
 *
 * @returns Count of active jobs
 */
export async function getActivePipelineCount(): Promise<number> {
  const terminalStatuses = [
    'PUBLISHED',
    'FAILED_QMS',
    'FAILED_RENDER',
    'FAILED_UPLOAD',
  ];

  const result = await db
    .select({
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(contentJobs)
    .where(
      sql`${contentJobs.status} NOT IN (${sql.join(
        terminalStatuses.map((s) => sql`${s}`),
        sql`, `
      )})`
    );

  return result[0]?.count || 0;
}

/**
 * Get failed jobs count
 * (jobs in any FAILED_* state)
 *
 * @returns Count of failed jobs
 */
export async function getFailedJobsCount(): Promise<number> {
  const result = await db
    .select({
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(contentJobs)
    .where(sql`${contentJobs.status}::text LIKE 'FAILED_%'`);

  return result[0]?.count || 0;
}

/**
 * Get recent system events for activity timeline
 *
 * @param limit - Number of events to fetch
 * @returns Array of recent events
 */
export async function getRecentActivity(
  limit: number = 50
): Promise<RecentActivity[]> {
  const result = await db
    .select()
    .from(systemEvents)
    .orderBy(desc(systemEvents.timestamp))
    .limit(limit);

  return result.map((event) => ({
    id: event.id,
    eventType: event.event_type,
    jobId: event.job_id,
    payload: event.payload,
    timestamp: event.timestamp,
  }));
}

/**
 * Get job counts by current pipeline stage
 * Groups jobs by their current status
 *
 * @returns Array of stage counts with status info
 */
export async function getActivePipelineStages(): Promise<
  PipelineStageCount[]
> {
  const result = await db
    .select({
      stage: contentJobs.status,
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(contentJobs)
    .where(
      sql`${contentJobs.status} NOT IN ('PUBLISHED', 'FAILED_QMS', 'FAILED_RENDER', 'FAILED_UPLOAD')`
    )
    .groupBy(contentJobs.status);

  return result.map((row) => ({
    stage: row.stage,
    count: row.count,
    status: row.stage.startsWith('FAILED') ? 'failed' : 'active',
  }));
}
