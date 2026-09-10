import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, tutorialJobs, tutorialSourceRevision } from "@/lib/db";
import { mayAccessDelivery } from "@/lib/tutorial/delivery-access";
import { verifyPublicationApproval } from "@/lib/tutorial/verify-publication-approval";
import { openTutorialAssetStream } from "@/lib/tutorial/media-access";

export const dynamic = "force-dynamic";

/**
 * GET /api/production/jobs/[id]/download
 *
 * Direct download endpoint for manual uploaders to download the finished tutorial MP4.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session || (!hasPermission(session, "view:production") && !hasPermission(session, "upload:youtube-video"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Valid job ID required" }, { status: 400 });
  }

  try {
    const job = await db.query.tutorialJobs.findFirst({
      where: eq(tutorialJobs.id, id),
    });

    if (!job) {
      return NextResponse.json({ error: "Tutorial job not found" }, { status: 404 });
    }

    if (!await mayAccessDelivery(session, job)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (session.role === "UPLOADER_VA" && (job.status !== "COMPLETED" || !job.publication_approval)) return NextResponse.json({ error: "Final review is required before delivery." }, { status: 409 });

    let filePath = job.final_path || job.recording_path;
    let expectedContent: { sha256: string; size: number } | undefined;
    const requestedRevision = new URL(request.url).searchParams.get("approvalRevision");
    if (session.role === "UPLOADER_VA" || requestedRevision) {
      try {
        const approved = await db.transaction(async tx => {
          const [source] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, job.source_job_id ?? job.id)).for("update");
          const [current] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, job.id)).for("update");
          if (!source || !current || source.va_review_status !== "approved" || !await mayAccessDelivery(session, current)) throw new Error("Review required");
          const sourceApproval = await verifyPublicationApproval(tx, source, tutorialSourceRevision(source));
          const approval = source.id === current.id ? sourceApproval : await verifyPublicationApproval(tx, current, tutorialSourceRevision(source));
          if (requestedRevision && requestedRevision !== approval.revision) throw new Error("Approval changed");
          return { path: current.final_path, video: approval.video };
        });
        filePath = approved.path;
        expectedContent = approved.video;
      } catch {
        return NextResponse.json({ error: "Current video, thumbnail and metadata need final review. Do not upload an older download." }, { status: 409 });
      }
    }
    if (!filePath) {
      return NextResponse.json(
        { error: "Video file not found on disk" },
        { status: 404 },
      );
    }

    const sanitizedTitle = (job.title || "tutorial")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 80);
    const filename = `${sanitizedTitle}_${job.language || "EN"}.mp4`;

    const media = await openTutorialAssetStream({ jobId: job.id, kind: filePath === job.final_path ? "final_video" : "raw_recording", path: filePath, ...(expectedContent ? { expectedContent } : {}) }, { range: request.headers.get("range") });
    const disposition = new URL(request.url).searchParams.get("inline") === "1" ? "inline" : "attachment";

    return new NextResponse(media.stream as unknown as BodyInit, {
      status: media.status,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(media.contentLength),
        "Content-Disposition": `${disposition}; filename="${filename}"`,
        "Accept-Ranges": "bytes",
        ...(media.contentRange ? { "Content-Range": media.contentRange } : {}),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error(`Failed to stream download for job ${id}:`, error);
    return NextResponse.json(
      { error: "Download failed" },
      { status: 500 },
    );
  }
}
