import type { DrizzleClient } from "@repo/db";
import {
  listThumbnailsForSubject,
  resolveAutopilotPolicy,
  selectBestThumbnailForSubject,
} from "@repo/db/repositories";
import type { GatewayFormat, MediaAspect } from "../media-gateway/types.js";
import { requestThumbnail, type RequestThumbnailArgs } from "./index.js";

/**
 * Automatic post-render thumbnail generation — the no-human-in-the-loop step.
 *
 * A format processor calls this once its video is rendered; the finished job
 * then reaches the uploader with a thumbnail already attached. This is an
 * AVAILABLE step, not a mandatory one: nothing calls it unless a format opts
 * in, and it is deliberately non-fatal so a thumbnail problem can never block
 * a video that is otherwise ready to ship.
 *
 * Archetype selection needs no configuration — with no `archetypeId` the
 * engine picks the least-recently-used archetype from the channel's curated
 * set, or from the GLOBAL library when the channel has curated nothing.
 *
 * The HTTP equivalent is POST /api/thumbnails/auto.
 */

export interface AutoThumbnailOptions {
  subjectKind: "content_job" | "tutorial_job";
  subjectId: string;
  format: GatewayFormat;
  channelId?: string | null;
  title: string;
  headlineText?: string;
  topic?: string;
  scriptExcerpt?: string;
  archetypeId?: string;
  promptMode?: "programmatic" | "deepseek";
  logoSubject?: string;
  aspectRatio?: MediaAspect;
  resolution?: string;
  backend?: RequestThumbnailArgs["backend"];
  language?: string;
  /** Regenerate even when this subject already has a completed thumbnail. */
  force?: boolean;
}

export interface AutoThumbnailOutcome {
  status: "completed" | "failed" | "skipped" | "already_generated";
  thumbnailId: string | null;
  outputPath: string | null;
  error?: string;
  /** Set when a provider other than the requested one served the image. */
  downgradedFrom?: string;
}

export async function generateThumbnailForJob(
  db: DrizzleClient,
  opts: AutoThumbnailOptions,
): Promise<AutoThumbnailOutcome> {
  // Idempotent by default — don't burn provider quota on a job that already
  // has a usable thumbnail.
  if (!opts.force) {
    const existing = await listThumbnailsForSubject(
      db,
      opts.subjectKind,
      opts.subjectId,
    ).catch(() => []);
    const done = existing.find(
      (t) => t.status === "completed" && t.output_path,
    );
    if (done) {
      return {
        status: "already_generated",
        thumbnailId: done.id,
        outputPath: done.output_path,
      };
    }
  }

  const { force: _force, ...args } = opts;
  const result = await requestThumbnail(db, args);

  // Write is_selected ONCE, by the rule — the uploader reads is_selected = true.
  if (result.status === "completed") {
    const policy = await resolveAutopilotPolicy(
      db,
      opts.format,
      opts.channelId ?? null,
    ).catch(() => undefined);
    const rule =
      policy?.selection_rule === "first_completed"
        ? "first_completed"
        : policy?.qa_enabled
          ? "qa_best_score"
          : "first_completed";
    await selectBestThumbnailForSubject(
      db,
      opts.subjectKind,
      opts.subjectId,
      rule,
    ).catch(() => {});
  }

  // Loud on the way out. The reason this system produced 57 consecutive
  // failures unnoticed is that nothing ever logged or surfaced them.
  if (result.status !== "completed") {
    console.error(
      JSON.stringify({
        level: "error",
        message: "Automatic thumbnail did not complete",
        subject_kind: opts.subjectKind,
        subject_id: opts.subjectId,
        status: result.status,
        error: result.error,
      }),
    );
  } else if (result.downgradedFrom) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "Automatic thumbnail served by a fallback provider",
        subject_id: opts.subjectId,
        requested: result.downgradedFrom,
      }),
    );
  }

  return {
    status: result.status,
    thumbnailId: result.thumbnailId || null,
    outputPath: result.outputPath,
    ...(result.error ? { error: result.error } : {}),
    ...(result.downgradedFrom ? { downgradedFrom: result.downgradedFrom } : {}),
  };
}
