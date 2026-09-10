import { and, eq } from "drizzle-orm";
import { tutorialJobs, thumbnails, type DrizzleClient } from "@repo/db";
import { capturePublicationApproval, publicationApprovalMatches } from "@repo/media-core";
import { assessPublicationVariant } from "./publication-readiness";
import { withPublicationMedia } from "./media-access";
type Transaction = Parameters<Parameters<DrizzleClient["transaction"]>[0]>[0];

export async function verifyPublicationApproval(tx: Transaction, job: typeof tutorialJobs.$inferSelect, sourceRevision: string) {
  const candidates = await tx.select({ id: thumbnails.id, language: thumbnails.language, channelId: thumbnails.channel_id, status: thumbnails.status, isSelected: thumbnails.is_selected, outputPath: thumbnails.output_path }).from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, job.id)));
  const ready = assessPublicationVariant(job, candidates);
  if (!ready.ready || !ready.thumbnail || !job.publication_approval) throw new Error("This variant needs final review of its current assets before delivery.");
  const thumbnail = ready.thumbnail;
  const current = await withPublicationMedia(job.id, job.final_path!, thumbnail.outputPath!, () => capturePublicationApproval({ jobId: job.id, channelId: job.channel_id!, language: job.language!, sourceRevision, title: job.title, description: job.description!, tags: job.tags!, videoPath: job.final_path!, thumbnailId: thumbnail.id, thumbnailPath: thumbnail.outputPath! }), tx);
  if (!publicationApprovalMatches(job.publication_approval, current)) throw new Error("Video, thumbnail, metadata or routing changed after approval. Repeat final review before delivery.");
  return current;
}
