import { and, eq, inArray, or } from "drizzle-orm";
import { tutorialJobs, thumbnails, tutorialSourceRevision, type DrizzleClient } from "@repo/db";
import { capturePublicationApproval } from "@repo/media-core";
import { assessPublicationVariant } from "./publication-readiness";
import { withPublicationMedia } from "./media-access";
type Transaction = Parameters<Parameters<DrizzleClient["transaction"]>[0]>[0];

/** Caller holds the root lock. Missing locales do not block the English review. */
export async function captureFamilyApproval(tx: Transaction, root: typeof tutorialJobs.$inferSelect) {
  const family = await tx.select().from(tutorialJobs).where(or(eq(tutorialJobs.id, root.id), eq(tutorialJobs.source_job_id, root.id)));
  const assets = await tx.select({ id: thumbnails.id, subjectId: thumbnails.subject_id, language: thumbnails.language, channelId: thumbnails.channel_id, status: thumbnails.status, isSelected: thumbnails.is_selected, outputPath: thumbnails.output_path }).from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), inArray(thumbnails.subject_id, family.map((job) => job.id))));
  const approvedIds: string[] = [];
  const unavailable: Array<{ jobId: string; reason: string }> = [];
  const ordered = [root, ...family.filter((job) => job.id !== root.id)];
  for (const job of ordered) {
    const readiness = assessPublicationVariant(job, assets.filter((asset) => asset.subjectId === job.id));
    if (!readiness.ready || !readiness.thumbnail) {
      unavailable.push({ jobId: job.id, reason: readiness.reasons.join(" ") });
      continue;
    }
    try {
      const thumbnail = readiness.thumbnail;
      const approval = await withPublicationMedia(job.id, job.final_path!, thumbnail.outputPath!, () => capturePublicationApproval({ jobId: job.id, channelId: job.channel_id!, language: job.language!, sourceRevision: tutorialSourceRevision(root), title: job.title, description: job.description!, tags: job.tags!, videoPath: job.final_path!, thumbnailId: thumbnail.id, thumbnailPath: thumbnail.outputPath! }), tx);
      await tx.update(tutorialJobs).set({ publication_approval: { ...approval } }).where(eq(tutorialJobs.id, job.id));
      approvedIds.push(job.id);
    } catch {
      const reason = "Video or thumbnail bytes could not be verified. Restore the asset or finish processing, then repeat final review.";
      if (job.id === root.id) throw new Error(reason);
      unavailable.push({ jobId: job.id, reason });
    }
  }
  if (!approvedIds.includes(root.id)) throw new Error("The English publication assets are not ready for approval.");
  return { approvedIds, unavailable };
}
