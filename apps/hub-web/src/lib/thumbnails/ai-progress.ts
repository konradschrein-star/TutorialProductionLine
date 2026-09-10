export function thumbnailBatchProgress(batch: { requestId: string; count: number; createdAt: Date | string; attempted: readonly number[] }, outputs: readonly { requestId: string | null; index: number; status: string; path: string | null; updatedAt: Date | string }[], now = Date.now()) {
  const variants = Array.from({ length: batch.count === 1 ? 1 : 5 }, (_, index) => {
    const output = outputs.find(row => row.requestId === batch.requestId && row.index === index);
    const stale = now - new Date(output?.updatedAt ?? batch.createdAt).getTime() > 15 * 60_000;
    const state = output?.status === "completed" && output.path ? "completed"
      : output?.status === "failed" ? "reconciliation_required"
      : stale ? "waiting_unknown"
      : output ? "generating"
      : batch.attempted.includes(index) ? "awaiting_result" : "waiting_for_worker";
    return { index, state };
  });
  return { requestId: batch.requestId, count: variants.length, completed: variants.filter(item => item.state === "completed").length, variants };
}

export function currentThumbnailLocales<T extends { sourceThumbnailId: string; approvalRevision: string; language: string }>(rows: readonly T[], thumbnailId: string | null, revision: string | null): T[] {
  if (!thumbnailId || !revision) return [];
  return rows.filter(row => row.sourceThumbnailId === thumbnailId && row.approvalRevision === revision).filter((row, index, all) => all.findIndex(other => other.language === row.language) === index);
}
