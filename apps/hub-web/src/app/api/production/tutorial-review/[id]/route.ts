import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray, or } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, thumbnails, tutorialJobs, tutorialUploadDispatches } from "@/lib/db";
import { reserveCompletedTutorialSlots } from "@/lib/tutorial/reserve-publication";
import { assessPublicationVariant } from "@/lib/tutorial/publication-readiness";
import { captureFamilyApproval } from "@/lib/tutorial/capture-family-approval";

export const dynamic = "force-dynamic";

// Keep the old action name compatible with already-open clients. Review is
// never authority to delete recordings or their Drive copies.
const ActionSchema = z.object({
  action: z.enum(["approve", "disapprove"]),
  reason: z.string().trim().max(2000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "create:tutorial-job")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid tutorial id" }, { status: 400 });
  }
  const parsed = ActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid review action" }, { status: 400 });
  }

  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(tutorialJobs)
      .where(eq(tutorialJobs.id, id)).limit(1).for("update");
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    const privileged = hasPermission(session, "manage:tutorial-settings") ||
      session.role === "ADMIN" || session.role === "MANAGER";
    if (job.created_by !== session.userId && !privileged) {
      return NextResponse.json({ error: "That video was produced by someone else." }, { status: 403 });
    }
    if (job.source_job_id) {
      return NextResponse.json({ error: "Review the original English tutorial." }, { status: 409 });
    }
    if (parsed.data.action === "disapprove" && job.va_review_status === "rework_requested") {
      return NextResponse.json({ success: true, status: "rework_requested", idempotent: true });
    }
    if (job.status !== "COMPLETED" || !job.final_path) {
      return NextResponse.json({ error: "Finish processing the video before final review." }, { status: 409 });
    }
    if (parsed.data.action === "approve") {
      const candidates = await tx.select({
        id: thumbnails.id, language: thumbnails.language, channelId: thumbnails.channel_id,
        status: thumbnails.status, isSelected: thumbnails.is_selected, outputPath: thumbnails.output_path,
      }).from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, id)));
      const readiness = assessPublicationVariant(job, candidates);
      if (!readiness.ready) return NextResponse.json({
        error: "Complete the English publication assets before approval.", reasons: readiness.reasons,
      }, { status: 409 });
      let captured: Awaited<ReturnType<typeof captureFamilyApproval>>;
      try { captured = await captureFamilyApproval(tx, job); }
      catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not verify publication assets." }, { status: 409 }); }
      await tx.update(tutorialJobs).set({
        va_review_status: "approved", va_reviewed_at: new Date(), va_reviewed_by: session.userId,
      }).where(eq(tutorialJobs.id, id));
      const plan = await reserveCompletedTutorialSlots(tx, id, new Date(), captured.approvedIds);
      plan.outstanding.push(...captured.unavailable);
      return NextResponse.json({ success: true, status: "approved", plan });
    }

    // Never imply that a rework request recalls an externally scheduled video.
    const family = await tx.select({ id: tutorialJobs.id, status: tutorialJobs.status, uploaded: tutorialJobs.is_uploaded, uploaderStatus: tutorialJobs.uploader_status })
      .from(tutorialJobs).where(or(eq(tutorialJobs.id, id), eq(tutorialJobs.source_job_id, id)));
    const [dispatch] = await tx.select({ id: tutorialUploadDispatches.id })
      .from(tutorialUploadDispatches).where(inArray(tutorialUploadDispatches.tutorial_job_id, family.map((row) => row.id))).limit(1);
    if (dispatch || family.some((row) => row.uploaded || row.uploaderStatus)) {
      return NextResponse.json({ error: "Delivery has already started. Ask an Admin to reconcile or cancel the external upload before reworking this video. No files were changed." }, { status: 409 });
    }
    if (family.some((row) => row.id !== id && row.status && !["COMPLETED", "CANCELLED", "AWAITING_THUMBNAILS"].includes(row.status) && !row.status.startsWith("FAILED"))) {
      return NextResponse.json({ error: "A language version is still processing. Wait for it to settle before replacing the source recording; no files were changed." }, { status: 409 });
    }
    const childIds = family.filter((row) => row.id !== id).map((row) => row.id);
    if (childIds.length) await tx.update(tutorialJobs).set({
      status: "CANCELLED", scheduled_for: null, va_review_status: "rework_requested",
      publication_approval: null,
      error_message: "Source recording requires rework. Retry this language after the new source is approved.",
    }).where(inArray(tutorialJobs.id, childIds));
    await tx.update(tutorialJobs).set({
      va_review_status: "rework_requested",
      publication_approval: null,
      va_reviewed_at: new Date(), va_reviewed_by: session.userId,
      status: "READY_TO_RECORD", progress: 0,
      scheduled_for: null,
      error_message: parsed.data.reason || "Final review requested a new recording. Existing files have been preserved.",
    }).where(eq(tutorialJobs.id, id));
    return NextResponse.json({ success: true, status: "rework_requested", filesPreserved: true });
  });
}
