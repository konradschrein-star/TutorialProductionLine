/** An explicit review link must never silently substitute the queue's first job. */
export function selectReviewJob<T extends { id: string }>(jobs: readonly T[], selectedId: string | null, requestedId: string | null): T | null {
  if (requestedId !== null) return jobs.find(job => job.id === requestedId) ?? null;
  return jobs.find(job => job.id === selectedId) ?? jobs[0] ?? null;
}
export function reviewQueueUrl(hours: number, scopeAll: boolean, requestedId: string | null): string {
  const params = new URLSearchParams({ hours: String(hours), ...(scopeAll ? { scope: "all" } : {}), ...(requestedId !== null ? { jobId: requestedId } : {}) });
  return `/api/production/tutorial-review?${params}`;
}
export function reviewLocaleQueueUrl(jobId: string, authorizedScope: "mine" | "all" | undefined): string {
  return `/api/production/tutorial-translate?${new URLSearchParams({ sourceJobId: jobId, ...(authorizedScope === "all" ? { scope: "all" } : {}) })}`;
}
