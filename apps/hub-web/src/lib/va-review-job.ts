/**
 * Shared loading + validation for the B-Roll Selection Studio (RANKING) API
 * routes. Fetches a job, confirms it is a RANKING job with a usable
 * `metadata.ranking` slice, and returns a typed result the routes can branch on.
 */
import { eq } from "drizzle-orm";
import { db, contentJobs } from "@/lib/db";
import { extractRanking } from "@/lib/ranking-blocks";
import type { RankingMetadata } from "@repo/contracts";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export interface LoadedRankingJob {
  ok: true;
  job: {
    id: string;
    status: string;
    title: string | null;
    metadata: Record<string, unknown>;
  };
  ranking: RankingMetadata;
}

export interface LoadFailure {
  ok: false;
  status: number;
  error: string;
}

/**
 * Load a RANKING job by id and parse its ranking metadata. Returns a
 * discriminated result: `ok:true` with `{job, ranking}`, or `ok:false` with an
 * HTTP status + message the route can return directly.
 */
export async function loadRankingJob(
  jobId: string,
): Promise<LoadedRankingJob | LoadFailure> {
  if (!jobId || !UUID_RE.test(jobId)) {
    return { ok: false, status: 400, error: "Invalid job ID" };
  }

  const [row] = await db
    .select({
      id: contentJobs.id,
      status: contentJobs.status,
      format: contentJobs.format,
      title: contentJobs.title,
      metadata: contentJobs.metadata,
      paused_from_status: contentJobs.paused_from_status,
      state_machine_history: contentJobs.state_machine_history,
    })
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);

  if (!row) {
    return { ok: false, status: 404, error: "Job not found" };
  }
  if (row.format !== "RANKING") {
    return {
      ok: false,
      status: 400,
      error: `Job ${jobId} is not a RANKING job (format: ${row.format})`,
    };
  }

  const ranking = extractRanking(row.metadata);
  if (!ranking) {
    return {
      ok: false,
      status: 400,
      error: "Job has no ranking metadata (metadata.ranking missing)",
    };
  }

  return {
    ok: true,
    job: {
      id: row.id,
      status: row.status,
      title: row.title,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
    },
    ranking,
  };
}
