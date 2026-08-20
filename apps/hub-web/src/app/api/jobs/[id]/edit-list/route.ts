import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db, jobEditLists, contentJobs } from "@/lib/db";
import { EditListSchema } from "@repo/contracts";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id: jobId } = await params;
    if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) {
      return NextResponse.json({ error: "Invalid job ID" }, { status: 400 });
    }

    const [job] = await db
      .select({
        id: contentJobs.id,
        title: contentJobs.title,
        status: contentJobs.status,
      })
      .from(contentJobs)
      .where(eq(contentJobs.id, jobId))
      .limit(1);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const [editList] = await db
      .select()
      .from(jobEditLists)
      .where(eq(jobEditLists.job_id, jobId))
      .orderBy(desc(jobEditLists.version))
      .limit(1);

    if (!editList) {
      return NextResponse.json(
        { error: "No edit list found for this job. Run clip selection first." },
        { status: 404 },
      );
    }

    const entriesParsed = EditListSchema.safeParse(editList.entries);
    const entries = entriesParsed.success ? entriesParsed.data : [];

    const withClip = entries.filter(
      (e) => !e.is_fallback && (e.clips?.length ?? 0) > 0,
    ).length;
    const fallback = entries.filter((e) => e.is_fallback).length;
    const scores = entries
      .filter((e) => !e.is_fallback && typeof e.match_score === "number")
      .map((e) => e.match_score as number);
    const avgScore =
      scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    return NextResponse.json({
      editList: { ...editList, entries },
      job,
      coverage: {
        total: entries.length,
        withClip,
        fallback,
        avgScore: Math.round(avgScore * 100) / 100,
      },
    });
  } catch (error) {
    console.error("GET /api/jobs/[id]/edit-list error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
