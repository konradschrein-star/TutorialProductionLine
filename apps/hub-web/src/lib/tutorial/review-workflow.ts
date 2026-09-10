export type ReviewShortcut =
  "approve" | "rework" | "next" | "previous" | "play";
export function reviewShortcut(
  event: {
    key: string;
    repeat?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    isComposing?: boolean;
    defaultPrevented?: boolean;
  },
  context: {
    enabled: boolean;
    busy: boolean;
    editing: boolean;
    modalOpen: boolean;
  },
): ReviewShortcut | null {
  if (
    (!context.enabled && !["j", "k"].includes(event.key.toLowerCase())) ||
    context.busy ||
    context.editing ||
    context.modalOpen ||
    event.repeat ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey ||
    event.isComposing ||
    event.defaultPrevented
  )
    return null;
  return (
    (
      {
        q: "approve",
        r: "rework",
        j: "next",
        k: "previous",
        " ": "play",
      } as Record<string, ReviewShortcut>
    )[event.key.toLowerCase()] ?? null
  );
}
export function adjacentReviewId(
  ids: readonly string[],
  current: string | null,
  direction: -1 | 1,
): string | null {
  if (!ids.length) return null;
  const index = current ? ids.indexOf(current) : -1;
  return (
    ids[
      Math.max(0, Math.min(ids.length - 1, index < 0 ? 0 : index + direction))
    ] ?? null
  );
}
export function localeProgress(status?: string, thumbnailApproved = false) {
  if (status === "AWAITING_THUMBNAILS" && thumbnailApproved) return { label: "Ready for localization", kind: "waiting", action: "start" } as const;
  if (!status)
    return { label: "Not started", kind: "missing", action: "start" } as const;
  if (status === "COMPLETED")
    return { label: "Video produced", kind: "done", action: null } as const;
  if (status.startsWith("FAILED") || status === "CANCELLED")
    return {
      label: status === "CANCELLED" ? "Stopped" : "Needs attention",
      kind: "attention",
      action: "retry",
    } as const;
  if (status === "AWAITING_THUMBNAILS")
    return {
      label: "Waiting for thumbnail approval",
      kind: "waiting",
      action: "start",
    } as const;
  return {
    label: status === "QUEUED" ? "Queued" : "In progress",
    kind: "pending",
    action: null,
  } as const;
}
