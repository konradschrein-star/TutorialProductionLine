import { desc, eq, and, or, like, gte, lte, sql, inArray } from "drizzle-orm";
import { db, contentJobs, channels, contentTemplates, users } from "../db";

/**
 * Job Repository
 *
 * Data access layer for content job operations.
 * Supports filtering, pagination, and relations.
 *
 * BOUNDARY (Konrad's decision D7, 2026-07-28): this repository serves the main
 * Jobs surface, which is `content_jobs` ONLY. Tutorial jobs are a separate
 * operation with their own table (`tutorial_jobs`), id space, status enum and
 * API namespace (`/api/production/**`, `/api/v1/tutorial/**`). They must NEVER
 * be unified into this list, these counts, or the dashboard — "the tutorial
 * operation is sort of a completely different operation to Content Forge."
 * Do not "improve" this by joining or UNION-ing the two tables.
 */

export interface Job {
  id: string;
  title: string;
  description: string;
  channel_id: string;
  template_id: string;
  format: string;
  status: string;
  paused_from_status: string | null;
  production_version: string | null;
  assigned_production_va_id: string | null;
  assigned_uploader_va_id: string | null;
  script: string | null;
  generated_tags: string[] | null;
  // Render
  render_engine: string | null;
  aspect_ratio: string | null;
  target_duration_seconds: number | null;
  duration_frames: number | null;
  render_started_at: Date | null;
  render_completed_at: Date | null;
  total_render_time_seconds: number | null;
  // Assets
  narration_source_path: string | null;
  r2_asset_manifest: any;
  assembly_manifest: any;
  metadata: any;
  size_bytes_total_assets: number | null;
  // Final video
  final_video_size_bytes: number | null;
  final_video_duration_seconds: number | null;
  // Artefact truth (migration 0048) — see schema for semantics.
  final_video_path: string | null;
  artefacts_verified_at: Date | null;
  artefacts_missing_count: number | null;
  // YouTube
  youtube_video_id: string | null;
  published_at: Date | null;
  views: number | null;
  revenue_cents: number | null;
  // QC
  qc_feedback: string | null;
  qc_reviewed_at: Date | null;
  skip_image_qc: boolean;
  skip_final_qc: boolean;
  // VA performance
  production_va_time_spent_seconds: number | null;
  uploader_va_time_spent_seconds: number | null;
  // AI generation audit log
  generation_log: Array<{
    stage: string;
    started_at: string;
    completed_at: string;
    duration_ms: number;
    model: string;
    prompt_system?: string;
    prompt_user?: string;
    raw_output?: string;
    success: boolean;
    error?: string;
    input_tokens?: number;
    output_tokens?: number;
  }> | null;
  // Errors
  error_message: string | null;
  error_detail: {
    code: string;
    message: string;
    category: string;
    context?: Record<string, unknown>;
    retryable: boolean;
    timestamp: string;
  } | null;
  state_machine_history: Array<{
    from_status: string;
    to_status: string;
    timestamp: string;
    reason?: string;
  }>;
  retry_count: number;
  created_at: Date;
  updated_at: Date;
  // Relations
  channel?: {
    id: string;
    name: string;
    youtube_channel_id: string;
  };
  template?: {
    id: string;
    name: string;
    format: string;
  };
  assigned_production_va?: {
    id: string;
    name: string;
    email: string;
  } | null;
  assigned_uploader_va?: {
    id: string;
    name: string;
    email: string;
  } | null;
}

export interface JobFilters {
  status?: string | string[];
  format?: string;
  channel_id?: string;
  template_id?: string;
  assigned_production_va_id?: string;
  assigned_uploader_va_id?: string;
  search?: string;
  created_after?: Date;
  created_before?: Date;
}

export interface JobListResult {
  jobs: Job[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * List jobs with filters and pagination
 *
 * @param filters - Job filters
 * @param page - Page number (1-indexed)
 * @param pageSize - Items per page
 * @returns Paginated job list
 */
export async function listJobs(
  filters: JobFilters = {},
  page: number = 1,
  pageSize: number = 20,
): Promise<JobListResult> {
  // Build WHERE conditions
  const conditions = [];

  if (filters.status) {
    if (Array.isArray(filters.status)) {
      conditions.push(inArray(contentJobs.status, filters.status as any[]));
    } else {
      conditions.push(eq(contentJobs.status, filters.status as any));
    }
  }

  if (filters.format) {
    conditions.push(eq(contentJobs.format, filters.format as any));
  }

  if (filters.channel_id) {
    conditions.push(eq(contentJobs.channel_id, filters.channel_id));
  }

  if (filters.template_id) {
    conditions.push(eq(contentJobs.template_id, filters.template_id));
  }

  if (filters.assigned_production_va_id) {
    conditions.push(
      eq(
        contentJobs.assigned_production_va_id,
        filters.assigned_production_va_id,
      ),
    );
  }

  if (filters.assigned_uploader_va_id) {
    conditions.push(
      eq(contentJobs.assigned_uploader_va_id, filters.assigned_uploader_va_id),
    );
  }

  if (filters.search) {
    conditions.push(
      or(
        like(contentJobs.title, `%${filters.search}%`),
        like(contentJobs.script, `%${filters.search}%`),
        like(contentJobs.youtube_video_id, `%${filters.search}%`),
      ),
    );
  }

  if (filters.created_after) {
    conditions.push(gte(contentJobs.created_at, filters.created_after));
  }

  if (filters.created_before) {
    conditions.push(lte(contentJobs.created_at, filters.created_before));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(contentJobs)
    .where(whereClause);

  const total = countResult[0]?.count || 0;
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  // Get paginated results with relations
  const results = await db
    .select({
      job: contentJobs,
      channel: channels,
      template: contentTemplates,
      productionVa: {
        id: users.id,
        name: users.name,
        email: users.email,
      },
    })
    .from(contentJobs)
    .leftJoin(channels, eq(contentJobs.channel_id, channels.id))
    .leftJoin(
      contentTemplates,
      eq(contentJobs.template_id, contentTemplates.id),
    )
    .leftJoin(users, eq(contentJobs.assigned_production_va_id, users.id))
    .where(whereClause)
    .orderBy(desc(contentJobs.updated_at))
    .limit(pageSize)
    .offset(offset);

  const jobs: Job[] = results.map((row) => ({
    ...row.job,
    error_detail: (row.job.error_detail as Job["error_detail"]) ?? null,
    state_machine_history:
      (row.job.state_machine_history as Job["state_machine_history"]) ?? [],
    qc_feedback: (row.job as any).qc_feedback ?? null,
    qc_reviewed_at: (row.job as any).qc_reviewed_at ?? null,
    channel: row.channel
      ? {
          id: row.channel.id,
          name: row.channel.name,
          youtube_channel_id: row.channel.youtube_channel_id,
        }
      : undefined,
    template: row.template
      ? {
          id: row.template.id,
          name: row.template.name,
          format: row.template.format,
        }
      : undefined,
    assigned_production_va: row.productionVa,
  }));

  return {
    jobs,
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Get a single job by ID with all relations
 *
 * @param id - Job ID
 * @returns Job with relations, or null if not found
 */
export async function getJobById(id: string): Promise<Job | null> {
  // Two-step: fetch the job with production VA join, then fetch uploader VA separately
  const results = await db
    .select({
      job: contentJobs,
      channel: channels,
      template: contentTemplates,
      productionVa: {
        id: users.id,
        name: users.name,
        email: users.email,
      },
    })
    .from(contentJobs)
    .leftJoin(channels, eq(contentJobs.channel_id, channels.id))
    .leftJoin(
      contentTemplates,
      eq(contentJobs.template_id, contentTemplates.id),
    )
    .leftJoin(users, eq(contentJobs.assigned_production_va_id, users.id))
    .where(eq(contentJobs.id, id))
    .limit(1);

  if (results.length === 0) {
    return null;
  }

  const row = results[0];

  // Fetch uploader VA separately to avoid join alias issues
  let uploaderVa: { id: string; name: string; email: string } | null = null;
  if (row.job.assigned_uploader_va_id) {
    const uploaderResult = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, row.job.assigned_uploader_va_id))
      .limit(1);
    uploaderVa = uploaderResult[0] ?? null;
  }

  return {
    ...row.job,
    error_detail: (row.job.error_detail as Job["error_detail"]) ?? null,
    state_machine_history:
      (row.job.state_machine_history as Job["state_machine_history"]) ?? [],
    channel: row.channel
      ? {
          id: row.channel.id,
          name: row.channel.name,
          youtube_channel_id: row.channel.youtube_channel_id,
        }
      : undefined,
    template: row.template
      ? {
          id: row.template.id,
          name: row.template.name,
          format: row.template.format,
        }
      : undefined,
    assigned_production_va: row.productionVa,
    assigned_uploader_va: uploaderVa,
  };
}
