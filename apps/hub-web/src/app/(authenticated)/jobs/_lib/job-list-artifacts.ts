/**
 * Cheap per-job artefact summary for the jobs LIST.
 *
 * The detail page does a full directory walk; that is far too expensive for 25
 * rows. This does at most a handful of `existsSync` calls per job plus one
 * batched thumbnail query, so the list can honestly answer "what has this job
 * actually produced?" without lying and without being slow.
 *
 * Server-only. Never throws.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { inArray, and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { thumbnails } from "@repo/db";

export interface JobArtifactSummary {
  /** A playable rendered video exists on disk right now. */
  hasVideo: boolean;
  /** A media folder exists for this job. */
  hasFolder: boolean;
  /** Thumbnail row id when a completed thumbnail image exists. */
  thumbnailId: string | null;
}

const EMPTY: JobArtifactSummary = {
  hasVideo: false,
  hasFolder: false,
  thumbnailId: null,
};

const VIDEO_NAMES = ["final_video.mp4", "final.mp4", "output.mp4"];

function candidateDirs(
  mediaRoot: string,
  channelId: string | null,
  jobId: string,
): string[] {
  if (!mediaRoot) return [];
  const dirs: string[] = [];
  if (channelId) dirs.push(join(mediaRoot, channelId, jobId));
  dirs.push(join(mediaRoot, jobId));
  // `<root>/tutorial/<id>` is deliberately NOT probed: a content_jobs.id never
  // lives there (D7 — tutorials are a separate operation and table).
  dirs.push(join(mediaRoot, "long-form-drama", jobId));
  return dirs;
}

/**
 * Summarize artefacts for a page of jobs.
 *
 * @param jobs - minimal job identity (id + channel_id)
 * @returns map of job id → summary. Jobs with nothing produced map to a
 *          summary of all-false, never to fabricated values.
 */
export async function summarizeJobArtifacts(
  jobs: Array<{ id: string; channel_id: string | null }>,
): Promise<Map<string, JobArtifactSummary>> {
  const out = new Map<string, JobArtifactSummary>();
  if (jobs.length === 0) return out;

  const mediaRoot = (process.env["LOCAL_MEDIA_ROOT"] ?? "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");

  // Filesystem pass — a few stat calls per job.
  for (const job of jobs) {
    let hasFolder = false;
    let hasVideo = false;
    for (const dir of candidateDirs(mediaRoot, job.channel_id, job.id)) {
      if (!existsSync(dir)) continue;
      hasFolder = true;
      for (const name of VIDEO_NAMES) {
        if (existsSync(join(dir, name))) {
          hasVideo = true;
          break;
        }
      }
      if (hasVideo) break;
    }
    out.set(job.id, { ...EMPTY, hasVideo, hasFolder });
  }

  // Thumbnail pass — one query for the whole page.
  try {
    const rows = await db
      .select({
        id: thumbnails.id,
        subject_id: thumbnails.subject_id,
        output_path: thumbnails.output_path,
        is_selected: thumbnails.is_selected,
      })
      .from(thumbnails)
      .where(
        and(
          eq(thumbnails.subject_kind, "content_job"),
          eq(thumbnails.status, "completed"),
          inArray(
            thumbnails.subject_id,
            jobs.map((j) => j.id),
          ),
        ),
      );

    for (const row of rows) {
      if (!row.output_path) continue;
      // Only claim a thumbnail when the image is genuinely on disk.
      if (!existsSync(row.output_path)) continue;
      const prev = out.get(row.subject_id) ?? { ...EMPTY };
      // Prefer the selected variant if we see one.
      if (!prev.thumbnailId || row.is_selected) {
        out.set(row.subject_id, { ...prev, thumbnailId: row.id });
      }
    }
  } catch {
    // Thumbnail lookup is best-effort; the list still renders truthfully
    // without it (no thumbnail chip rather than a fake one).
  }

  return out;
}
