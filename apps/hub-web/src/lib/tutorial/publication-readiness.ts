import { assessTutorialThumbnailSelection, type TutorialThumbnailCandidate } from "./thumbnail-selection";

export interface PublicationVariant {
  status: string | null;
  final_path: string | null;
  title: string | null;
  description: string | null;
  tags: string[] | null;
  language: string | null;
  channel_id: string | null;
}

/** Delivery readiness is per locale, never an all-languages barrier. */
export function assessPublicationVariant(job: PublicationVariant, candidates: readonly TutorialThumbnailCandidate[]) {
  const reasons: string[] = [];
  if (job.status !== "COMPLETED") reasons.push("Finish processing this video.");
  if (!job.final_path?.trim()) reasons.push("Final video is missing.");
  if (!job.title?.trim()) reasons.push("Add a localized title.");
  if (!job.description?.trim()) reasons.push("Add a localized description.");
  if (!job.tags?.some((tag) => tag.trim())) reasons.push("Add localized tags.");
  const selection = assessTutorialThumbnailSelection({ language: job.language, channelId: job.channel_id }, candidates);
  reasons.push(...selection.reasons);
  return { ready: reasons.length === 0, reasons, thumbnail: selection.thumbnail };
}
