import { ACTIVE_UPLOAD_LANGUAGES } from "./languages";

/**
 * English plus the four automatic translations. This is the publication
 * network, not the wider archive/manual translation catalog.
 */
export const THUMBNAIL_PACK_LANGUAGES = [...ACTIVE_UPLOAD_LANGUAGES] as const;

export interface ThumbnailPackJob {
  jobId: string | null;
  language: string;
  title: string | null;
  description: string | null;
  tags: string[] | null;
  thumbnailTextTop: string | null;
  thumbnailTextBottom: string | null;
  status: string | null;
  finalPath: string | null;
  thumbnailId: string | null;
}

export interface ThumbnailPackAssessment {
  ready: boolean;
  reasons: string[];
}

/** Editing a thumbnail needs localized copy, not a completed localized video
 * or upload metadata. Keep this separate from the publication gate below. */
export function assessThumbnailDraft(job: ThumbnailPackJob): ThumbnailPackAssessment {
  const reasons: string[] = [];
  if (!job.jobId) reasons.push("language variant job missing");
  if (!job.thumbnailTextTop?.trim()) reasons.push("thumbnail top line missing");
  return { ready: reasons.length === 0, reasons };
}

/**
 * Fail-closed readiness for one localized publishing variant. These are the
 * fields the uploader needs; a plausible English fallback is intentionally not
 * accepted for a missing translation.
 */
export function assessThumbnailPackJob(
  job: ThumbnailPackJob,
): ThumbnailPackAssessment {
  const reasons: string[] = [];
  if (!job.jobId) reasons.push("language variant job missing");
  if (job.status !== "COMPLETED") {
    reasons.push(
      job.status ? `video is ${job.status}` : "video status missing",
    );
  }
  if (!job.finalPath?.trim()) reasons.push("final video missing");
  if (!job.title?.trim()) reasons.push("localized title missing");
  if (!job.description?.trim()) reasons.push("localized description missing");
  if (!job.tags?.some((tag) => tag.trim().length > 0)) {
    reasons.push("localized tags missing");
  }
  if (!job.thumbnailTextTop?.trim()) reasons.push("thumbnail top line missing");
  return { ready: reasons.length === 0, reasons };
}

export function assessThumbnailPack(jobs: readonly ThumbnailPackJob[], purpose: "publication" | "editing" = "publication", expectedLanguages: readonly string[] = THUMBNAIL_PACK_LANGUAGES): {
  ready: boolean;
  expected: number;
  readyCount: number;
  variants: Array<ThumbnailPackJob & ThumbnailPackAssessment>;
} {
  const byLanguage = new Map<string, ThumbnailPackJob[]>();
  for (const job of jobs) {
    const matches = byLanguage.get(job.language) ?? [];
    matches.push(job);
    byLanguage.set(job.language, matches);
  }
  const languages = [...new Set(expectedLanguages)];
  const variants = languages.map((language) => {
    const matches = byLanguage.get(language) ?? [];
    const job =
      matches[0] ??
      ({
        jobId: null,
        language,
        title: null,
        description: null,
        tags: null,
        thumbnailTextTop: null,
        thumbnailTextBottom: null,
        status: null,
        finalPath: null,
        thumbnailId: null,
      } satisfies ThumbnailPackJob);
    if (matches.length > 1) {
      return {
        ...job,
        ready: false,
        reasons: [`multiple translation jobs found (${matches.length})`],
      };
    }
    return { ...job, ...(purpose === "editing" ? assessThumbnailDraft(job) : assessThumbnailPackJob(job)) };
  });
  const readyCount = variants.filter((variant) => variant.ready).length;
  return {
    ready: readyCount === languages.length,
    expected: languages.length,
    readyCount,
    variants,
  };
}
