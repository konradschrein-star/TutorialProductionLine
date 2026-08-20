import { sql, desc, eq, inArray, or, and } from "drizzle-orm";
import { db, contentJobs, channels, contentTemplates, users } from "../db";
import { isTerminalState } from "@repo/domain";

/**
 * Upload Repository
 *
 * Data access layer for the Uploader section.
 * Provides jobs that are ready for YouTube upload, currently uploading,
 * or recently published — everything the Uploader VA needs.
 */

export interface UploadJob {
  id: string;
  title: string;
  description: string;
  status: string;
  format: string;
  created_at: Date;
  updated_at: Date;
  status_updated_at: Date;
  final_video_size_bytes: number | null;
  final_video_duration_seconds: number | null;
  youtube_video_id: string | null;
  published_at: Date | null;
  generated_tags: string[] | null;
  r2_asset_manifest: Array<{ key: string; type: string; size_bytes: number }>;
  channel: {
    id: string;
    name: string;
    youtube_channel_id: string;
  } | null;
  template: {
    name: string;
    format: string;
  } | null;
  assigned_uploader_va: {
    id: string;
    name: string;
  } | null;
}

export interface UploadQueueFilters {
  status?: string;
  channel_id?: string;
  format?: string;
  assigned_to_me?: string; // user ID
}

export interface UploadQueueResult {
  jobs: UploadJob[];
  total: number;
  counts: {
    awaiting: number;
    uploading: number;
    published_recent: number;
    failed: number;
  };
}

/**
 * Statuses relevant to the upload queue.
 */
const UPLOAD_STATUSES = [
  "AWAITING_UPLOADER",
  "UPLOADING",
  "PUBLISHED",
  "FAILED_UPLOAD",
] as const;

/**
 * Get jobs for the upload queue with optional filters.
 */
export async function getUploadQueueJobs(
  filters: UploadQueueFilters = {},
): Promise<UploadQueueResult> {
  // Build filter conditions
  const conditions = [];

  if (filters.status) {
    conditions.push(eq(contentJobs.status, filters.status as any));
  } else {
    // Default: show all upload-relevant statuses
    conditions.push(inArray(contentJobs.status, [...UPLOAD_STATUSES] as any[]));
  }

  if (filters.channel_id) {
    conditions.push(eq(contentJobs.channel_id, filters.channel_id));
  }

  if (filters.format) {
    conditions.push(eq(contentJobs.format, filters.format as any));
  }

  if (filters.assigned_to_me) {
    conditions.push(
      eq(contentJobs.assigned_uploader_va_id, filters.assigned_to_me),
    );
  }

  const whereClause =
    conditions.length > 1 ? and(...conditions) : conditions[0];

  // Fetch jobs with relations
  const results = await db
    .select({
      job: contentJobs,
      channel: channels,
      template: {
        name: contentTemplates.name,
        format: contentTemplates.format,
      },
      uploaderVa: {
        id: users.id,
        name: users.name,
      },
    })
    .from(contentJobs)
    .leftJoin(channels, eq(contentJobs.channel_id, channels.id))
    .leftJoin(
      contentTemplates,
      eq(contentJobs.template_id, contentTemplates.id),
    )
    .leftJoin(users, eq(contentJobs.assigned_uploader_va_id, users.id))
    .where(whereClause)
    .orderBy(
      // Awaiting first, then uploading, then published, then failed
      sql`CASE ${contentJobs.status}
        WHEN 'AWAITING_UPLOADER' THEN 0
        WHEN 'UPLOADING' THEN 1
        WHEN 'FAILED_UPLOAD' THEN 2
        WHEN 'PUBLISHED' THEN 3
        ELSE 4
      END`,
      desc(contentJobs.updated_at),
    )
    .limit(200);

  // Count by status
  const countResults = await db
    .select({
      status: contentJobs.status,
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(contentJobs)
    .where(inArray(contentJobs.status, [...UPLOAD_STATUSES] as any[]))
    .groupBy(contentJobs.status);

  const countMap = new Map<string, number>();
  for (const row of countResults) {
    countMap.set(row.status, row.count);
  }

  const jobs: UploadJob[] = results.map((row) => ({
    id: row.job.id,
    title: row.job.title,
    description: row.job.description,
    status: row.job.status,
    format: row.job.format,
    created_at: row.job.created_at,
    updated_at: row.job.updated_at,
    status_updated_at: row.job.status_updated_at,
    final_video_size_bytes: row.job.final_video_size_bytes,
    final_video_duration_seconds: row.job.final_video_duration_seconds,
    youtube_video_id: row.job.youtube_video_id,
    published_at: row.job.published_at,
    generated_tags: row.job.generated_tags,
    r2_asset_manifest:
      (row.job.r2_asset_manifest as UploadJob["r2_asset_manifest"]) ?? [],
    channel: row.channel
      ? {
          id: row.channel.id,
          name: row.channel.name,
          youtube_channel_id: row.channel.youtube_channel_id,
        }
      : null,
    template: row.template,
    assigned_uploader_va: row.uploaderVa,
  }));

  return {
    jobs,
    total: jobs.length,
    counts: {
      awaiting: countMap.get("AWAITING_UPLOADER") ?? 0,
      uploading: countMap.get("UPLOADING") ?? 0,
      published_recent: countMap.get("PUBLISHED") ?? 0,
      failed: countMap.get("FAILED_UPLOAD") ?? 0,
    },
  };
}

export async function cancelJob(
  jobId: string,
  reason: string,
  actorUserId: string,
): Promise<typeof contentJobs.$inferSelect> {
  const [existing] = await db
    .select()
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);

  if (!existing) {
    throw new Error(`Job not found: ${jobId}`);
  }

  if (isTerminalState(existing.status as any)) {
    throw new Error(`Cannot cancel job in invalid state: ${existing.status}`);
  }

  const existingHistory = (existing.state_machine_history as Array<any>) ?? [];

  const [updated] = await db
    .update(contentJobs)
    .set({
      status: "CANCELLED" as any,
      error_message: reason,
      state_machine_history: [
        ...existingHistory,
        {
          from: existing.status,
          to: "CANCELLED",
          timestamp: new Date().toISOString(),
          actor: actorUserId,
          reason,
        },
      ],
      updated_at: new Date(),
    })
    .where(eq(contentJobs.id, jobId))
    .returning();

  return updated!;
}

export async function updateJobMetadata(
  jobId: string,
  data: {
    youtube_title?: string;
    youtube_description?: string;
    youtube_tags?: string;
  },
): Promise<void> {
  await db
    .update(contentJobs)
    .set({
      ...(data.youtube_title !== undefined && { title: data.youtube_title }),
      ...(data.youtube_description !== undefined && {
        description: data.youtube_description,
      }),
      updated_at: new Date(),
    })
    .where(eq(contentJobs.id, jobId));
}
