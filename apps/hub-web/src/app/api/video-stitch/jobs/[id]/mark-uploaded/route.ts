import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { videoStitchJobs } from "@repo/db";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * POST /api/video-stitch/jobs/[id]/mark-uploaded
 *
 * Mark a video stitch job as uploaded (user has downloaded and uploaded to YouTube).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: jobId } = await params;

  // Allow tutorial VAs too — the UPDATE below scopes to the caller's own
  // jobs (created_by_user_id), so a VA can only mark their own as uploaded.
  const session = await getSession();
  if (
    !session ||
    (!hasPermission(session, "create:job") &&
      !hasPermission(session, "create:tutorial-job"))
  ) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  // Validate UUID format
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(jobId)) {
    return NextResponse.json(
      { error: "Invalid job ID format" },
      { status: 400 },
    );
  }

  try {
    // Update job status to UPLOADED with ownership check and status validation
    // This prevents race conditions by checking ownership and current status atomically
    const [updatedJob] = await db
      .update(videoStitchJobs)
      .set({
        status: "UPLOADED",
        updated_at: new Date(),
      })
      .where(
        and(
          eq(videoStitchJobs.id, jobId),
          eq(videoStitchJobs.created_by_user_id, session.userId),
          eq(videoStitchJobs.status, "RENDERED"), // Only allow RENDERED → UPLOADED
        ),
      )
      .returning();

    if (!updatedJob) {
      return NextResponse.json(
        { error: "Job not found or not in RENDERED status" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      id: updatedJob.id,
      status: updatedJob.status,
      progress: updatedJob.progress,
      output_filename: updatedJob.output_filename,
      created_at: updatedJob.created_at.toISOString(),
      updated_at: updatedJob.updated_at.toISOString(),
    });
  } catch (err) {
    console.error("Failed to mark job as uploaded", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      jobId,
      userId: session.userId,
    });

    // Return generic error to avoid leaking implementation details
    return NextResponse.json(
      { error: "Failed to update job" },
      { status: 500 },
    );
  }
}
