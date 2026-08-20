import type { Job } from "bullmq";
import type { ThumbnailPayload } from "@repo/contracts";
import { ThumbnailPayloadSchema } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import {
  resolveAutopilotPolicy,
  selectBestThumbnailForSubject,
} from "@repo/db/repositories";
import type { GatewayFormat } from "../utils/media-gateway/types.js";
import { requestThumbnail } from "../utils/thumbnail/index.js";

export function createThumbnailProcessor(db: DrizzleClient) {
  return async (job: Job<ThumbnailPayload>) => {
    // Non-fatal by contract: the thumbnail is optional, so this handler must
    // NEVER throw — a throw marks the BullMQ job failed, and because the
    // auto-enqueue uses a fixed jobId, a retained failed job would dedup-block
    // regeneration for days. Catch everything (incl. a malformed payload) and
    // log; the uploader can always regenerate.
    try {
      const data = ThumbnailPayloadSchema.parse(job.data);
      const result = await requestThumbnail(db, {
        ...data,
        format: data.format as GatewayFormat,
      });

      // Selection is written ONCE, by the RULE — never as a side effect of a
      // generation completing (fixes the "last-to-finish ships" bug, A2.12).
      // For a job-attached subject (content_job / tutorial_job) the uploader
      // reads is_selected = true (finished-job-scanner), so a completed variant
      // must trigger a rule-based re-selection across all completed siblings.
      // Studio renders are excluded — the human picks the winner via "Use".
      if (
        result.status === "completed" &&
        (data.subjectKind === "content_job" ||
          data.subjectKind === "tutorial_job")
      ) {
        const policy = await resolveAutopilotPolicy(
          db,
          data.format,
          data.channelId ?? null,
        ).catch(() => undefined);
        const rule =
          policy?.selection_rule === "first_completed"
            ? "first_completed"
            : policy?.qa_enabled
              ? "qa_best_score"
              : "first_completed";
        await selectBestThumbnailForSubject(
          db,
          data.subjectKind,
          data.subjectId,
          rule,
        ).catch((err) =>
          console.error(
            JSON.stringify({
              level: "error",
              message: "Thumbnail selection failed (non-blocking)",
              subject_id: data.subjectId,
              error: err instanceof Error ? err.message : String(err),
            }),
          ),
        );
      }

      if (result.status !== "completed") {
        console.error(
          JSON.stringify({
            level: result.status === "failed" ? "error" : "warn",
            message: `Thumbnail ${result.status}`,
            subject_id: data.subjectId,
            error: result.error,
          }),
        );
      } else if (result.downgradedFrom) {
        // A provider downgrade can silently ship a thumbnail that looks
        // nothing like the archetype. Always announce it.
        console.warn(
          JSON.stringify({
            level: "warn",
            message: "Thumbnail served by a fallback provider",
            subject_id: data.subjectId,
            thumbnail_id: result.thumbnailId,
            requested: result.downgradedFrom,
          }),
        );
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "Thumbnail processor error (swallowed, non-blocking)",
          job_id: job.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  };
}
