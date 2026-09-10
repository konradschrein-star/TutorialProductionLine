import type { Job } from "bullmq";
import { tutorialAiThumbnailsEnabled } from "../utils/tutorial/ai-thumbnail-policy.js";
import { isDeepStrictEqual } from "node:util";
import type { ThumbnailPayload } from "@repo/contracts";
import { ThumbnailPayloadSchema } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { thumbnails, tutorialJobs, tutorialSettings, tutorialThumbnailAiBatches, tutorialUploadDispatches } from "@repo/db";
import { and, eq, sql, or, inArray } from "drizzle-orm";
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
      if (data.subjectKind === "tutorial_job" && !tutorialAiThumbnailsEnabled()) return;
      if (data.subjectKind === "tutorial_job" && !data.requestGroupId) return; // Legacy unbound work needs explicit new admission.
      const generate = () => requestThumbnail(db, {
        ...data,
        format: data.format as GatewayFormat,
      });
      const admission = data.requestGroupId ? await db.transaction(async (tx) => {
        // Hold only the admission lock here. Generation records commit through
        // db before provider HTTP, so a crashed call remains durable evidence.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`thumbnail-request:${data.subjectId}:${data.requestGroupId}:${data.variantIndex ?? 0}`},0))`);
        if (data.subjectKind === "tutorial_job") {
          const [source] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, data.subjectId)).limit(1).for("update");
          const [settings] = await tx.select().from(tutorialSettings).where(eq(tutorialSettings.id, 1)).for("share");
          if (!source || source.source_job_id || source.language !== "en" || source.channel_id !== data.channelId || source.status === "CANCELLED" || source.status.startsWith("FAILED") || source.va_review_status === "rework_requested" || settings?.thumbnail_generation_mode !== "ai") throw new Error("Thumbnail request is no longer authorized");
          const family = await tx.select().from(tutorialJobs).where(or(eq(tutorialJobs.id, source.id), eq(tutorialJobs.source_job_id, source.id)));
          const dispatch = await tx.select({ id: tutorialUploadDispatches.id }).from(tutorialUploadDispatches).where(inArray(tutorialUploadDispatches.tutorial_job_id, family.map(row => row.id))).limit(1);
          if (dispatch.length || family.some(row => row.is_uploaded || row.uploader_status)) throw new Error("Delivery has started; thumbnail generation is frozen");
          const [batch] = await tx.select().from(tutorialThumbnailAiBatches).where(and(eq(tutorialThumbnailAiBatches.job_id, source.id), eq(tutorialThumbnailAiBatches.request_id, data.requestGroupId!))).limit(1).for("update");
          const saved = batch?.payload as { payload?: Record<string, unknown>; count?: number } | undefined;
          const { variantIndex: _variant, ...base } = data;
          if (!saved?.payload || !isDeepStrictEqual(saved.payload, base) || (data.variantIndex ?? 0) >= (saved.count ?? 0)) throw new Error("Thumbnail request does not match its durable batch");
          if (batch!.attempted_variants.includes(data.variantIndex ?? 0)) throw new Error("This variant was already admitted; reconcile its outcome before retrying");
          await tx.update(tutorialThumbnailAiBatches).set({ attempted_variants: [...batch!.attempted_variants, data.variantIndex ?? 0] }).where(and(eq(tutorialThumbnailAiBatches.job_id, source.id), eq(tutorialThumbnailAiBatches.request_id, data.requestGroupId!)));
        }
        const [existing] = await tx.select().from(thumbnails).where(and(eq(thumbnails.subject_kind, data.subjectKind), eq(thumbnails.subject_id, data.subjectId), eq(thumbnails.request_group_id, data.requestGroupId!), eq(thumbnails.variant_index, data.variantIndex ?? 0))).limit(1);
        if (existing) return { thumbnailId: existing.id, outputPath: existing.output_path, status: "skipped" as const, error: "This request already has a generation record; inspect it before explicit retry" };
        return data.subjectKind === "tutorial_job" ? null : generate();
      }) : null;
      // All row/settings locks have committed before network work. A crashed
      // admission remains recorded, so Redis redelivery cannot spend twice.
      const result = admission ?? await generate();

      // Selection is written ONCE, by the RULE — never as a side effect of a
      // generation completing (fixes the "last-to-finish ships" bug, A2.12).
      // For a job-attached subject (content_job / tutorial_job) the uploader
      // reads is_selected = true (finished-job-scanner), so a completed variant
      // must trigger a rule-based re-selection across all completed siblings.
      // Studio renders are excluded — the human picks the winner via "Use".
      if (
        result.status === "completed" && !data.manualSelection &&
        data.subjectKind === "content_job"
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
          data.language,
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
