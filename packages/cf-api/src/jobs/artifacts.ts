import { eq } from "drizzle-orm";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { contentJobs } from "@repo/db";
import { CfApiError } from "../errors.js";
import type { CfRuntime } from "../runtime.js";

const DRAMA_MEDIA_BASE =
  process.env["DRAMA_MEDIA_DIR"] ?? "/opt/content-forge/media/long-form-drama";

export type JobArtifactKind =
  | "edit"
  | "thumbnail"
  | "tts"
  | "tts_timings"
  | "subtitles"
  | "script"
  | "manifest";

export interface JobArtifactResolution {
  kind: JobArtifactKind;
  path: string;
  contentType: string;
}

const DRAMA_FILES: Record<JobArtifactKind, { name: string; mime: string }> = {
  edit: { name: "output.mp4", mime: "video/mp4" },
  thumbnail: { name: "thumbnail.jpg", mime: "image/jpeg" },
  tts: { name: "tts.mp3", mime: "audio/mpeg" },
  tts_timings: { name: "tts.json", mime: "application/json" },
  subtitles: { name: "subtitles.ass", mime: "text/plain" },
  // script + manifest aren't files on disk — see resolveJobArtifact.
  script: { name: "", mime: "" },
  manifest: { name: "", mime: "" },
};

/**
 * Map (jobId, kind) → on-disk file path. Throws NOT_FOUND if the file
 * isn't present yet (pipeline still running) or if the artifact kind
 * isn't supported for this format.
 *
 * `script` and `manifest` kinds are virtual — see getJobScript() and
 * the manifest helpers elsewhere. They're not on-disk and shouldn't
 * be resolved through this function.
 */
export async function resolveJobArtifact(
  rt: CfRuntime,
  jobId: string,
  kind: JobArtifactKind,
): Promise<JobArtifactResolution> {
  if (kind === "script" || kind === "manifest") {
    throw new CfApiError(
      "BAD_REQUEST",
      `Artifact kind "${kind}" is virtual; use the dedicated endpoint instead.`,
    );
  }

  const [job] = await rt.db
    .select({ id: contentJobs.id, format: contentJobs.format })
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);
  if (!job) throw new CfApiError("NOT_FOUND", `Job ${jobId} not found`);

  let entry: { name: string; mime: string } | undefined;
  let base: string;
  if (job.format === "LONG_FORM_DRAMA") {
    entry = DRAMA_FILES[kind];
    base = DRAMA_MEDIA_BASE;
  } else {
    throw new CfApiError(
      "BAD_REQUEST",
      `cf-api artifacts not wired for format ${job.format}`,
    );
  }
  if (!entry || !entry.name) {
    throw new CfApiError(
      "BAD_REQUEST",
      `Artifact kind "${kind}" is not produced by format ${job.format}`,
    );
  }

  const path = join(base, jobId, entry.name);
  try {
    const s = await stat(path);
    if (!s.isFile()) {
      throw new Error("not a file");
    }
  } catch {
    throw new CfApiError(
      "NOT_FOUND",
      `Artifact "${kind}" not on disk yet for job ${jobId}`,
      { expectedPath: path },
    );
  }
  return { kind, path, contentType: entry.mime };
}
