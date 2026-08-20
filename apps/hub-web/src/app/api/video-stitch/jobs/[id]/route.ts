import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { videoStitchJobs } from "@repo/db";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/video-stitch/jobs/[id]
 * Delete a video stitch job
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Allow tutorial VAs too — the delete below scopes to the caller's own
  // jobs (created_by_user_id), so a VA can only delete their own.
  const session = await getSession();
  if (
    !session ||
    (!hasPermission(session, "create:job") &&
      !hasPermission(session, "create:tutorial-job"))
  ) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    await db
      .delete(videoStitchJobs)
      .where(
        and(
          eq(videoStitchJobs.id, id),
          eq(videoStitchJobs.created_by_user_id, session.userId),
        ),
      );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to delete job", err);
    return NextResponse.json(
      { error: "Failed to delete job" },
      { status: 500 },
    );
  }
}
