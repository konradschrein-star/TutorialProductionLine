import { eq } from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";
import { contentJobs } from "@repo/db";
import type {
  JobStatus as JobStatusType,
  ThumbnailPayload,
} from "@repo/contracts";
import type { Queue } from "bullmq";
import { MissingQueueError } from "@repo/domain";
import { firstNSentences } from "./thumbnail/prompt-builder.js";

/**
 * Dispatch Next Utility
 *
 * Deterministic status-to-queue routing for event-driven chaining.
 * After a processor updates job status, it calls this to dispatch the next stage.
 *
 * Routing rules (status → queue + payload):
 * - SCRIPTING → ai-generation (script)
 * - ASSET_COLLECTION → asset-collection (coordinator)
 * - AWAITING_PRODUCTION_VA → no dispatch (awaits VA action)
 * - QMS_VALIDATING → qms-validation (pre-render)
 * - ROUTING_RENDER → render-heavy
 * - AWAITING_QC → no dispatch (awaits VA action)
 * - AWAITING_UPLOADER → no dispatch (awaits VA action)
 * - UPLOADING → no dispatch (handled by upload extension)
 * - PUBLISHED → auto-label (tag generation via Ollama)
 * - Terminal/failure states → no dispatch
 *
 * @param db - Drizzle client
 * @param jobId - Job ID
 * @param newStatus - Status after transition
 * @param queues - Queue instances
 * @returns Queue name dispatched to, or null if no dispatch needed
 */
export async function dispatchNext(
  db: DrizzleClient,
  jobId: string,
  newStatus: JobStatusType,
  queues: {
    aiGeneration?: Queue;
    qmsValidation?: Queue;
    renderHeavy?: Queue;
    assetCollection?: Queue;
    autoLabel?: Queue;
    clipSelection?: Queue;
    thumbnail?: Queue<ThumbnailPayload>;
  },
): Promise<string | null> {
  // Fetch job for context (template_id, title, etc.)
  const [job] = await db
    .select()
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);

  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  // Deterministic status-to-queue mapping
  switch (newStatus) {
    case "SCRIPTING":
      if (!queues.aiGeneration) {
        throw new MissingQueueError("aiGeneration", jobId, newStatus);
      }
      await queues.aiGeneration.add("generate-script", {
        job_id: jobId,
        generation_type: "script" as const,
        template_id: job.template_id,
        topic: job.title,
      });
      console.log(
        JSON.stringify({
          level: "info",
          message: "Dispatched to ai-generation queue",
          job_id: jobId,
          status: newStatus,
          generation_type: "script",
        }),
      );
      return "queue-ai-generation";

    case "QMS_VALIDATING":
      if (!queues.qmsValidation) {
        throw new MissingQueueError("qmsValidation", jobId, newStatus);
      }
      await queues.qmsValidation.add("validate-pre-render", {
        job_id: jobId,
        validation_stage: "pre-render" as const,
      });
      console.log(
        JSON.stringify({
          level: "info",
          message: "Dispatched to qms-validation queue",
          job_id: jobId,
          status: newStatus,
        }),
      );
      return "queue-qms-validation";

    case "ROUTING_RENDER":
      if (!queues.renderHeavy) {
        throw new MissingQueueError("renderHeavy", jobId, newStatus);
      }
      await queues.renderHeavy.add("route-render", {
        job_id: jobId,
      });
      console.log(
        JSON.stringify({
          level: "info",
          message: "Dispatched to render-heavy queue",
          job_id: jobId,
          status: newStatus,
        }),
      );
      return "queue-render-heavy";

    case "ASSET_COLLECTION":
      if (!queues.assetCollection) {
        throw new MissingQueueError("assetCollection", jobId, newStatus);
      }
      await queues.assetCollection.add("collect-assets", {
        job_id: jobId,
      });
      console.log(
        JSON.stringify({
          level: "info",
          message: "Dispatched to asset-collection queue",
          job_id: jobId,
          status: newStatus,
        }),
      );
      return "queue-asset-collection";

    case "CLIP_SELECTION": {
      if (!queues.clipSelection) {
        throw new MissingQueueError("clipSelection", jobId, newStatus);
      }
      // config_id stored in job metadata — fetch from DB
      const [jobForClip] = await db
        .select()
        .from(contentJobs)
        .where(eq(contentJobs.id, jobId))
        .limit(1);
      const configId = (
        jobForClip?.metadata as Record<string, unknown> | null
      )?.["clip_config_id"] as string | undefined;
      if (!configId) {
        throw new Error(
          `CLIP_SELECTION dispatch: job ${jobId} has no clip_config_id in metadata`,
        );
      }
      await queues.clipSelection.add("select-clips", {
        job_id: jobId,
        config_id: configId,
      });
      console.log(
        JSON.stringify({
          level: "info",
          message: "Dispatched to clip-selection queue",
          job_id: jobId,
          status: newStatus,
        }),
      );
      return "queue-clip-selection";
    }

    case "AWAITING_UPLOADER": {
      // Side-effect only: auto-generate a thumbnail so it's ready before the
      // uploader VA opens the job. Non-blocking — a failure here must never
      // prevent the job from reaching AWAITING_UPLOADER. The job itself still
      // takes no queue dispatch and awaits human action.
      // A channel-less job STILL gets a thumbnail from the format + global
      // rules (DECISIONS §3.2.8). The old `&& job.channel_id` was the same
      // stale guard already removed in
      // worker-render/src/utils/enqueue-thumbnail.ts (plan A2.6).
      if (queues.thumbnail) {
        try {
          await queues.thumbnail.add(
            "thumbnail",
            {
              subjectKind: "content_job",
              subjectId: job.id,
              format: job.format,
              channelId: job.channel_id,
              title: job.title,
              topic: job.initial_topic ?? job.title,
              scriptExcerpt: firstNSentences(job.script ?? "", 5),
              language: "en",
            },
            { jobId: `thumbnail-${job.id}`, attempts: 2 },
          );
          console.log(
            JSON.stringify({
              level: "info",
              message: "Enqueued auto-thumbnail for content_job",
              job_id: jobId,
            }),
          );
        } catch (thumbErr) {
          console.error(
            JSON.stringify({
              level: "warn",
              message: "Failed to enqueue content_job thumbnail (non-fatal)",
              job_id: jobId,
              error:
                thumbErr instanceof Error ? thumbErr.message : String(thumbErr),
            }),
          );
        }
      }
      console.log(
        JSON.stringify({
          level: "info",
          message: "No dispatch - awaiting human action or external process",
          job_id: jobId,
          status: newStatus,
        }),
      );
      return null;
    }

    // No dispatch needed for these statuses:
    case "AWAITING_RESEARCH":
    case "RESEARCH_UPLOADED":
    case "AWAITING_PRODUCTION_VA":
    case "AWAITING_IMAGE_QC":
    case "AWAITING_VA_REVIEW":
    case "AWAITING_CLIP_REVIEW":
    case "AWAITING_QC":
    case "UPLOADING":
      console.log(
        JSON.stringify({
          level: "info",
          message: "No dispatch - awaiting human action or external process",
          job_id: jobId,
          status: newStatus,
        }),
      );
      return null;

    // Statuses that do not trigger queue action
    case "IDEA_GENERATION":
    case "PAUSED":
    case "RENDERING_FFMPEG":
    case "RENDERING_REMOTION":
      console.log(
        JSON.stringify({
          level: "info",
          message: "No dispatch - status does not trigger queue action",
          job_id: jobId,
          status: newStatus,
        }),
      );
      return null;

    case "PUBLISHED":
      if (queues.autoLabel) {
        await queues.autoLabel.add(
          "auto-label",
          { job_id: jobId },
          { jobId: `auto-label-${jobId}`, removeOnComplete: true },
        );
        console.log(
          JSON.stringify({
            level: "info",
            message: "Auto-label job dispatched",
            job_id: jobId,
          }),
        );
        return "queue-auto-label";
      }
      console.log(
        JSON.stringify({
          level: "info",
          message: "No dispatch - PUBLISHED but no autoLabel queue provided",
          job_id: jobId,
          status: newStatus,
        }),
      );
      return null;

    // Terminal/failure states - no dispatch
    case "CANCELLED":
    case "DELETED":
    case "FAILED_QMS":
    case "FAILED_CLIP_SELECTION":
    case "FAILED_RENDER":
    case "FAILED_UPLOAD":
    case "FAILED_GENERAL":
    case "FAILED_IRRECOVERABLE":
    case "MARKED_FOR_DELETION":
      console.log(
        JSON.stringify({
          level: "info",
          message: "No dispatch - terminal or failure state",
          job_id: jobId,
          status: newStatus,
        }),
      );
      return null;

    // Space Video pipeline (retired 2026-07-02) — statuses kept only so
    // historical DB rows parse; still routed to a no-op for exhaustiveness.
    case "SPACE_TTS_GENERATING":
    case "SPACE_TRANSCRIBING":
    case "SPACE_PROMPT_GENERATING":
    case "SPACE_IMAGE_GENERATING":
    case "SPACE_VIDEO_GENERATING":
    case "SPACE_ASSEMBLING":
    case "FAILED_SPACE_PIPELINE":
      console.log(
        JSON.stringify({
          level: "info",
          message:
            "No dispatch via dispatchNext - space video format retired, status is historical only",
          job_id: jobId,
          status: newStatus,
        }),
      );
      return null;

    // Long Form Drama pipeline — processors manage their own dispatch
    case "DRAMA_TTS_GENERATING":
    case "DRAMA_TRANSCRIBING":
    case "DRAMA_PROMPT_GENERATING":
    case "DRAMA_IMAGE_GENERATING":
    case "DRAMA_VIDEO_GENERATING":
    case "DRAMA_ASSEMBLING":
    case "DRAMA_QC":
    case "DRAMA_QC_FAILED":
    case "FAILED_DRAMA_PIPELINE":
      console.log(
        JSON.stringify({
          level: "info",
          message:
            "No dispatch via dispatchNext - long form drama pipeline manages its own routing",
          job_id: jobId,
          status: newStatus,
        }),
      );
      return null;

    // Reactor pipeline — processors manage their own dispatch
    case "REACTOR_DOWNLOADING":
    case "REACTOR_TRANSCRIBING":
    case "REACTOR_SCRIPTING":
    case "REACTOR_TTS_GENERATING":
    case "REACTOR_ASSEMBLING":
    case "FAILED_REACTOR_PIPELINE":
      console.log(
        JSON.stringify({
          level: "info",
          message:
            "No dispatch via dispatchNext - reactor pipeline manages its own routing",
          job_id: jobId,
          status: newStatus,
        }),
      );
      return null;

    // Tech footage pipeline — processor manages its own dispatch
    case "TECH_FOOTAGE_COLLECTING":
    case "TECH_FOOTAGE_FAILED":
      console.log(
        JSON.stringify({
          level: "info",
          message:
            "No dispatch via dispatchNext - tech footage pipeline manages its own routing",
          job_id: jobId,
          status: newStatus,
        }),
      );
      return null;

    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = newStatus;
      console.log(
        JSON.stringify({
          level: "warn",
          message: "No dispatch rule for status",
          job_id: jobId,
          status: newStatus,
        }),
      );
      return null;
    }
  }
}
