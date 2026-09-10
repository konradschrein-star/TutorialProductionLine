/** Presentation only: never promotes reservations or manual reports to provider evidence. */
export interface DeliveryStatusInput {
  uploaderStatus: string | null;
  youtubeVisibility: string | null;
  scheduledFor: string | null;
  isUploaded: boolean;
  uploadVerifiedAt: string | null;
  youtubePublishedAt: string | null;
}

const validTime = (value: string | null) => value !== null && Number.isFinite(Date.parse(value));

export function deliveryStage(item: DeliveryStatusInput): "published" | "scheduled" | "transferred" | "reported" | "pending" {
  if (item.uploaderStatus === "reported_uploaded") return "reported";
  if (validTime(item.uploadVerifiedAt)) {
    if (item.youtubeVisibility === "public" && validTime(item.youtubePublishedAt)) return "published";
    if (item.uploaderStatus === "scheduled" && validTime(item.scheduledFor)) return "scheduled";
    if (item.uploaderStatus === "uploaded" || item.isUploaded) return "transferred";
  }
  if (item.isUploaded || item.uploaderStatus === "uploaded") return "reported";
  return "pending";
}

export function uploadStateLabel(item: DeliveryStatusInput, now = Date.now()): string {
  if (item.uploaderStatus === "reported_uploaded") return "Manually reported · not verified";
  const stage = deliveryStage(item);
  if (stage === "published") return "Verified published";
  if (stage === "scheduled") {
    return Date.parse(item.scheduledFor!) <= now
      ? "Publication due — awaiting provider verification"
      : `Externally scheduled ${new Date(item.scheduledFor!).toLocaleString()}`;
  }
  if (item.uploaderStatus === "uncertain") return "Outcome uncertain — reconcile";
  if (item.uploaderStatus === "failed") return "Uploader failed — reconcile";
  if (stage === "transferred") {
    const visibility = item.youtubeVisibility;
    return visibility === "private" || visibility === "unlisted"
      ? `Uploaded ${visibility} — publication not scheduled`
      : "Upload verified — publication unconfirmed";
  }
  if (stage === "reported") return "Upload reported · not verified";
  if (item.uploaderStatus === "scheduled") return "Schedule reported — awaiting provider verification";
  if (item.uploaderStatus === "uploading") return "Uploading";
  if (item.uploaderStatus === "waiting_to_be_uploaded") return "Waiting for uploader";
  if (validTime(item.scheduledFor)) return `Planned ${new Date(item.scheduledFor!).toLocaleString()} · awaiting upload`;
  return "Not queued";
}

/** Disjoint counts over the supplied rows, not global totals or locale children. */
export function summarizeDelivery(items: readonly DeliveryStatusInput[]) {
  const counts = { published: 0, scheduled: 0, transferred: 0, reported: 0, pending: 0 };
  for (const item of items) counts[deliveryStage(item)] += 1;
  return counts;
}
