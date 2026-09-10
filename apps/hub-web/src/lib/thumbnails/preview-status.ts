/** File availability and saved approval are separate facts. */
export function thumbnailPreviewStatus(input: { approved: boolean; hasThumbnail: boolean; previewFailed: boolean }): string {
  if (input.previewFailed) return input.approved ? "Approved · image unavailable" : "Restore image to review";
  return input.approved ? "Approved" : input.hasThumbnail ? "Ready for review" : "Needs preparation";
}
