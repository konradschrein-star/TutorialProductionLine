import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getTutorialJobById } from "@repo/db";
import { createStitchJobForTutorial } from "@/lib/production/create-stitch-job";

export const dynamic = "force-dynamic";

/**
 * POST /api/production/jobs/[id]/send-to-stitcher
 *
 * Hands off a LONG_FORM parent tutorial job (with all parts RECORDED) to
 * the video stitch pipeline by:
 *   1. Copying each child part's recording + audio into stitch-upload folders.
 *   2. Creating a videoStitchJobs row in DRAFT status with alignment_mode "segmented".
 *   3. Updating the parent tutorial job to SENT_TO_STITCHER.
 *
 * Idempotent: if stitch_job_id is already set, returns it immediately.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // This is a tutorial-production action: the VA who recorded the parts
  // hands their own job off to the stitch pipeline. Gate it like the other
  // /api/production routes (create:tutorial-job + ownership), NOT on the
  // admin-only create:job — that locked tutorial VAs out of finishing their
  // own long-form videos.
  const session = await getSession();
  if (!session || !hasPermission(session, "create:tutorial-job")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const parent = await getTutorialJobById(db, id);
  if (!parent || parent.mode !== "LONG_FORM" || parent.parent_job_id !== null) {
    return NextResponse.json(
      { error: "Not a long-form parent" },
      { status: 400 },
    );
  }

  // Owners can hand off their own job; admins/managers can hand off any.
  const isOwner = parent.created_by === session.userId;
  const isPrivileged =
    hasPermission(session, "manage:tutorial-settings") ||
    session.role === "ADMIN" ||
    session.role === "MANAGER";
  if (!isOwner && !isPrivileged) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Delegate the actual copy/insert/promote to the shared core so the manual
  // button and the recording-route auto-fire stay in lock-step.
  const result = await createStitchJobForTutorial(db, id, {
    createdByUserId: session.userId,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json({ stitch_job_id: result.stitchJobId });
}
