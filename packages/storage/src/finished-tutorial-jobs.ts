import { isAbsolute } from "node:path";
import type { StorageArtifactKind } from "@repo/db";

/**
 * "What counts as a finished TUTORIAL?" — kept separate from the content-job
 * predicate (do NOT overload FinishedJobRow, per the plan). A tutorial is
 * eligible when it is genuinely complete AND a final render exists on disk.
 *
 * Tutorials additionally archive their raw screen recording, because a laptop
 * translation pipeline consumes raw video + transcript → translate → frame →
 * output. The raw recording exists before the final render, but is still only
 * uploaded once the JOB is finished — uploading raws for abandoned tutorials
 * would burn the 750 GB/day budget on garbage.
 */

export const FINISHED_TUTORIAL_STATUSES = ["COMPLETED"] as const;

export type FinishedTutorialStatus =
  (typeof FINISHED_TUTORIAL_STATUSES)[number];

export function isFinishedTutorialStatus(
  status: string,
): status is FinishedTutorialStatus {
  return (FINISHED_TUTORIAL_STATUSES as readonly string[]).includes(status);
}

/** The subset of a tutorial_jobs row this module needs. */
export interface FinishedTutorialRow {
  id: string;
  status: string;
  channel_id: string | null;
  channel_name?: string | null;
  title: string | null;
  language: string | null;
  final_path: string | null;
  recording_path: string | null;
  recording_duration_s: number | null;
  /** The exact spoken script — for tutorials the script IS the transcript. */
  script_text: string | null;
  script_provider?: string | null;
  script_model?: string | null;
  created_at: Date;
  script_done_at?: Date | null;
  /** YouTube description. null = not generated; never fabricated downstream. */
  description?: string | null;
  /** YouTube tags. null = not generated. */
  tags?: string[] | null;
  /**
   * Absolute path of the SELECTED thumbnail, resolved by the caller from the
   * `thumbnails` table (subject_kind='tutorial_job'). It is not a column on
   * tutorial_jobs, so the scanner looks it up and passes it in — thumbnails
   * were being generated and then never shipped anywhere.
   */
  thumbnail_path?: string | null;
}

export interface FinishedTutorialArtifact {
  kind: StorageArtifactKind;
  localPath: string;
}

function resolvePath(path: string, mediaRoot?: string): string | null {
  if (path === "") return null;
  if (isAbsolute(path)) return path;
  if (mediaRoot !== undefined && mediaRoot !== "") {
    return `${mediaRoot.replace(/[/\\]+$/, "")}/${path.replace(/^[/\\]+/, "")}`;
  }
  return null;
}

/**
 * Local-file artefacts we push for a finished tutorial: the final render, the
 * raw recording, and the thumbnail. The transcript, metadata sidecar and upload
 * sheet are generated in memory by the uploader, so they have no local path and
 * are not listed here.
 *
 * The thumbnail was missing from this list entirely. Tutorial thumbnails have
 * been generated into the `thumbnails` table since they first worked and then
 * shipped nowhere — a VA opening Drive had no image to upload with the video.
 * It is not a column on tutorial_jobs (the table is polymorphic on
 * subject_kind), so the scanner resolves the selected one and sets
 * `thumbnail_path` before calling this.
 */
export function collectFinishedTutorialArtifacts(
  job: FinishedTutorialRow,
  mediaRoot?: string,
): FinishedTutorialArtifact[] {
  const artifacts: FinishedTutorialArtifact[] = [];

  const final =
    typeof job.final_path === "string"
      ? resolvePath(job.final_path, mediaRoot)
      : null;
  if (final !== null) {
    artifacts.push({ kind: "final_video", localPath: final });
  }

  const raw =
    typeof job.recording_path === "string"
      ? resolvePath(job.recording_path, mediaRoot)
      : null;
  if (raw !== null) {
    artifacts.push({ kind: "raw_recording", localPath: raw });
  }

  const thumb =
    typeof job.thumbnail_path === "string"
      ? resolvePath(job.thumbnail_path, mediaRoot)
      : null;
  if (thumb !== null) {
    artifacts.push({ kind: "thumbnail", localPath: thumb });
  }

  return artifacts;
}

export function tutorialCompletionDate(job: FinishedTutorialRow): Date {
  return job.script_done_at ?? job.created_at;
}
