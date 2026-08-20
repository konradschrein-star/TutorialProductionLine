import { desc, eq, or, sql } from 'drizzle-orm';
import { db, contentJobs } from '../db';

/**
 * System Health Repository
 *
 * Data access layer for system health monitoring.
 * Provides queue metrics, worker status, and error tracking.
 */

export interface FailedJob {
  id: string;
  status: string;
  channel_id: string;
  template_id: string;
  error_message: string | null;
  retry_count: number;
  created_at: Date;
  updated_at: Date;
  state_machine_history: Array<{
    from_status: string;
    to_status: string;
    timestamp: string;
    reason?: string;
  }> | null;
  channel?: {
    name: string;
    youtube_channel_id: string;
  };
  template?: {
    name: string;
    format: string;
  };
}

export interface SystemError {
  id: string;
  job_id: string | null;
  error_type: string;
  error_message: string;
  timestamp: Date;
}

/**
 * Get all failed jobs
 *
 * @returns Array of failed jobs with details
 */
export async function getFailedJobs(): Promise<FailedJob[]> {
  const results = await db
    .select({
      job: contentJobs,
      channel: sql`json_build_object('name', c.name, 'youtube_channel_id', c.youtube_channel_id)`,
      template: sql`json_build_object('name', t.name, 'format', t.format)`,
    })
    .from(contentJobs)
    .leftJoin(sql`channels c`, sql`${contentJobs.channel_id} = c.id`)
    .leftJoin(
      sql`content_templates t`,
      sql`${contentJobs.template_id} = t.id`
    )
    .where(
      or(
        sql`${contentJobs.status}::text LIKE 'FAILED_%'`,
        eq(contentJobs.status, 'FAILED_QMS' as any)
      )
    )
    .orderBy(desc(contentJobs.updated_at))
    .limit(100);

  return results.map((row: any) => ({
    ...row.job,
    channel: row.channel,
    template: row.template,
  }));
}

/**
 * Get failed jobs count by status
 *
 * @returns Map of failure status to count
 */
export async function getFailedJobCountsByStatus(): Promise<
  Record<string, number>
> {
  const results = await db
    .select({
      status: contentJobs.status,
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(contentJobs)
    .where(
      or(
        sql`${contentJobs.status}::text LIKE 'FAILED_%'`,
        eq(contentJobs.status, 'FAILED_QMS' as any)
      )
    )
    .groupBy(contentJobs.status);

  const counts: Record<string, number> = {};
  for (const row of results) {
    counts[row.status] = row.count;
  }
  return counts;
}

/**
 * Get jobs with high retry counts (potential issues)
 *
 * @param threshold - Minimum retry count (default: 3)
 * @returns Array of jobs with high retry counts
 */
export async function getHighRetryJobs(threshold: number = 3): Promise<FailedJob[]> {
  const results = await db
    .select({
      job: contentJobs,
      channel: sql`json_build_object('name', c.name, 'youtube_channel_id', c.youtube_channel_id)`,
      template: sql`json_build_object('name', t.name, 'format', t.format)`,
    })
    .from(contentJobs)
    .leftJoin(sql`channels c`, sql`${contentJobs.channel_id} = c.id`)
    .leftJoin(
      sql`content_templates t`,
      sql`${contentJobs.template_id} = t.id`
    )
    .where(sql`${contentJobs.retry_count} >= ${threshold}`)
    .orderBy(desc(contentJobs.retry_count))
    .limit(50);

  return results.map((row: any) => ({
    ...row.job,
    channel: row.channel,
    template: row.template,
  }));
}

/**
 * Get recent system errors from system_events table
 *
 * @param limit - Number of errors to fetch
 * @returns Array of recent system errors
 */
export async function getRecentSystemErrors(
  limit: number = 50
): Promise<SystemError[]> {
  const results = await db.execute<{
    id: string;
    job_id: string | null;
    event_type: string;
    error_message: string | null;
    timestamp: Date;
  }>(sql`
    SELECT
      id,
      job_id,
      event_type,
      payload->>'message' as error_message,
      timestamp
    FROM system_events
    WHERE event_type LIKE '%error%' OR event_type LIKE '%failed%'
    ORDER BY timestamp DESC
    LIMIT ${limit}
  `);

  return results.map((row) => ({
    id: row.id,
    job_id: row.job_id,
    error_type: row.event_type,
    error_message: row.error_message || 'No error message',
    timestamp: row.timestamp,
  }));
}
