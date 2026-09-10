/** Cheap UI prerequisites only; the approval endpoint still verifies exact bytes. */
export function reviewBlockingReasons(job: {
  channelId?: string | null;
  playable: boolean;
  hasThumbnail: boolean;
}): string[] {
  return [
    !job.channelId && "An Admin must assign the channel.",
    !job.playable && "The video must be available locally or restorable from Drive.",
    !job.hasThumbnail && "Select an acceptable thumbnail first.",
  ].filter((reason): reason is string => typeof reason === "string");
}
