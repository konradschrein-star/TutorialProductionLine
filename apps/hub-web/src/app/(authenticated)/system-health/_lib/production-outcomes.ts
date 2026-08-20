import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Outcome signals taken from REAL PRODUCTION TABLES, not from provider pings.
 *
 * Why this exists: in July 2026 all 57 rows in `thumbnails` were `failed`
 * with a NULL output_path, for weeks, and nobody noticed — because every
 * provider answered its health check the whole time. A green dot next to a
 * provider says "it picks up the phone". It says nothing about whether the
 * work came out. These queries answer the second question, which is the one
 * that actually matters, so they sit ABOVE provider status on the page.
 *
 * Each check is independently guarded: a missing table or column degrades
 * that one row to `available: false` rather than blanking the page.
 */

export interface OutcomeSignal {
  key: string;
  label: string;
  /** false when the underlying table could not be queried at all. */
  available: boolean;
  total: number;
  succeeded: number;
  failed: number;
  pending: number;
  /** null when total is 0 — do not render "100%" for an empty table. */
  successRate: number | null;
  /** Total failure across a meaningful number of attempts. The headline. */
  sustainedFailure: boolean;
  detail: string | null;
}

const SUSTAINED_MIN = 5;

function signal(
  key: string,
  label: string,
  counts: { succeeded: number; failed: number; pending: number },
  detail: string | null,
): OutcomeSignal {
  const total = counts.succeeded + counts.failed + counts.pending;
  const decided = counts.succeeded + counts.failed;
  return {
    key,
    label,
    available: true,
    total,
    succeeded: counts.succeeded,
    failed: counts.failed,
    pending: counts.pending,
    successRate: decided > 0 ? counts.succeeded / decided : null,
    sustainedFailure: decided >= SUSTAINED_MIN && counts.succeeded === 0,
    detail,
  };
}

function unavailable(key: string, label: string, why: string): OutcomeSignal {
  return {
    key,
    label,
    available: false,
    total: 0,
    succeeded: 0,
    failed: 0,
    pending: 0,
    successRate: null,
    sustainedFailure: false,
    detail: why,
  };
}

async function thumbnailOutcomes(): Promise<OutcomeSignal> {
  try {
    const rows = await db.execute<{ status: string; n: string }>(
      sql`SELECT status::text AS status, count(*)::text AS n FROM thumbnails GROUP BY status`,
    );
    const by: Record<string, number> = {};
    for (const r of rows as unknown as Array<{ status: string; n: string }>) {
      by[r.status] = Number(r.n);
    }
    const succeeded = (by["completed"] ?? 0) + (by["approved"] ?? 0);
    const failed = by["failed"] ?? 0;
    const pending =
      (by["pending"] ?? 0) + (by["generating"] ?? 0) + (by["queued"] ?? 0);
    return signal(
      "thumbnails",
      "Thumbnail generation",
      { succeeded, failed, pending },
      Object.entries(by)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ") || null,
    );
  } catch (err) {
    return unavailable(
      "thumbnails",
      "Thumbnail generation",
      `Could not read the thumbnails table: ${
        err instanceof Error ? err.message.slice(0, 120) : String(err)
      }`,
    );
  }
}

async function jobOutcomes(): Promise<OutcomeSignal> {
  try {
    const rows = await db.execute<{ status: string; n: string }>(
      sql`SELECT status::text AS status, count(*)::text AS n
          FROM content_jobs
          WHERE updated_at > now() - interval '7 days'
          GROUP BY status`,
    );
    let succeeded = 0;
    let failed = 0;
    let pending = 0;
    for (const r of rows as unknown as Array<{ status: string; n: string }>) {
      const n = Number(r.n);
      if (r.status.startsWith("FAILED")) failed += n;
      else if (
        r.status === "PUBLISHED" ||
        r.status === "AWAITING_UPLOADER" ||
        r.status === "UPLOADING"
      ) {
        succeeded += n;
      } else pending += n;
    }
    return signal(
      "jobs",
      "Content jobs (7d)",
      { succeeded, failed, pending },
      "Reached-uploader counts as succeeded; anything FAILED_* as failed.",
    );
  } catch (err) {
    return unavailable(
      "jobs",
      "Content jobs (7d)",
      `Could not read content_jobs: ${
        err instanceof Error ? err.message.slice(0, 120) : String(err)
      }`,
    );
  }
}

export async function loadProductionOutcomes(): Promise<OutcomeSignal[]> {
  return Promise.all([thumbnailOutcomes(), jobOutcomes()]);
}
