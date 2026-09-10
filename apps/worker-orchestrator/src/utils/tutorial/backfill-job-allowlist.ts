const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const TUTORIAL_THUMBNAIL_JOB_ALLOWLIST_ENV = "TUTORIAL_THUMBNAIL_JOB_ALLOWLIST";

/** Parse the explicit comma-separated job fence used by the mutating backfill.
 * Missing, malformed, duplicated, or over-broad input is always fatal. */
export function parseTutorialThumbnailJobAllowlist(value: string | undefined): string[] {
  if (value === undefined) throw new Error(`${TUTORIAL_THUMBNAIL_JOB_ALLOWLIST_ENV} is required; refusing an unbounded thumbnail backfill`);
  const tokens = value.split(",").map((token) => token.trim());
  if (!tokens.length || tokens.some((token) => !token)) throw new Error(`${TUTORIAL_THUMBNAIL_JOB_ALLOWLIST_ENV} must contain only comma-separated UUIDs`);
  if (tokens.length > 50) throw new Error(`${TUTORIAL_THUMBNAIL_JOB_ALLOWLIST_ENV} cannot contain more than 50 jobs`);
  if (tokens.some((token) => !UUID.test(token))) throw new Error(`${TUTORIAL_THUMBNAIL_JOB_ALLOWLIST_ENV} contains an invalid job UUID`);
  const normalized = tokens.map((token) => token.toLowerCase());
  if (new Set(normalized).size !== normalized.length) throw new Error(`${TUTORIAL_THUMBNAIL_JOB_ALLOWLIST_ENV} contains duplicate jobs`);
  return normalized;
}

/** Validate the complete read result before the first render or database write.
 * A missing/ineligible requested job aborts the whole invocation. */
export function assertExactTutorialThumbnailJobs<T extends { id: string }>(allowlist: readonly string[], jobs: readonly T[]): void {
  const returned = jobs.map((job) => job.id.toLowerCase());
  if (new Set(returned).size !== returned.length) throw new Error("Thumbnail backfill query returned duplicate jobs; no rendering started");
  const missing = allowlist.filter((id) => !returned.includes(id));
  const unexpected = returned.filter((id) => !allowlist.includes(id));
  if (missing.length || unexpected.length || returned.length !== allowlist.length) {
    throw new Error(`Thumbnail backfill allowlist did not match eligible jobs exactly (missing=${missing.length}, unexpected=${unexpected.length}); no rendering started`);
  }
}
