import { sql, desc, eq } from 'drizzle-orm';
import { db, contentJobs, contentTemplates } from '../db';

/**
 * Analytics Repository
 *
 * Data access layer for the Analytics page.
 * Provides production KPIs, daily trends, pipeline bottleneck analysis,
 * error breakdowns, and cross-format comparisons.
 */

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface ProductionKPIs {
  jobs_completed: number;
  jobs_created: number;
  avg_lead_time_hours: number | null;
  error_rate_percent: number;
  queue_depth: number;
}

export interface DailyJobStats {
  date: string; // YYYY-MM-DD
  created: number;
  completed: number;
}

export interface StageBottleneck {
  stage: string;
  avg_time_seconds: number;
  job_count: number;
}

export interface ErrorBreakdown {
  status: string;
  count: number;
}

export interface FormatComparison {
  format: string;
  jobs_completed: number;
  jobs_active: number;
  error_count: number;
  avg_lead_time_hours: number | null;
}

export interface RenderMetrics {
  total_renders: number;
  avg_render_time_seconds: number | null;
  min_render_time_seconds: number | null;
  max_render_time_seconds: number | null;
  renders_today: number;
  renders_per_hour_avg: number;
}

export interface RenderTimeDistribution {
  bucket_label: string;
  count: number;
}

export interface RenderJobsPerHour {
  hour: string; // YYYY-MM-DD HH:00:00
  render_count: number;
}

// ── Constants ───────────────────────────────────────────────────────────────

const TERMINAL_STATUSES = [
  'PUBLISHED',
  'CANCELLED',
  'DELETED',
  'FAILED_QMS',
  'FAILED_RENDER',
  'FAILED_UPLOAD',
  'FAILED_GENERAL',
] as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

function sqlInList(values: readonly string[]) {
  return sql.join(
    values.map((s) => sql`${s}`),
    sql`, `
  );
}

function windowFilter(days: number, format?: string) {
  const conditions = [
    sql`${contentJobs.created_at} >= now() - interval '1 day' * ${days}`,
  ];
  if (format) {
    conditions.push(sql`${contentJobs.format} = ${format}`);
  }
  return sql.join(conditions, sql` AND `);
}

// ── Queries ─────────────────────────────────────────────────────────────────

/**
 * Get production KPIs for the given time window.
 *
 * - jobs_completed: jobs reaching PUBLISHED in the window
 * - jobs_created: jobs created in the window
 * - avg_lead_time_hours: average created_at -> status_updated_at for PUBLISHED jobs
 * - error_rate_percent: (failed / total) * 100
 * - queue_depth: current non-terminal, non-failed jobs
 */
export async function getProductionKPIs(
  days: number = 30,
  format?: string
): Promise<ProductionKPIs> {
  const formatFilter = format ? sql` AND ${contentJobs.format} = ${format}` : sql``;

  // Jobs completed (reached PUBLISHED) in window
  const completedResult = await db
    .select({
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(contentJobs)
    .where(
      sql`${contentJobs.status} = 'PUBLISHED'
          AND ${contentJobs.status_updated_at} >= now() - interval '1 day' * ${days}
          ${formatFilter}`
    );

  // Jobs created in window
  const createdResult = await db
    .select({
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(contentJobs)
    .where(sql`${windowFilter(days, format)}`);

  // Average lead time for published jobs in window
  const leadTimeResult = await db
    .select({
      avg_hours: sql<number | null>`
        cast(
          avg(extract(epoch from (${contentJobs.status_updated_at} - ${contentJobs.created_at})) / 3600.0)
        as double precision)`,
    })
    .from(contentJobs)
    .where(
      sql`${contentJobs.status} = 'PUBLISHED'
          AND ${contentJobs.status_updated_at} >= now() - interval '1 day' * ${days}
          ${formatFilter}`
    );

  // Failed jobs in window
  const failedResult = await db
    .select({
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(contentJobs)
    .where(
      sql`${contentJobs.status}::text LIKE 'FAILED_%'
          AND ${contentJobs.created_at} >= now() - interval '1 day' * ${days}
          ${formatFilter}`
    );

  // Queue depth: non-terminal, non-failed jobs right now
  const queueResult = await db
    .select({
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(contentJobs)
    .where(
      sql`${contentJobs.status} NOT IN (${sqlInList(TERMINAL_STATUSES)})
          ${formatFilter}`
    );

  const jobsCreated = createdResult[0]?.count ?? 0;
  const jobsFailed = failedResult[0]?.count ?? 0;

  return {
    jobs_completed: completedResult[0]?.count ?? 0,
    jobs_created: jobsCreated,
    avg_lead_time_hours: leadTimeResult[0]?.avg_hours ?? null,
    error_rate_percent:
      jobsCreated > 0
        ? Math.round((jobsFailed / jobsCreated) * 10000) / 100
        : 0,
    queue_depth: queueResult[0]?.count ?? 0,
  };
}

/**
 * Get daily created and completed job counts for trending.
 */
export async function getJobsPerDay(
  days: number = 30,
  format?: string
): Promise<DailyJobStats[]> {
  const formatFilter = format ? sql` AND ${contentJobs.format} = ${format}` : sql``;

  const results = await db.execute<{
    date: string;
    created: number;
    completed: number;
  }>(sql`
    WITH date_series AS (
      SELECT generate_series(
        (now() - interval '1 day' * ${days})::date,
        now()::date,
        '1 day'::interval
      )::date AS day
    )
    SELECT
      ds.day::text AS date,
      cast(coalesce(sum(case when cj.created_at::date = ds.day then 1 else 0 end), 0) as integer) AS created,
      cast(coalesce(sum(case when cj.status = 'PUBLISHED' and cj.status_updated_at::date = ds.day then 1 else 0 end), 0) as integer) AS completed
    FROM date_series ds
    LEFT JOIN content_jobs cj
      ON (cj.created_at::date = ds.day OR (cj.status = 'PUBLISHED' AND cj.status_updated_at::date = ds.day))
      ${format ? sql`AND cj.format = ${format}` : sql``}
    GROUP BY ds.day
    ORDER BY ds.day ASC
  `);

  return results.map((row) => ({
    date: row.date,
    created: Number(row.created),
    completed: Number(row.completed),
  }));
}

/**
 * Get pipeline bottleneck analysis.
 *
 * Approximates bottlenecks by measuring how long non-terminal jobs
 * have been sitting in each status (now - status_updated_at).
 */
export async function getPipelineBottlenecks(
  days: number = 30,
  format?: string
): Promise<StageBottleneck[]> {
  const formatFilter = format ? sql` AND ${contentJobs.format} = ${format}` : sql``;

  const results = await db
    .select({
      stage: contentJobs.status,
      avg_time_seconds: sql<number>`
        cast(
          avg(extract(epoch from (now() - ${contentJobs.status_updated_at})))
        as double precision)`,
      job_count: sql<number>`cast(count(*) as integer)`,
    })
    .from(contentJobs)
    .where(
      sql`${contentJobs.status} NOT IN ('PUBLISHED', 'CANCELLED', 'DELETED')
          AND ${contentJobs.created_at} >= now() - interval '1 day' * ${days}
          ${formatFilter}`
    )
    .groupBy(contentJobs.status)
    .orderBy(
      desc(
        sql`avg(extract(epoch from (now() - ${contentJobs.status_updated_at})))`
      )
    );

  return results.map((row) => ({
    stage: row.stage,
    avg_time_seconds: row.avg_time_seconds ?? 0,
    job_count: row.job_count,
  }));
}

/**
 * Get error breakdown by failure status in the given time window.
 */
export async function getErrorBreakdown(
  days: number = 30,
  format?: string
): Promise<ErrorBreakdown[]> {
  const formatFilter = format ? sql` AND ${contentJobs.format} = ${format}` : sql``;

  const results = await db
    .select({
      status: contentJobs.status,
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(contentJobs)
    .where(
      sql`${contentJobs.status}::text LIKE 'FAILED_%'
          AND ${contentJobs.created_at} >= now() - interval '1 day' * ${days}
          ${formatFilter}`
    )
    .groupBy(contentJobs.status)
    .orderBy(desc(sql`count(*)`));

  return results.map((row) => ({
    status: row.status,
    count: row.count,
  }));
}

/**
 * Get cross-format comparison stats for the given time window.
 */
export async function getFormatComparison(
  days: number = 30
): Promise<FormatComparison[]> {
  const results = await db
    .select({
      format: contentJobs.format,
      jobs_completed: sql<number>`cast(count(*) filter (where ${contentJobs.status} = 'PUBLISHED' AND ${contentJobs.status_updated_at} >= now() - interval '1 day' * ${days}) as integer)`,
      jobs_active: sql<number>`cast(count(*) filter (where ${contentJobs.status} NOT IN (${sqlInList(TERMINAL_STATUSES)})) as integer)`,
      error_count: sql<number>`cast(count(*) filter (where ${contentJobs.status}::text LIKE 'FAILED_%' AND ${contentJobs.created_at} >= now() - interval '1 day' * ${days}) as integer)`,
      avg_lead_time_hours: sql<number | null>`
        cast(
          avg(
            extract(epoch from (${contentJobs.status_updated_at} - ${contentJobs.created_at})) / 3600.0
          ) filter (where ${contentJobs.status} = 'PUBLISHED' AND ${contentJobs.status_updated_at} >= now() - interval '1 day' * ${days})
        as double precision)`,
    })
    .from(contentJobs)
    .where(
      sql`${contentJobs.created_at} >= now() - interval '1 day' * ${days}`
    )
    .groupBy(contentJobs.format);

  return results.map((row) => ({
    format: row.format,
    jobs_completed: row.jobs_completed,
    jobs_active: row.jobs_active,
    error_count: row.error_count,
    avg_lead_time_hours: row.avg_lead_time_hours ?? null,
  }));
}

/**
 * Get render performance metrics for the given time window.
 *
 * - total_renders: count of jobs with completed renders
 * - avg_render_time_seconds: average render duration
 * - min/max_render_time_seconds: fastest/slowest renders
 * - renders_today: renders completed today
 * - renders_per_hour_avg: average renders per hour in window
 */
export async function getRenderMetrics(
  days: number = 30
): Promise<RenderMetrics> {
  const metricsResult = await db
    .select({
      total_renders: sql<number>`cast(count(*) as integer)`,
      avg_render_time_seconds: sql<number | null>`
        cast(avg(${contentJobs.total_render_time_seconds}) as double precision)`,
      min_render_time_seconds: sql<number | null>`
        min(${contentJobs.total_render_time_seconds})`,
      max_render_time_seconds: sql<number | null>`
        max(${contentJobs.total_render_time_seconds})`,
    })
    .from(contentJobs)
    .where(
      sql`${contentJobs.render_completed_at} IS NOT NULL
          AND ${contentJobs.render_completed_at} >= now() - interval '1 day' * ${days}`
    );

  const todayResult = await db
    .select({
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(contentJobs)
    .where(
      sql`${contentJobs.render_completed_at}::date = now()::date`
    );

  const totalRenders = metricsResult[0]?.total_renders ?? 0;
  const rendersPerHourAvg = days > 0 ? totalRenders / (days * 24) : 0;

  return {
    total_renders: totalRenders,
    avg_render_time_seconds: metricsResult[0]?.avg_render_time_seconds ?? null,
    min_render_time_seconds: metricsResult[0]?.min_render_time_seconds ?? null,
    max_render_time_seconds: metricsResult[0]?.max_render_time_seconds ?? null,
    renders_today: todayResult[0]?.count ?? 0,
    renders_per_hour_avg: Math.round(rendersPerHourAvg * 100) / 100,
  };
}

/**
 * Get render time distribution bucketed by duration ranges.
 */
export async function getRenderTimeDistribution(
  days: number = 30
): Promise<RenderTimeDistribution[]> {
  const results = await db.execute<{
    bucket_label: string;
    count: number;
  }>(sql`
    SELECT
      CASE
        WHEN ${contentJobs.total_render_time_seconds} < 60 THEN '< 1 min'
        WHEN ${contentJobs.total_render_time_seconds} < 300 THEN '1-5 min'
        WHEN ${contentJobs.total_render_time_seconds} < 600 THEN '5-10 min'
        WHEN ${contentJobs.total_render_time_seconds} < 1800 THEN '10-30 min'
        WHEN ${contentJobs.total_render_time_seconds} < 3600 THEN '30-60 min'
        ELSE '> 1 hour'
      END AS bucket_label,
      cast(count(*) as integer) AS count
    FROM content_jobs
    WHERE ${contentJobs.render_completed_at} IS NOT NULL
      AND ${contentJobs.render_completed_at} >= now() - interval '1 day' * ${days}
    GROUP BY bucket_label
    ORDER BY
      CASE bucket_label
        WHEN '< 1 min' THEN 1
        WHEN '1-5 min' THEN 2
        WHEN '5-10 min' THEN 3
        WHEN '10-30 min' THEN 4
        WHEN '30-60 min' THEN 5
        WHEN '> 1 hour' THEN 6
      END
  `);

  return results.map((row) => ({
    bucket_label: row.bucket_label,
    count: Number(row.count),
  }));
}

/**
 * Get hourly render job counts for trending.
 */
export async function getRenderJobsPerHour(
  days: number = 7
): Promise<RenderJobsPerHour[]> {
  const results = await db.execute<{
    hour: string;
    render_count: number;
  }>(sql`
    WITH hour_series AS (
      SELECT generate_series(
        (now() - interval '1 day' * ${days}),
        now(),
        '1 hour'::interval
      ) AS hour
    )
    SELECT
      to_char(hs.hour, 'YYYY-MM-DD HH24:00:00') AS hour,
      cast(coalesce(count(cj.id), 0) as integer) AS render_count
    FROM hour_series hs
    LEFT JOIN content_jobs cj
      ON cj.render_completed_at >= hs.hour
      AND cj.render_completed_at < hs.hour + interval '1 hour'
    GROUP BY hs.hour
    ORDER BY hs.hour ASC
  `);

  return results.map((row) => ({
    hour: row.hour,
    render_count: Number(row.render_count),
  }));
}
