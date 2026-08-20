import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { db, contentJobs } from "@/lib/db";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/jobs/[id]
 *
 * Fetch a single job with full data including assembly_manifest and generation_log.
 * Used by Image QC, Final QC, and other review UIs.
 *
 * Returns:
 * - 200: Full job object
 * - 401: Not authenticated
 * - 404: Job not found
 * - 500: Server error
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Check authentication
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Extract job ID
    const { id: jobId } = await params;
    if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) {
      return NextResponse.json({ error: "Invalid job ID" }, { status: 400 });
    }

    // Query job
    const [job] = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, jobId))
      .limit(1);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Return full job object (includes generation_log and assembly_manifest)
    return NextResponse.json(job);
  } catch (error) {
    console.error("GET /api/jobs/[id] error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
