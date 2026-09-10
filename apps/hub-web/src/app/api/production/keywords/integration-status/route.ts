import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type CountRow = Record<string, string | number | Date | null>;

/**
 * Admin-only reconciliation summary. This deliberately returns counts rather
 * than scripts, callback payloads, tokens or user data. A working embed is not
 * proof that the two lifecycle databases agree.
 */
export async function GET() {
  const session = await getSession();
  const privileged = session && (
    session.role === "ADMIN" ||
    session.role === "MANAGER" ||
    hasPermission(session, "manage:tutorial-settings")
  );
  if (!privileged) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [jobsResult, outboxResult] = await Promise.all([
    db.execute(sql`
      SELECT
        COUNT(*)::int AS total_jobs,
        COUNT(*) FILTER (WHERE parent_job_id IS NULL)::int AS root_jobs,
        COUNT(*) FILTER (WHERE keyword_ref IS NOT NULL AND keyword_ref <> '')::int AS keyword_bound,
        COUNT(*) FILTER (WHERE parent_job_id IS NULL AND source_job_id IS NULL
          AND keyword_ref IS NOT NULL AND keyword_ref <> '')::int AS root_keyword_bound,
        COUNT(*) FILTER (WHERE parent_job_id IS NULL AND source_job_id IS NULL
          AND keyword_ref ~ '^[0-9]+$')::int AS numeric_keyword_refs,
        COUNT(*) FILTER (WHERE parent_job_id IS NULL AND source_job_id IS NULL
          AND (keyword_ref IS NULL OR keyword_ref = ''))::int AS unbound_legacy,
        COUNT(*) FILTER (WHERE channel_id IS NULL)::int AS missing_channel
      FROM tutorial_jobs
    `),
    db.execute(sql`
      SELECT
        COUNT(*)::int AS total_events,
        COUNT(*) FILTER (WHERE delivered_at IS NOT NULL)::int AS delivered,
        COUNT(*) FILTER (WHERE delivered_at IS NULL)::int AS pending,
        COUNT(*) FILTER (WHERE delivered_at IS NULL AND attempts >= 8)::int AS needs_attention,
        COALESCE(MAX(attempts) FILTER (WHERE delivered_at IS NULL), 0)::int AS max_attempts,
        MIN(created_at) FILTER (WHERE delivered_at IS NULL) AS oldest_pending_at,
        MAX(delivered_at) AS latest_delivered_at
      FROM tutorial_keyword_outbox
    `),
  ]);
  const jobs = (jobsResult[0] ?? {}) as CountRow;
  const outbox = (outboxResult[0] ?? {}) as CountRow;
  const configured = Boolean(process.env.KT_STATUS_WEBHOOK_URL && process.env.KT_WEBHOOK_SECRET);
  const needsAttention = Number(outbox.needs_attention ?? 0);

  return NextResponse.json({
    integration: configured ? "configured" : "not_configured",
    lifecycleHealth: !configured ? "disabled" : needsAttention > 0 ? "needs_attention" : "operational",
    studio: {
      totalJobs: Number(jobs.total_jobs ?? 0),
      rootJobs: Number(jobs.root_jobs ?? 0),
      keywordBound: Number(jobs.keyword_bound ?? 0),
      rootKeywordBound: Number(jobs.root_keyword_bound ?? 0),
      numericKeywordRefs: Number(jobs.numeric_keyword_refs ?? 0),
      unboundLegacy: Number(jobs.unbound_legacy ?? 0),
      missingChannel: Number(jobs.missing_channel ?? 0),
    },
    outbox: {
      totalEvents: Number(outbox.total_events ?? 0),
      delivered: Number(outbox.delivered ?? 0),
      pending: Number(outbox.pending ?? 0),
      needsAttention,
      maxAttempts: Number(outbox.max_attempts ?? 0),
      oldestPendingAt: outbox.oldest_pending_at ?? null,
      latestDeliveredAt: outbox.latest_delivered_at ?? null,
    },
    reconciliation: {
      automaticCandidates: Number(jobs.numeric_keyword_refs ?? 0),
      manualAuditRequired: Number(jobs.unbound_legacy ?? 0),
      note: "Jobs without an exact keyword_ref cannot be safely backfilled by title.",
    },
  });
}
