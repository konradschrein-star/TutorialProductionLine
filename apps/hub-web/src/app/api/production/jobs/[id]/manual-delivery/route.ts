import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, tutorialJobs, channels, tutorialUploadDispatches, tutorialSourceRevision } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { mayAccessDelivery } from "@/lib/tutorial/delivery-access";
import { verifyPublicationApproval } from "@/lib/tutorial/verify-publication-approval";
import { withTutorialAsset } from "@/lib/tutorial/media-access";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
export const dynamic = "force-dynamic";
/** A portable manual handoff. No uploader connection, provider key or Drive required. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (!hasPermission(session, "upload:youtube-video") && !(hasPermission(session, "view:production") && hasPermission(session, "create:tutorial-job"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) return NextResponse.json({ error: "Invalid tutorial ID" }, { status: 400 });
  const query = new URL(request.url).searchParams;
  const asset = z.enum(["metadata", "thumbnail"]).safeParse(query.get("asset") ?? "metadata");
  const requestedRevision = query.get("approvalRevision");
  if (!asset.success || (requestedRevision !== null && !/^[0-9a-f]{64}$/.test(requestedRevision))) return NextResponse.json({ error: "Invalid approved delivery request" }, { status: 400 });
  return db.transaction(async tx => {
    const [initial] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, id.data));
    if (!initial) return NextResponse.json({ error: "Tutorial not found" }, { status: 404 });
    if (!await mayAccessDelivery(session, initial)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const [source] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, initial.source_job_id ?? initial.id)).for("update");
    const [job] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, initial.id)).for("update");
    if (!source || !job || source.va_review_status !== "approved") return NextResponse.json({ error: "Final review is required before manual delivery." }, { status: 409 });
    const [dispatch] = await tx.select().from(tutorialUploadDispatches).where(eq(tutorialUploadDispatches.tutorial_job_id, job.id));
    if (dispatch || job.uploader_job_id || job.upload_verified_at) return NextResponse.json({ error: "A connected uploader owns this delivery. Reconcile it before any manual upload." }, { status: 409 });
    try {
      const sourceApproval = await verifyPublicationApproval(tx, source, tutorialSourceRevision(source));
      const approval = source.id === job.id ? sourceApproval : await verifyPublicationApproval(tx, job, tutorialSourceRevision(source));
      if (requestedRevision && requestedRevision !== approval.revision) return NextResponse.json({ error: "Approval changed. Reload Delivery before downloading." }, { status: 409 });
      const [channel] = await tx.select().from(channels).where(eq(channels.id, job.channel_id!));
      if (asset.data === "thumbnail") {
        const buffer = await withTutorialAsset({ jobId: job.id, kind: "thumbnail", path: approval.identity.thumbnailPath, expectedContent: approval.thumbnail }, path => readFile(path));
        const extension = extname(approval.identity.thumbnailPath).toLowerCase();
        const contentType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
        return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": contentType, "Content-Disposition": `attachment; filename="tutorial-${job.id}-${job.language}-thumbnail${extension || ".jpg"}"`, "Cache-Control": "private, no-store" } });
      }
      return NextResponse.json({ version: "tutorial-manual-delivery/1", tutorialId: job.id, approvalRevision: approval.revision, channel: { id: channel?.id, name: channel?.name, language: channel?.language }, studioPublishAt: job.scheduled_for, title: job.title, description: job.description, tags: job.tags, video: { url: `/api/production/jobs/${job.id}/download?approvalRevision=${approval.revision}`, ...approval.video }, thumbnail: { url: `/api/production/jobs/${job.id}/manual-delivery?asset=thumbnail&approvalRevision=${approval.revision}`, ...approval.thumbnail }, instructions: ["Use the assigned channel; do not choose a different destination.", "Download the assets and verify this approval revision has not changed.", "Use the Studio reservation when scheduling publication.", "Report the YouTube watch link in Delivery; a manual report is not verified publication."] }, { headers: { "Content-Disposition": `attachment; filename="tutorial-${job.id}-${job.language}-metadata.json"`, "Cache-Control": "no-store" } });
    } catch { return NextResponse.json({ error: "Current assets need final review. Do not upload an older download." }, { status: 409 }); }
  });
}
