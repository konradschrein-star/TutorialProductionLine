import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { englishThumbnailApprovalRevision, recordApprovedEnglishThumbnailFanout } from "@repo/db";
import { fingerprintStorageSource, withTutorialMediaSet, type TutorialMediaRequest } from "@repo/storage";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { getHubConfig } from "@/lib/config";
import { db, storageArtifacts, thumbnails, tutorialJobs, tutorialSettings, tutorialUploadDispatches, tutorialThumbnailFanout } from "@/lib/db";
const input = z.object({ thumbnailId: z.string().uuid() });
/** Clicking a candidate is explicit approval; selection and fanout intent commit together. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:thumbnails")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a thumbnail candidate." }, { status: 400 });
  const { id } = await params;
  const [initial] = await db.select().from(tutorialJobs).where(eq(tutorialJobs.id, id));
  const privileged = ["ADMIN", "MANAGER"].includes(session.role) || hasPermission(session, "manage:tutorial-settings");
  if (!initial || (!privileged && initial.created_by !== session.userId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return await db.transaction(async tx => {
      const rootId = initial.source_job_id ?? initial.id;
      await tx.select({ id: tutorialJobs.id }).from(tutorialJobs).where(eq(tutorialJobs.id, rootId)).for("update");
      const [job] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, id));
      if (!job || (!privileged && job.created_by !== session.userId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const [settings] = await tx.select().from(tutorialSettings).where(eq(tutorialSettings.id, 1)).for("share");
      if (settings?.thumbnail_generation_mode !== "ai") return NextResponse.json({ error: "AI mode is disabled by the Admin." }, { status: 409 });
      const family = await tx.select({ id: tutorialJobs.id, uploaded: tutorialJobs.is_uploaded, status: tutorialJobs.uploader_status }).from(tutorialJobs).where(or(eq(tutorialJobs.id, rootId), eq(tutorialJobs.source_job_id, rootId)));
      const dispatch = await tx.select({ id: tutorialUploadDispatches.id }).from(tutorialUploadDispatches).where(inArray(tutorialUploadDispatches.tutorial_job_id, family.map(item => item.id))).limit(1);
      if (dispatch.length || family.some(item => item.uploaded || item.status)) return NextResponse.json({ error: "Delivery has started. Reconcile it before changing approved images." }, { status: 409 });
      const [candidate] = await tx.select().from(thumbnails).where(and(eq(thumbnails.id, parsed.data.thumbnailId), eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, id)));
      if (!candidate || !job.channel_id || !job.language || candidate.channel_id !== job.channel_id || candidate.language !== job.language || candidate.status !== "completed" || !candidate.output_path) return NextResponse.json({ error: "This is not a rendered candidate for the current channel and language." }, { status: 409 });
      const media: TutorialMediaRequest[] = [{ jobId: id, kind: "thumbnail", path: candidate.output_path }];
      if (job.source_job_id) {
        const provenance = await tx.select().from(tutorialThumbnailFanout).where(and(eq(tutorialThumbnailFanout.source_job_id, rootId), eq(tutorialThumbnailFanout.output_thumbnail_id, candidate.id), eq(tutorialThumbnailFanout.state, "completed")));
        const approvedEnglish = await tx.select().from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, rootId), eq(thumbnails.language, "en"), eq(thumbnails.is_selected, true)));
        const parent = approvedEnglish[0], receipt = provenance[0];
        if (provenance.length !== 1 || approvedEnglish.length !== 1 || !parent?.channel_id || !receipt || receipt.source_thumbnail_id !== parent.id || receipt.source_path !== parent.output_path || receipt.target_channel_id !== job.channel_id || receipt.target_language !== job.language || !["acceptable", "strong"].includes(parent.review_verdict)) return NextResponse.json({ error: "This localized candidate no longer matches the approved English master. Wait for the current localization." }, { status: 409 });
        const expectedRevision = englishThumbnailApprovalRevision({ sourceJobId: rootId, thumbnailId: parent.id, sourcePath: receipt.source_path, sha256: receipt.source_sha256, size: receipt.source_size }, parent.channel_id);
        if (expectedRevision !== receipt.approval_revision) return NextResponse.json({ error: "English approval revision changed. Regenerate this localization." }, { status: 409 });
        media.push({ jobId: rootId, kind: "thumbnail", path: receipt.source_path, expectedContent: { sha256: receipt.source_sha256, size: receipt.source_size } });
      }
      return withTutorialMediaSet(db, media, { allowedRoots: [getHubConfig().LOCAL_MEDIA_ROOT], maxBytes: 32 * 1024 * 1024, transaction: tx }, async paths => {
        const fingerprint = await fingerprintStorageSource(paths[0]!);
        const english = !job.source_job_id && job.language!.toLowerCase() === "en";
        const childIds = family.filter(item => item.id !== rootId).map(item => item.id);
        if (english && childIds.length) {
          const currentRevision = englishThumbnailApprovalRevision({ sourceJobId: id, thumbnailId: candidate.id, sourcePath: candidate.output_path!, sha256: fingerprint.sha256, size: fingerprint.bytes }, job.channel_id!);
          const previous = await tx.select({ revision: tutorialThumbnailFanout.approval_revision }).from(tutorialThumbnailFanout).where(eq(tutorialThumbnailFanout.source_job_id, rootId));
          const unchanged = candidate.is_selected && ["acceptable", "strong"].includes(candidate.review_verdict) && previous.some(row => row.revision === currentRevision);
          if (!unchanged) {
            await tx.update(thumbnails).set({ is_selected: false, review_verdict: "not_reviewed", reviewed_at: null, updated_at: new Date() }).where(and(eq(thumbnails.subject_kind, "tutorial_job"), inArray(thumbnails.subject_id, childIds)));
            await tx.update(tutorialJobs).set({ publication_approval: null, va_review_status: null, va_reviewed_at: null, va_reviewed_by: null }).where(inArray(tutorialJobs.id, childIds));
          }
        }
        await tx.update(thumbnails).set({ is_selected: false }).where(and(eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, id), eq(thumbnails.language, job.language!)));
        await tx.update(thumbnails).set({ is_selected: true, review_verdict: "acceptable", reviewed_at: new Date(), updated_at: new Date() }).where(eq(thumbnails.id, candidate.id));
        await tx.update(storageArtifacts).set({ state: "pending", vps_path: candidate.output_path!, error_kind: "thumbnail_replaced", error_message: "New approved thumbnail revision awaits archival", updated_at: new Date() }).where(and(eq(storageArtifacts.job_id, id), eq(storageArtifacts.kind, "thumbnail")));
        await tx.update(tutorialJobs).set({ publication_approval: null, va_review_status: null, va_reviewed_at: null, va_reviewed_by: null }).where(eq(tutorialJobs.id, rootId));
        const fanout = english ? await recordApprovedEnglishThumbnailFanout(tx, { sourceJobId: id, thumbnailId: candidate.id, sourcePath: candidate.output_path!, sha256: fingerprint.sha256, size: fingerprint.bytes }) : null;
        return NextResponse.json({ approved: true, thumbnailId: candidate.id, localizationRecorded: english, languages: fanout?.languages ?? [], blockedLocales: fanout?.blockedLocales ?? [] });
      });
    });
  } catch { return NextResponse.json({ error: "Approval could not be committed. Check that this image is available and retry; no partial selection was saved." }, { status: 409 }); }
}
