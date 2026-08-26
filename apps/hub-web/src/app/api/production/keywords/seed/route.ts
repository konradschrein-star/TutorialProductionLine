import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/production/keywords/seed
 *
 * The "Initial Keywords" fallback list — the ~2,150 guide-realm keywords from
 * the previous tutorial tool, copied into hub-web's OWN Postgres (see migrations
 * 0065 + 0066). This route reads ONLY that local table and never touches the
 * Keyword Tool, so it keeps working when the Keyword Tool app is down. That
 * resilience is the entire reason the fallback exists.
 *
 * Query params:
 *   search   — matches title OR software (case-insensitive substring)
 *   status   — CSV of workflow states to include (NEW,IN_PROGRESS,DONE)
 *   length   — CSV of length_class values (e.g. "<3min,3-6min")
 *   under3   — "1" to force duration_sec < 180 (the standard short filter)
 *   offset / limit — pagination (limit capped at 100)
 *
 * Deleted rows (deleted_at set — "don't want to do") are always excluded.
 * Returns the workflow `status` per row plus per-status counts for the tabs.
 * Requires view:production.
 */

const VALID_STATUSES = ["NEW", "IN_PROGRESS", "DONE"] as const;

export async function GET(request: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const search = (url.searchParams.get("search") ?? "").trim();
  const under3 = url.searchParams.get("under3") === "1";
  const lengths = (url.searchParams.get("length") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const statuses = (url.searchParams.get("status") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is (typeof VALID_STATUSES)[number] =>
      (VALID_STATUSES as readonly string[]).includes(s),
    );
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 40));

  // Shared filters that DON'T depend on the status tab — the per-status counts
  // must reflect search/length, but not the currently-selected status.
  const baseConds = [sql`sk.deleted_at IS NULL`];
  if (search) {
    const like = `%${search}%`;
    baseConds.push(sql`(sk.title ILIKE ${like} OR sk.software ILIKE ${like})`);
  }
  if (under3) {
    baseConds.push(sql`sk.duration_sec < 180`);
  }
  if (lengths.length > 0) {
    baseConds.push(
      sql`sk.length_class IN (${sql.join(
        lengths.map((l) => sql`${l}`),
        sql`, `,
      )})`,
    );
  }
  const baseWhere = sql.join(baseConds, sql` AND `);

  // Per-status counts (independent of the selected status tab).
  const countRows = (await db.execute<{ status: string; n: number }>(
    sql`SELECT sk.status AS status, COUNT(*)::int AS n
        FROM seed_keywords sk WHERE ${baseWhere} GROUP BY sk.status`,
  )) as unknown as Array<{ status: string; n: number }>;
  const counts: Record<string, number> = { NEW: 0, IN_PROGRESS: 0, DONE: 0 };
  let all = 0;
  for (const r of countRows) {
    counts[r.status] = Number(r.n);
    all += Number(r.n);
  }

  // The list itself additionally filters by the selected status tab.
  const listWhere =
    statuses.length > 0
      ? sql`${baseWhere} AND sk.status IN (${sql.join(
          statuses.map((s) => sql`${s}`),
          sql`, `,
        )})`
      : baseWhere;

  const total =
    statuses.length > 0
      ? statuses.reduce((sum, s) => sum + (counts[s] ?? 0), 0)
      : all;

  const rows = (await db.execute<{
    id: number;
    title: string;
    software: string | null;
    content_type: string | null;
    length_class: string | null;
    duration_sec: number | null;
    video_id: string | null;
    status: string;
  }>(
    sql`
      SELECT sk.id, sk.title, sk.software, sk.content_type, sk.length_class,
             sk.duration_sec, sk.video_id, sk.status
      FROM seed_keywords sk
      WHERE ${listWhere}
      ORDER BY (sk.duration_sec IS NULL), sk.duration_sec ASC, sk.id ASC
      LIMIT ${limit} OFFSET ${offset}
    `,
  )) as unknown as Array<{
    id: number;
    title: string;
    software: string | null;
    content_type: string | null;
    length_class: string | null;
    duration_sec: number | null;
    video_id: string | null;
    status: string;
  }>;

  const keywords = rows.map((r) => ({
    id: r.id,
    title: r.title,
    software: r.software,
    contentType: r.content_type,
    lengthClass: r.length_class,
    durationSec: r.duration_sec,
    referenceUrl: r.video_id
      ? `https://www.youtube.com/watch?v=${r.video_id}`
      : null,
    status: r.status,
  }));

  return NextResponse.json({
    total,
    offset,
    limit,
    hasMore: offset + keywords.length < total,
    counts: { ...counts, ALL: all },
    keywords,
  });
}
