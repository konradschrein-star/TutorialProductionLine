import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/(authenticated)/_lib/v2-auth";
import { hasPermission } from "@/lib/auth/rbac";
import { db, contentJobs } from "@/lib/db";
import { eq, desc, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

const TERMINAL = [
  "DELETED",
  "PUBLISHED",
  "CANCELLED",
  "FAILED_IRRECOVERABLE",
] as const;

/**
 * GET /api/drama/active-jobs
 *
 * Default: recent non-terminal LONG_FORM_DRAMA jobs (15).
 *
 * With ?ids=uuid1,uuid2,... — return only those job ids (no terminal
 * filter, so the post-create dashboard can keep showing them after
 * they reach PUBLISHED).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!hasPermission(session, "view:jobs")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const idsParam = url.searchParams.get("ids");
  if (idsParam) {
    const ids = idsParam
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^[0-9a-f-]{36}$/.test(s));
    if (ids.length === 0) return NextResponse.json([]);
    const rows = await db
      .select({
        id: contentJobs.id,
        title: contentJobs.title,
        status: contentJobs.status,
        status_updated_at: contentJobs.status_updated_at,
      })
      .from(contentJobs)
      .where(inArray(contentJobs.id, ids));
    return NextResponse.json(rows);
  }

  const rows = await db
    .select({
      id: contentJobs.id,
      title: contentJobs.title,
      status: contentJobs.status,
      status_updated_at: contentJobs.status_updated_at,
    })
    .from(contentJobs)
    .where(eq(contentJobs.format, "LONG_FORM_DRAMA"))
    .orderBy(desc(contentJobs.created_at))
    .limit(15);

  const active = rows.filter(
    (r) => !TERMINAL.includes(r.status as (typeof TERMINAL)[number]),
  );

  return NextResponse.json(active);
}
