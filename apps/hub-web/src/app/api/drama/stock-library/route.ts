import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { db, stockClips } from "@/lib/db";
import { verifyToken } from "@/lib/auth/jwt";

export const dynamic = "force-dynamic";

/**
 * GET /api/drama/stock-library
 *
 * Returns the stock library state: counts by status, recent clips
 * (with prompt + video_path), and a small head/tail sample so the
 * operator can sanity-check what's been produced.
 *
 * Query params:
 *   ?limit=50      How many rows to return in `recent` (default 50)
 *   ?status=ready  Filter recent rows by status (queued | generating | ready | failed)
 */
export async function GET(req: NextRequest) {
  const token = (await cookies()).get("hub_session")?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await verifyToken(token);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit = Math.min(Math.max(limitRaw, 1), 500);
  const statusFilter = url.searchParams.get("status");
  const libraryId = url.searchParams.get("libraryId");

  // Scope every query by libraryId when provided. Without it we
  // aggregate the entire stock_clips table (legacy callers).
  const libFilter = libraryId
    ? eq(stockClips.clip_library_id, libraryId)
    : undefined;

  const countsQuery = libFilter
    ? db
        .select({
          status: stockClips.status,
          count: sql<number>`count(*)::int`,
        })
        .from(stockClips)
        .where(libFilter)
        .groupBy(stockClips.status)
    : db
        .select({
          status: stockClips.status,
          count: sql<number>`count(*)::int`,
        })
        .from(stockClips)
        .groupBy(stockClips.status);
  const counts = await countsQuery;

  const byStatus: Record<string, number> = {
    queued: 0,
    generating: 0,
    ready: 0,
    failed: 0,
  };
  for (const c of counts) byStatus[c.status] = c.count;
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

  const oneHourAgo = new Date(Date.now() - 3_600_000);
  const lastHourRow = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(stockClips)
    .where(
      libFilter
        ? and(
            libFilter,
            eq(stockClips.status, "ready"),
            gt(stockClips.created_at, oneHourAgo),
          )
        : and(
            eq(stockClips.status, "ready"),
            gt(stockClips.created_at, oneHourAgo),
          ),
    );
  const readyLastHour = lastHourRow[0]?.n ?? 0;

  const [lastReadyRow] = await db
    .select({ created_at: stockClips.created_at })
    .from(stockClips)
    .where(
      libFilter
        ? and(libFilter, eq(stockClips.status, "ready"))
        : eq(stockClips.status, "ready"),
    )
    .orderBy(desc(stockClips.created_at))
    .limit(1);

  const whereForRecent = statusFilter
    ? libFilter
      ? and(libFilter, eq(stockClips.status, statusFilter))
      : eq(stockClips.status, statusFilter)
    : libFilter;

  const recent = whereForRecent
    ? await db
        .select()
        .from(stockClips)
        .where(whereForRecent)
        .orderBy(desc(stockClips.created_at))
        .limit(limit)
    : await db
        .select()
        .from(stockClips)
        .orderBy(desc(stockClips.created_at))
        .limit(limit);

  return NextResponse.json({
    counts: byStatus,
    total,
    last_ready_at: lastReadyRow?.created_at ?? null,
    ready_last_hour: readyLastHour,
    recent: recent.map((r) => ({
      id: r.id,
      video_path: r.video_path,
      duration_sec: Number(r.duration_sec),
      prompt: r.prompt,
      vibe_tag: r.vibe_tag,
      status: r.status,
      origin: r.origin,
      veo_job_id: r.veo_job_id,
      created_at: r.created_at,
      last_used_at: r.last_used_at,
    })),
  });
}
