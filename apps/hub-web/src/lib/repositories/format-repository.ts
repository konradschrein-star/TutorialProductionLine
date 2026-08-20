import { sql, desc, eq } from "drizzle-orm";
import { ContentFormat } from "@repo/contracts";
import { db, contentJobs, contentTemplates, channels } from "../db";

/**
 * Format Repository
 *
 * Data access layer for the Content Formats grid page and format workstation pages.
 * Provides aggregated stats by format, template listings, and heatmap data.
 */

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface FormatStats {
  format: string;
  total_jobs: number;
  active_jobs: number;
  failed_jobs: number;
  template_count: number;
}

export interface FormatTemplate {
  id: string;
  name: string;
  description: string | null;
  pipeline_stages: string[];
  render_config: Record<string, any>;
  metadata: Record<string, unknown> | null;
  is_active: boolean;
  job_count: number;
}

export interface FormatJob {
  id: string;
  title: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  channel_name: string | null;
  template_name: string | null;
}

export interface HeatmapJob {
  id: string;
  title: string;
  status: string;
  format: string;
  created_at: Date;
}

export interface RenderingJob {
  id: string;
  title: string;
  render_engine: string | null;
  render_started_at: Date | null;
  format: string;
  target_duration_seconds: number | null;
}

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * All known content formats, sourced from the canonical `ContentFormat` enum
 * (`packages/contracts/src/enums/content-format.ts`) rather than a hand-copied
 * local list. We enumerate them here so the grid always shows every format,
 * even those with zero jobs and zero templates.
 */
const ALL_FORMATS = ContentFormat.options;

const TERMINAL_STATUSES = [
  "PUBLISHED",
  "CANCELLED",
  "DELETED",
  "FAILED_QMS",
  "FAILED_RENDER",
  "FAILED_UPLOAD",
  "FAILED_GENERAL",
] as const;

const HEATMAP_TERMINAL_STATUSES = [
  "PUBLISHED",
  "CANCELLED",
  "DELETED",
] as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

function sqlInList(values: readonly string[]) {
  return sql.join(
    values.map((s) => sql`${s}`),
    sql`, `,
  );
}

// ── Queries ─────────────────────────────────────────────────────────────────

/**
 * Get job counts grouped by content format.
 *
 * Returns ALL known formats (from the enum), not just those with existing jobs.
 * Formats with zero jobs/templates still appear so the grid is always complete.
 */
export async function getJobCountsByFormat(): Promise<FormatStats[]> {
  // Query 1: Job stats grouped by format
  const jobStats = await db
    .select({
      format: contentJobs.format,
      total_jobs: sql<number>`cast(count(*) as integer)`,
      active_jobs: sql<number>`cast(count(*) filter (where ${contentJobs.status} NOT IN (${sqlInList(TERMINAL_STATUSES)})) as integer)`,
      failed_jobs: sql<number>`cast(count(*) filter (where ${contentJobs.status}::text LIKE 'FAILED_%') as integer)`,
    })
    .from(contentJobs)
    .groupBy(contentJobs.format);

  // Query 2: Active template counts grouped by format
  const templateStats = await db
    .select({
      format: contentTemplates.format,
      template_count: sql<number>`cast(count(*) as integer)`,
    })
    .from(contentTemplates)
    .where(eq(contentTemplates.is_active, true))
    .groupBy(contentTemplates.format);

  // Build lookup maps
  const jobMap = new Map<
    string,
    { total_jobs: number; active_jobs: number; failed_jobs: number }
  >();
  for (const row of jobStats) {
    jobMap.set(row.format, {
      total_jobs: row.total_jobs,
      active_jobs: row.active_jobs,
      failed_jobs: row.failed_jobs,
    });
  }

  const templateMap = new Map<string, number>();
  for (const row of templateStats) {
    templateMap.set(row.format, row.template_count);
  }

  // Return ALL formats, filling in zeros for those without data
  return ALL_FORMATS.map((format) => ({
    format,
    total_jobs: jobMap.get(format)?.total_jobs ?? 0,
    active_jobs: jobMap.get(format)?.active_jobs ?? 0,
    failed_jobs: jobMap.get(format)?.failed_jobs ?? 0,
    template_count: templateMap.get(format) ?? 0,
  }));
}

/**
 * Get templates for a specific content format, with job count per template.
 */
export async function getFormatTemplates(
  format: string,
): Promise<FormatTemplate[]> {
  const results = await db
    .select({
      id: contentTemplates.id,
      name: contentTemplates.name,
      description: contentTemplates.description,
      pipeline_stages: contentTemplates.pipeline_stages,
      render_config: contentTemplates.render_config,
      metadata: contentTemplates.metadata,
      is_active: contentTemplates.is_active,
      job_count: sql<number>`cast((
        select count(*)
        from content_jobs
        where content_jobs.template_id = ${contentTemplates.id}
      ) as integer)`,
    })
    .from(contentTemplates)
    .where(eq(contentTemplates.format, format as any));

  return results.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    pipeline_stages: row.pipeline_stages as string[],
    render_config: row.render_config as Record<string, any>,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    is_active: row.is_active,
    job_count: row.job_count,
  }));
}

/**
 * Get recent jobs for a format with channel and template info.
 */
export async function getRecentJobsByFormat(
  format: string,
  limit: number = 20,
): Promise<FormatJob[]> {
  const results = await db
    .select({
      id: contentJobs.id,
      title: contentJobs.title,
      status: contentJobs.status,
      created_at: contentJobs.created_at,
      updated_at: contentJobs.updated_at,
      channel_name: channels.name,
      template_name: contentTemplates.name,
    })
    .from(contentJobs)
    .leftJoin(channels, eq(contentJobs.channel_id, channels.id))
    .leftJoin(
      contentTemplates,
      eq(contentJobs.template_id, contentTemplates.id),
    )
    .where(eq(contentJobs.format, format as any))
    .orderBy(desc(contentJobs.updated_at))
    .limit(limit);

  return results.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    channel_name: row.channel_name,
    template_name: row.template_name,
  }));
}

/**
 * Get active (non-terminal) jobs for heatmap display.
 *
 * Terminal states for the heatmap are PUBLISHED, CANCELLED, and DELETED only.
 * If format is provided, results are further filtered by that format.
 */
export async function getActiveJobsWithStages(
  format?: string,
): Promise<HeatmapJob[]> {
  const conditions = [
    sql`${contentJobs.status} NOT IN (${sqlInList(HEATMAP_TERMINAL_STATUSES)})`,
  ];

  if (format) {
    conditions.push(sql`${contentJobs.format} = ${format}`);
  }

  const results = await db
    .select({
      id: contentJobs.id,
      title: contentJobs.title,
      status: contentJobs.status,
      format: contentJobs.format,
      created_at: contentJobs.created_at,
    })
    .from(contentJobs)
    .where(sql`${sql.join(conditions, sql` AND `)}`)
    .orderBy(contentJobs.created_at);

  return results.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    format: row.format,
    created_at: row.created_at,
  }));
}

/**
 * Get jobs currently being rendered (RENDERING_FFMPEG or RENDERING_REMOTION).
 */
export async function getRenderingJobs(): Promise<RenderingJob[]> {
  const renderStatuses = ["RENDERING_FFMPEG", "RENDERING_REMOTION"] as const;

  const results = await db
    .select({
      id: contentJobs.id,
      title: contentJobs.title,
      render_engine: contentJobs.render_engine,
      render_started_at: contentJobs.render_started_at,
      target_duration_seconds: contentJobs.target_duration_seconds,
      format: contentJobs.format,
    })
    .from(contentJobs)
    .where(sql`${contentJobs.status} IN (${sqlInList(renderStatuses)})`);

  return results.map((row) => ({
    id: row.id,
    title: row.title,
    render_engine: row.render_engine,
    render_started_at: row.render_started_at,
    target_duration_seconds: row.target_duration_seconds,
    format: row.format,
  }));
}
