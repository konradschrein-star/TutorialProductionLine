import { NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db, contentJobs } from "@/lib/db";
import { extractRanking, pendingCount, rankedCount } from "@/lib/ranking-blocks";

export const dynamic = "force-dynamic";

/**
 * GET /api/production/jobs/awaiting-va-review
 *
 * Worklist for the B-Roll Selection Studio: every job parked at
 * AWAITING_VA_REVIEW, with block progress counts.
 *
 * → { jobs: [{ id, topic, blocksTotal, blocksPending }] }
 */
export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const rows = await db
    .select({
      id: contentJobs.id,
      title: contentJobs.title,
      metadata: contentJobs.metadata,
    })
    .from(contentJobs)
    .where(eq(contentJobs.status, "AWAITING_VA_REVIEW" as never))
    .orderBy(asc(contentJobs.updated_at));

  const jobs = rows.map((row) => {
    const ranking = extractRanking(row.metadata);
    const topic = ranking?.topic ?? row.title ?? "";
    const blocksTotal = ranking ? rankedCount(ranking) : 0;
    const blocksPending = ranking ? pendingCount(ranking) : 0;
    return { id: row.id, topic, blocksTotal, blocksPending };
  });

  return NextResponse.json({ jobs });
}
