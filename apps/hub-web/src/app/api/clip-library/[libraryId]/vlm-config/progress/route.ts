import { NextRequest, NextResponse } from "next/server";
import { eq, count, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { clips } from "@repo/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ libraryId: string }> },
) {
  try {
    const session = await getSession();
    if (!session)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { libraryId } = await params;

    const [totals] = await db
      .select({
        total: count(),
        labeled: sql<number>`count(*) filter (where labeling_step = 'minicpm')`,
        has_description: sql<number>`count(*) filter (where ai_description is not null)`,
      })
      .from(clips)
      .where(eq(clips.library_id, libraryId));

    const total = Number(totals?.total ?? 0);
    const labeled = Number(totals?.labeled ?? 0);
    const has_description = Number(totals?.has_description ?? 0);
    const pending = total - labeled;

    // Count by labeling_step for breakdown
    const stepRows = await db
      .select({
        step: clips.labeling_step,
        n: count(),
      })
      .from(clips)
      .where(eq(clips.library_id, libraryId))
      .groupBy(clips.labeling_step);

    const by_step: Record<string, number> = {};
    for (const row of stepRows) {
      by_step[row.step ?? "null"] = Number(row.n);
    }

    return NextResponse.json({
      total,
      labeled,
      pending,
      has_description,
      by_step,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
