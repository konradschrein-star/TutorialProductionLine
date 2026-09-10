export function isParkedTutorialMode(mode: string) {
  return mode === "SIX_MIN_STITCH" || mode === "LONG_FORM";
}
export function recordSessionKey(userId: string, jobId?: string) {
  return jobId
    ? `tutorial-record:draft:${userId}:${jobId}`
    : `tutorial-record:selected:${userId}`;
}
/** A remembered selection must never redirect a user leaving the Record tab. */
export function shouldRestoreRecordSelection(tab: string | null, jobId: string | null, userId?: string) {
  return tab === "studio" && !jobId && Boolean(userId);
}
export function recoverScriptDraft(
  serialized: string | null,
  base: string,
): string | null {
  if (!serialized) return null;
  try {
    const value = JSON.parse(serialized);
    return value.base === base &&
      typeof value.draft === "string" &&
      value.draft.length <= 500000
      ? value.draft
      : null;
  } catch {
    return null;
  }
}
