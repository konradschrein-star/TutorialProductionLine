/**
 * Operational queries for the dashboard.
 *
 * The old dashboard displayed a handful of bars and segments that looked like
 * data and encoded nothing — a hardcoded 75% fill, a "2 of 4 lit" indicator, a
 * queue gauge divided by an invented constant. All of that is gone. Everything
 * here is a real aggregate over `content_jobs`, and anything that cannot be
 * sourced is simply not displayed.
 *
 * Server-only.
 */
import { and, desc, eq, gte, inArray, lt, not, sql } from "drizzle-orm";
import { db, contentJobs, channels } from "@/lib/db";
import { STATUS_GROUPS } from "@/app/(authenticated)/jobs/_lib/job-stage";

/** Statuses that mean the job is finished, one way or another. */
const TERMINAL = [
  "PUBLISHED",
  "CANCELLED",
  "DELETED",
  "MARKED_FOR_DELETION",
] as const;

export interface DashboardJobRow {
  id: string;
  title: string;
  status: string;
  format: string;
  channelName: string | null;
  statusUpdatedAt: Date;
  errorMessage: string | null;
}

const ROW_SELECT = {
  id: contentJobs.id,
  title: contentJobs.title,
  status: contentJobs.status,
  format: contentJobs.format,
  channelName: channels.name,
  statusUpdatedAt: contentJobs.status_updated_at,
  errorMessage: contentJobs.error_message,
};

/**
 * Jobs sitting in a non-terminal, non-failed state for longer than expected.
 * This is the "what is stuck" question, answered by the database rather than
 * by the operator eyeballing timestamps.
 *
 * @param olderThanMinutes - staleness threshold for automated stages
 */
export async function getStuckJobs(
  olderThanMinutes = 120,
  limit = 12,
): Promise<DashboardJobRow[]> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  try {
    return await db
      .select(ROW_SELECT)
      .from(contentJobs)
      .leftJoin(channels, eq(contentJobs.channel_id, channels.id))
      .where(
        and(
          inArray(contentJobs.status, [...STATUS_GROUPS.working] as never[]),
          lt(contentJobs.status_updated_at, cutoff),
        ),
      )
      .orderBy(contentJobs.status_updated_at)
      .limit(limit);
  } catch {
    return [];
  }
}

/**
 * Jobs that failed within the given window — "what broke overnight".
 */
export async function getRecentFailures(
  withinHours = 24,
  limit = 12,
): Promise<DashboardJobRow[]> {
  const cutoff = new Date(Date.now() - withinHours * 3_600_000);
  try {
    return await db
      .select(ROW_SELECT)
      .from(contentJobs)
      .leftJoin(channels, eq(contentJobs.channel_id, channels.id))
      .where(
        and(
          inArray(contentJobs.status, [...STATUS_GROUPS.failed] as never[]),
          gte(contentJobs.status_updated_at, cutoff),
        ),
      )
      .orderBy(desc(contentJobs.status_updated_at))
      .limit(limit);
  } catch {
    return [];
  }
}

/** Jobs blocked on a person, oldest wait first. */
export async function getAwaitingHuman(limit = 12): Promise<DashboardJobRow[]> {
  try {
    return await db
      .select(ROW_SELECT)
      .from(contentJobs)
      .leftJoin(channels, eq(contentJobs.channel_id, channels.id))
      .where(
        inArray(contentJobs.status, [
          ...STATUS_GROUPS["needs-human"],
        ] as never[]),
      )
      .orderBy(contentJobs.status_updated_at)
      .limit(limit);
  } catch {
    return [];
  }
}

export interface CompletionRow extends DashboardJobRow {
  channelId: string;
  youtubeVideoId: string | null;
  finalVideoSizeBytes: number | null;
  finalVideoDurationSeconds: number | null;
}

/**
 * Most recently finished work — rendered, approved, or published. These are the
 * rows the operator most wants to click through to an artefact.
 */
export async function getRecentCompletions(
  limit = 8,
): Promise<CompletionRow[]> {
  try {
    return await db
      .select({
        ...ROW_SELECT,
        channelId: contentJobs.channel_id,
        youtubeVideoId: contentJobs.youtube_video_id,
        finalVideoSizeBytes: contentJobs.final_video_size_bytes,
        finalVideoDurationSeconds: contentJobs.final_video_duration_seconds,
      })
      .from(contentJobs)
      .leftJoin(channels, eq(contentJobs.channel_id, channels.id))
      .where(
        inArray(contentJobs.status, [
          "PUBLISHED",
          "AWAITING_UPLOADER",
          "UPLOADING",
          "AWAITING_QC",
        ] as never[]),
      )
      .orderBy(desc(contentJobs.status_updated_at))
      .limit(limit);
  } catch {
    return [];
  }
}

/**
 * How many jobs are actively moving through the pipeline right now, by stage.
 * Only non-terminal, non-failed stages that actually have jobs in them — no
 * padding with zero rows, no invented ordering.
 */
export async function getActiveStageCounts(): Promise<
  Array<{ status: string; count: number }>
> {
  try {
    const rows = await db
      .select({
        status: contentJobs.status,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(contentJobs)
      .where(not(inArray(contentJobs.status, [...TERMINAL] as never[])))
      .groupBy(contentJobs.status);
    return rows
      .map((r) => ({ status: r.status as string, count: Number(r.count) }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);
  } catch {
    return [];
  }
}

/**
 * Jobs created in the last N hours — throughput signal for "what happened
 * overnight".
 */
export async function getCreatedSince(hours: number): Promise<number> {
  const cutoff = new Date(Date.now() - hours * 3_600_000);
  try {
    const [row] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(contentJobs)
      .where(gte(contentJobs.created_at, cutoff));
    return Number(row?.count ?? 0);
  } catch {
    return 0;
  }
}

/**
 * The most recent time a render actually finished, from `render_completed_at`.
 * Answers "is this thing working at all". Returns null when NO job has a
 * recorded render completion — which is shown as "no successful render on
 * record", never as a fabricated timestamp or a zero.
 */
export async function getLastSuccessfulRender(): Promise<string | null> {
  try {
    const [row] = await db
      // postgres.js returns raw sql<> date expressions as STRINGS at runtime, so
      // the type is string|null (NOT Date). Callers must `new Date(...)` before
      // calling Date methods — this typing forces that and prevents the
      // `.toISOString() is not a function` crash from regressing.
      .select({
        at: sql<string | null>`max(${contentJobs.render_completed_at})`,
      })
      .from(contentJobs);
    return row?.at ?? null;
  } catch {
    return null;
  }
}

export interface ReconciliationSummary {
  /** Last time reconcile-artefacts ran, or null = never run. Raw-sql max() so
   * this is a STRING at runtime — callers must `new Date(...)` it. */
  lastRun: string | null;
  /** Jobs whose artefacts have ever been reconciled. */
  jobsVerified: number;
  /** Sum of missing manifest entries at last reconciliation, or null=unknown. */
  missingTotal: number | null;
  /** Jobs marked PUBLISHED — context for "published but maybe artefact-less". */
  publishedCount: number;
}

/**
 * Storage-truth summary for the dashboard (G4/C6). Reads only the columns the
 * reconciler writes (migration 0048). NULL everywhere means the reconciler has
 * never run — the UI must say "never run", not show zeros that imply "all
 * clean". Nothing here is inferred or estimated.
 */
export async function getReconciliationSummary(): Promise<ReconciliationSummary> {
  const empty: ReconciliationSummary = {
    lastRun: null,
    jobsVerified: 0,
    missingTotal: null,
    publishedCount: 0,
  };
  try {
    const [row] = await db
      .select({
        lastRun: sql<string | null>`max(${contentJobs.artefacts_verified_at})`,
        jobsVerified: sql<number>`cast(count(${contentJobs.artefacts_verified_at}) as integer)`,
        missingTotal: sql<
          number | null
        >`sum(${contentJobs.artefacts_missing_count})`,
        publishedCount: sql<number>`cast(count(*) filter (where ${contentJobs.status} = 'PUBLISHED') as integer)`,
      })
      .from(contentJobs);
    if (!row) return empty;
    return {
      lastRun: row.lastRun ?? null,
      jobsVerified: Number(row.jobsVerified ?? 0),
      // If nothing has been reconciled, missing is unknown, not zero.
      missingTotal:
        row.lastRun == null || row.missingTotal == null
          ? null
          : Number(row.missingTotal),
      publishedCount: Number(row.publishedCount ?? 0),
    };
  } catch {
    return empty;
  }
}

/** Jobs that reached PUBLISHED in the last N hours. */
export async function getPublishedSince(hours: number): Promise<number> {
  const cutoff = new Date(Date.now() - hours * 3_600_000);
  try {
    const [row] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(contentJobs)
      .where(
        and(
          eq(contentJobs.status, "PUBLISHED" as never),
          gte(contentJobs.status_updated_at, cutoff),
        ),
      );
    return Number(row?.count ?? 0);
  } catch {
    return 0;
  }
}
