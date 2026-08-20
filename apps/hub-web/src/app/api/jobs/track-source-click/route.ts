export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, contentJobs, eq } from "@/lib/db";

/**
 * POST /api/jobs/track-source-click
 *
 * Increments facts_sources_verified_count when VA clicks a source link.
 * Used for tracking VA source verification progress.
 */
export async function POST(request: NextRequest) {
  // `/api/jobs` is on the middleware bypass list, so this handler is the only
  // access control — and this mutates content_jobs.metadata. view:job-detail is
  // the permission every role that can open a job detail page already holds, so
  // the VA click-tracking workflow is unchanged; anonymous callers are not.
  const session = await getSession();
  if (!session || !hasPermission(session, "view:job-detail")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { job_id, source_url } = body;

    if (!job_id || !source_url) {
      return NextResponse.json(
        { error: "Missing job_id or source_url" },
        { status: 400 },
      );
    }

    const job = await db.query.contentJobs.findFirst({
      where: eq(contentJobs.id, job_id),
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const comparisonMeta = ((job.metadata as any) ?? {})?.comparison ?? {};
    const currentCount = comparisonMeta.facts_sources_verified_count ?? 0;

    const updatedMetadata = {
      ...((job.metadata as any) ?? {}),
      comparison: {
        ...comparisonMeta,
        facts_sources_verified_count: currentCount + 1,
      },
    };

    await db
      .update(contentJobs)
      .set({ metadata: updatedMetadata })
      .where(eq(contentJobs.id, job_id));

    return NextResponse.json({
      success: true,
      job_id,
      verified_count: currentCount + 1,
    });
  } catch (error: any) {
    console.error("[track-source-click] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
