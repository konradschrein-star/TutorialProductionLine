export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db, contentJobs, eq } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";

/**
 * GET /api/jobs/comparison-metadata?job_id=...
 *
 * Returns comparison metadata for VA panel (products, data grid, sources).
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:job-detail")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const jobId = request.nextUrl.searchParams.get("job_id");

    if (!jobId) {
      return NextResponse.json({ error: "Missing job_id" }, { status: 400 });
    }

    const job = await db.query.contentJobs.findFirst({
      where: eq(contentJobs.id, jobId),
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const comparisonMeta = (job.metadata as any)?.comparison;

    if (!comparisonMeta) {
      return NextResponse.json(
        { error: "Not a comparison job" },
        { status: 400 },
      );
    }

    return NextResponse.json({
      job_id: jobId,
      subformat: comparisonMeta.subformat,
      products: comparisonMeta.products,
      data_grid: comparisonMeta.data_grid,
      research_prompts: comparisonMeta.research_prompts,
      facts_sources_verified_count:
        comparisonMeta.facts_sources_verified_count ?? 0,
    });
  } catch (error: any) {
    console.error("[comparison-metadata] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/jobs/comparison-metadata
 *
 * Updates comparison metadata (e.g., VA audits data grid).
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:job")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await request.json();
    const { job_id, data_grid, data_grid_update, audit_confirmed } = body;

    if (!job_id) {
      return NextResponse.json({ error: "Missing job_id" }, { status: 400 });
    }

    const job = await db.query.contentJobs.findFirst({
      where: eq(contentJobs.id, job_id),
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const comparisonMeta = ((job.metadata as any) ?? {})?.comparison ?? {};

    let updatedDataGrid = comparisonMeta.data_grid;

    // Support full replacement (from editor component)
    if (data_grid) {
      updatedDataGrid = data_grid;
    }
    // Or partial update (legacy)
    else if (data_grid_update) {
      updatedDataGrid = { ...updatedDataGrid, ...data_grid_update };
    }

    // Audit confirmation
    if (audit_confirmed) {
      updatedDataGrid = {
        ...updatedDataGrid,
        audited_at: new Date().toISOString(),
        audited_by_va_id: body.va_user_id,
      };
    }

    const updatedMetadata = {
      ...((job.metadata as any) ?? {}),
      comparison: {
        ...comparisonMeta,
        data_grid: updatedDataGrid,
      },
    };

    await db
      .update(contentJobs)
      .set({ metadata: updatedMetadata })
      .where(eq(contentJobs.id, job_id));

    return NextResponse.json({ success: true, job_id });
  } catch (error: any) {
    console.error("[comparison-metadata] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
