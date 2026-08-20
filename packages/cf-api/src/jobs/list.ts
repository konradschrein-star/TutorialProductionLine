import { and, desc, sql } from "drizzle-orm";
import { contentJobs } from "@repo/db";
import type { SQL } from "drizzle-orm";
import type { CfRuntime } from "../runtime.js";
import {
  JobListFilterSchema,
  type JobListFilter,
  type JobListItem,
} from "../types.js";

export async function listJobs(
  rt: CfRuntime,
  rawFilter: unknown = {},
): Promise<JobListItem[]> {
  const filter: JobListFilter = JobListFilterSchema.parse(rawFilter);
  // `status` and `format` are PG enums in @repo/db, but the filter
  // accepts arbitrary strings (so the API doesn't have to re-declare
  // the enum union). We compare via raw `sql` to bypass the narrow
  // overload type — the DB still validates.
  const conditions: SQL[] = [];
  if (filter.status)
    conditions.push(sql`${contentJobs.status} = ${filter.status}`);
  if (filter.format)
    conditions.push(sql`${contentJobs.format} = ${filter.format}`);
  if (filter.channelId)
    conditions.push(sql`${contentJobs.channel_id} = ${filter.channelId}`);

  const rows = await rt.db
    .select({
      id: contentJobs.id,
      title: contentJobs.title,
      status: contentJobs.status,
      format: contentJobs.format,
      channel_id: contentJobs.channel_id,
      created_at: contentJobs.created_at,
      updated_at: contentJobs.updated_at,
      status_updated_at: contentJobs.status_updated_at,
    })
    .from(contentJobs)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(contentJobs.created_at))
    .limit(filter.limit ?? 100)
    .offset(filter.offset ?? 0);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    format: r.format,
    channel_id: r.channel_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    status_updated_at: r.status_updated_at?.toISOString() ?? null,
  }));
}
