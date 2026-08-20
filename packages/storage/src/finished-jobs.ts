import { isAbsolute } from "node:path";
import type { StorageArtifactKind } from "@repo/db";

/**
 * "What counts as a finished product?" — kept pure and in one place so the
 * rule is testable and cannot drift between the scanner and the UI.
 *
 * A job is eligible when it has reached a genuinely terminal state AND has a
 * final render on disk. `AWAITING_QC` is deliberately NOT eligible: the video
 * exists but a human has not accepted it, and pushing not-yet-approved cuts
 * into the folder Konrad downloads from would be actively harmful.
 */

export const FINISHED_JOB_STATUSES = [
  "AWAITING_UPLOADER",
  "PUBLISHED",
] as const;

export type FinishedJobStatus = (typeof FINISHED_JOB_STATUSES)[number];

export function isFinishedStatus(status: string): status is FinishedJobStatus {
  return (FINISHED_JOB_STATUSES as readonly string[]).includes(status);
}

/** The subset of a content_jobs row this module needs. */
export interface FinishedJobRow {
  id: string;
  status: string;
  channel_id: string | null;
  channel_name?: string | null;
  title: string | null;
  description?: string | null;
  format?: string | null;
  render_completed_at: Date | null;
  created_at: Date;
  final_video_size_bytes: number | null;
  final_video_duration_seconds: number | null;
  r2_asset_manifest: Array<{ key: string; type: string; size_bytes: number }>;
  /** `thumbnails.output_path` for the selected thumbnail, when there is one. */
  thumbnail_path?: string | null;
}

export interface FinishedJobArtifact {
  kind: StorageArtifactKind;
  localPath: string;
  sizeBytes: number | null;
}

/**
 * Pull the final video path out of the (misleadingly named) `r2_asset_manifest`
 * — it holds local filesystem paths, not R2 keys.
 *
 * Two entry shapes exist in the wild: `type: "video/final-render"` everywhere
 * except the reactor workflow, which writes a *relative* key. We accept the
 * relative form only when a media root is supplied to resolve it against,
 * rather than guessing — a wrong absolute path here would look like a missing
 * file and silently skip the artefact.
 */
export function findFinalVideo(
  manifest: FinishedJobRow["r2_asset_manifest"],
  mediaRoot?: string,
): { path: string; sizeBytes: number | null } | null {
  if (!Array.isArray(manifest)) return null;

  const entry =
    manifest.find((a) => a?.type === "video/final-render") ??
    manifest.find(
      (a) => typeof a?.key === "string" && a.key.includes("final_video"),
    );

  if (
    entry === undefined ||
    typeof entry.key !== "string" ||
    entry.key === ""
  ) {
    return null;
  }

  const sizeBytes =
    typeof entry.size_bytes === "number" && entry.size_bytes > 0
      ? entry.size_bytes
      : null;

  if (isAbsolute(entry.key)) {
    return { path: entry.key, sizeBytes };
  }
  if (mediaRoot !== undefined && mediaRoot !== "") {
    // Relative key (reactor workflow): {channel_id}/{job_id}/final_video.mp4
    const joined = `${mediaRoot.replace(/[/\\]+$/, "")}/${entry.key.replace(/^[/\\]+/, "")}`;
    return { path: joined, sizeBytes };
  }
  return null;
}

/**
 * Everything we are willing to push to Drive for this job.
 *
 * The metadata sidecar is not listed here — it is generated in memory by the
 * uploader rather than read from disk, so it has no local path.
 */
export function collectFinishedJobArtifacts(
  job: FinishedJobRow,
  mediaRoot?: string,
): FinishedJobArtifact[] {
  const artifacts: FinishedJobArtifact[] = [];

  const video = findFinalVideo(job.r2_asset_manifest, mediaRoot);
  if (video !== null) {
    artifacts.push({
      kind: "final_video",
      localPath: video.path,
      sizeBytes: video.sizeBytes ?? job.final_video_size_bytes,
    });
  }

  const thumb = job.thumbnail_path;
  if (typeof thumb === "string" && thumb !== "") {
    artifacts.push({ kind: "thumbnail", localPath: thumb, sizeBytes: null });
  }

  return artifacts;
}

/** The timestamp that drives the YYYY-MM folder. */
export function completionDate(job: FinishedJobRow): Date {
  return job.render_completed_at ?? job.created_at;
}
