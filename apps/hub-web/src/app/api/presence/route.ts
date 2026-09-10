import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, users } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const nowIso = now.toISOString();
  await db
    .update(users)
    .set({
      // Heartbeats are 60s apart. Cap a contribution at 90s and count nothing
      // after a long disconnect so offline time never inflates the metric.
      online_seconds_total: sql`${users.online_seconds_total} + CASE
        WHEN ${users.last_seen_at} IS NOT NULL
         AND ${users.last_seen_at} > ${nowIso}::timestamptz - interval '120 seconds'
        THEN LEAST(90, GREATEST(0, EXTRACT(EPOCH FROM (${nowIso}::timestamptz - ${users.last_seen_at}))::integer))
        ELSE 0 END`,
      last_seen_at: now,
    })
    .where(eq(users.id, session.userId));

  return NextResponse.json({ ok: true, seenAt: now.toISOString() });
}
