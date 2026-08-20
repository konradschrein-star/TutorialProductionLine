import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, contentJobs } from "@/lib/db";
import { getHubConfig } from "@/lib/config";
import {
  createRedisConnection,
  createIngestQueue,
  createBundestagClipAnalysisQueue,
  createBundestagPlaybookGenerationQueue,
  createBundestagRenderQueue,
  createSceneAnalysisQueue,
  createAssetCollectionQueue,
  createRenderHeavyQueue,
  createAIGenerationQueue,
} from "@repo/queue";

export const dynamic = "force-dynamic";

const MAX_RETRIES = 10;

/**
 * POST /api/jobs/:id/retry
 *
 * Retry a failed job by resetting its status and re-dispatching to the appropriate queue.
 *
 * Authorization: Requires 'retry:job' permission (ADMIN, MANAGER)
 *
 * Workflow:
 * 1. Validate job exists and is in a retryable failed state
 * 2. Determine reset status and target queue based on format and failure type
 * 3. Increment retry_count in metadata
 * 4. Update job status
 * 5. Re-dispatch to appropriate queue
 *
 * Blocked states:
 * - FAILED_IRRECOVERABLE: Requires human intervention, cannot retry
 *
 * Returns:
 * - 200: { success: true, message, new_status, retry_count, queue_name }
 * - 400: Invalid job ID or job not in retryable state
 * - 403: Permission denied
 * - 404: Job not found
 * - 409: Job is FAILED_IRRECOVERABLE
 * - 500: Server error (queue dispatch failure, database error)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1. Validate session
  const session = await getSession();
  if (!session || !hasPermission(session, "retry:job")) {
    return NextResponse.json(
      { error: "Insufficient permissions" },
      { status: 403 },
    );
  }

  // 2. Validate job ID
  const { id: jobId } = await params;
  if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json({ error: "Invalid job ID" }, { status: 400 });
  }

  // 3. Fetch job
  const [job] = await db
    .select()
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // 4. Check max retries guard
  if (((job.metadata as any)?.retry_count ?? 0) >= MAX_RETRIES) {
    return NextResponse.json(
      {
        error: `Job has exceeded the maximum of ${MAX_RETRIES} retries. Contact an admin to reset or mark as FAILED_IRRECOVERABLE.`,
      },
      { status: 422 },
    );
  }

  // 5. Validate job is in retryable failed state
  if (job.status === "FAILED_IRRECOVERABLE") {
    return NextResponse.json(
      {
        error:
          "Cannot retry FAILED_IRRECOVERABLE jobs - requires human intervention",
      },
      { status: 409 },
    );
  }

  if (!job.status.startsWith("FAILED_")) {
    return NextResponse.json(
      { error: `Cannot retry job in status: ${job.status}` },
      { status: 400 },
    );
  }

  // 6. Determine reset status and queue based on format and failure type
  const resetResult = determineRetryStrategy(
    job.status,
    job.format,
    (job.script ?? "").trim().length > 0,
  );
  if (!resetResult) {
    return NextResponse.json(
      { error: `No retry strategy defined for ${job.format} format` },
      { status: 500 },
    );
  }

  const { newStatus, queueName } = resetResult;

  // 7. Increment retry count in metadata
  const currentMetadata = (job.metadata as any) || {};
  const retryCount = (currentMetadata.retry_count ?? 0) + 1;
  const updatedMetadata = {
    ...currentMetadata,
    retry_count: retryCount,
    last_retry_at: new Date().toISOString(),
    last_retry_by: session.userId,
    retry_reason: `Manual retry from ${job.status}`,
  };

  // 8. Update job status
  await db
    .update(contentJobs)
    .set({
      status: newStatus as any,
      metadata: updatedMetadata,
      updated_at: new Date(),
      status_updated_at: new Date(),
    })
    .where(eq(contentJobs.id, jobId));

  // 9. Re-dispatch to queue
  try {
    const config = getHubConfig();
    const conn = createRedisConnection({
      url: config.REDIS_URL,
      mode: "queue",
    });

    await dispatchToQueue(
      conn,
      queueName,
      jobId,
      job.format,
      job.template_id,
      currentMetadata,
      job.initial_topic ?? job.title ?? undefined,
    );

    await conn.quit();

    console.warn(
      JSON.stringify({
        level: "info",
        message: "Job retry dispatched",
        job_id: jobId,
        old_status: job.status,
        new_status: newStatus,
        retry_count: retryCount,
        queue_name: queueName,
        retried_by: session.userId,
      }),
    );

    return NextResponse.json({
      success: true,
      message: `Job ${jobId} queued for retry`,
      new_status: newStatus,
      retry_count: retryCount,
      queue_name: queueName,
    });
  } catch (err: any) {
    console.error("Failed to dispatch retry job:", err);
    return NextResponse.json(
      { error: "Failed to dispatch job to queue", details: err.message },
      { status: 500 },
    );
  }
}

/**
 * Determine retry strategy based on failure type and format
 *
 * Strategy:
 * - Intelligently restart from the failed stage if detectable
 * - Default to safe restart points if failure context unclear
 *
 * @param failedStatus - Current failed status
 * @param format - Job format
 * @param hasScript - Whether the job already holds a generated script. Used by
 *   RANKING to decide whether a retry must re-run SCRIPTING or can resume from
 *   ASSET_COLLECTION; see the RANKING case for why that distinction matters.
 * @returns Reset status and queue name, or null if no strategy
 */
function determineRetryStrategy(
  failedStatus: string,
  format: string,
  hasScript: boolean,
): { newStatus: string; queueName: string } | null {
  switch (format) {
    case "RANKING": {
      // RANKING had NO retry strategy at all: it fell through to `default`
      // and every retry returned 500 "No retry strategy defined for RANKING
      // format". A RANKING job that failed was simply dead, which is the
      // opposite of what the VA loop needs — the two most common failures
      // (script-provider timeout, narration anchoring) are both transient or
      // fixable and retrying is the correct response to each.
      //
      // Restart point depends on whether a script exists, because the two
      // halves of the pipeline fail for unrelated reasons:
      //   - no script yet  → SCRIPTING failed (LLM timeout / malformed JSON /
      //     an item the narration never named). Re-run script generation.
      //   - script present → the failure was downstream in ASSET_COLLECTION
      //     (footage fetch, TTS, Whisper, anchoring). Re-running SCRIPTING
      //     there would throw away a good script and re-pay the LLM for
      //     nothing, so resume from asset collection instead.
      if (failedStatus === "FAILED_RENDER") {
        return { newStatus: "ROUTING_RENDER", queueName: "queue-render-heavy" };
      }
      if (failedStatus === "FAILED_UPLOAD") {
        return { newStatus: "AWAITING_UPLOADER", queueName: "" };
      }
      return hasScript
        ? { newStatus: "ASSET_COLLECTION", queueName: "queue-asset-collection" }
        : { newStatus: "SCRIPTING", queueName: "queue-ai-generation" };
    }

    case "BUNDESTAG":
      // Intelligent retry based on failure stage
      switch (failedStatus) {
        case "FAILED_GENERAL":
          // Unclear failure - restart from clip analysis
          return {
            newStatus: "ANALYZING_CLIPS",
            queueName: "queue-bundestag-clip-analysis",
          };
        case "FAILED_QMS":
          // QMS validation failed - restart from playbook generation
          return {
            newStatus: "GENERATING_PLAYBOOK",
            queueName: "queue-bundestag-playbook-generation",
          };
        case "FAILED_RENDER":
          // Render failed - restart from render queue
          return {
            newStatus: "RENDERING",
            queueName: "queue-bundestag-render",
          };
        case "FAILED_UPLOAD":
          // Upload failed - restart from upload flow (manual step)
          return { newStatus: "AWAITING_UPLOADER", queueName: "" };
        default:
          // Default: restart from clip analysis
          return {
            newStatus: "ANALYZING_CLIPS",
            queueName: "queue-bundestag-clip-analysis",
          };
      }

    case "EXPLAINER":
    case "TECH_COMPARISON":
    case "DOCUMENTARY":
    case "VIDEO_ESSAY":
    case "CASUALLY_EXPLAINED":
      // Standard pipeline formats
      switch (failedStatus) {
        case "FAILED_GENERAL":
          // Unclear failure - restart from asset collection
          return {
            newStatus: "ASSET_COLLECTION",
            queueName: "queue-asset-collection",
          };
        case "FAILED_QMS":
          // QMS validation failed - restart from asset collection
          return {
            newStatus: "ASSET_COLLECTION",
            queueName: "queue-asset-collection",
          };
        case "FAILED_RENDER":
          // Render failed - restart from render routing
          return {
            newStatus: "ROUTING_RENDER",
            queueName: "queue-render-heavy",
          };
        case "FAILED_UPLOAD":
          // Upload failed - restart from upload flow (manual step)
          return { newStatus: "AWAITING_UPLOADER", queueName: "" };
        default:
          // Default: restart from asset collection
          return {
            newStatus: "ASSET_COLLECTION",
            queueName: "queue-asset-collection",
          };
      }

    default:
      // Unknown format - no retry strategy
      return null;
  }
}

/**
 * Dispatch job to appropriate queue with typed payload
 *
 * @param conn - Redis connection
 * @param queueName - Target queue name
 * @param jobId - Job ID
 * @param format - Job format
 * @param templateId - Template ID
 * @param jobMetadata - The job's current `metadata` column, used to recover
 *   inputs (e.g. BUNDESTAG's `bundestag_clip_paths`) that a retry needs but
 *   that aren't part of the minimal `content_jobs` row.
 * @param jobTopic - The job's topic, required to re-dispatch script generation.
 */
async function dispatchToQueue(
  conn: any,
  queueName: string,
  jobId: string,
  format: string,
  templateId: string,
  jobMetadata: Record<string, unknown>,
  jobTopic?: string,
): Promise<void> {
  // Skip dispatch for manual human-in-the-loop steps
  if (!queueName) {
    return;
  }

  switch (queueName) {
    case "queue-bundestag-clip-analysis": {
      // Single-stream architecture (see BundestagClipAnalysisPayload): the
      // processor needs the original clip path back, not a fresh upload —
      // it was stashed in job.metadata.bundestag_clip_paths at ingest time.
      const clipPaths = jobMetadata.bundestag_clip_paths;
      const videoFilePath =
        Array.isArray(clipPaths) && typeof clipPaths[0] === "string"
          ? clipPaths[0]
          : undefined;
      if (!videoFilePath) {
        throw new Error(
          `Cannot retry job ${jobId}: no bundestag_clip_paths recorded in job metadata`,
        );
      }
      const queue = createBundestagClipAnalysisQueue(conn);
      await queue.add(`retry-${jobId}`, {
        job_id: jobId,
        video_file_path: videoFilePath,
      });
      break;
    }

    case "queue-bundestag-playbook-generation": {
      const queue = createBundestagPlaybookGenerationQueue(conn);
      await queue.add(`retry-${jobId}`, {
        job_id: jobId,
        use_local_llm: true,
        editing_style: "dynamic" as const,
      });
      break;
    }

    case "queue-bundestag-render": {
      const queue = createBundestagRenderQueue(conn);
      await queue.add(`retry-${jobId}`, {
        job_id: jobId,
        output_variants: [
          {
            aspect_ratio: "16:9" as const,
            duration_type: "full" as const,
            quality_preset: "1080p" as const,
          },
        ],
        apply_effects: true,
      });
      break;
    }

    case "queue-scene-analysis": {
      const queue = createSceneAnalysisQueue(conn);
      await queue.add(`retry-${jobId}`, {
        job_id: jobId,
        template_id: templateId,
        script: "", // Will be fetched from database by processor
      });
      break;
    }

    case "queue-asset-collection": {
      const queue = createAssetCollectionQueue(conn);
      await queue.add(`retry-${jobId}`, {
        job_id: jobId,
      });
      break;
    }

    case "queue-ai-generation": {
      // Re-run script generation. The topic must come back from the job row:
      // the processor substitutes it into the template prompt as ${topic}, and
      // sending an empty string here would generate a script for no subject at
      // all rather than fail — exactly the kind of silent-garbage path this
      // codebase forbids. So resolve it and throw if it is not there.
      const topic = (jobTopic ?? "").trim();
      if (!topic) {
        throw new Error(
          `Cannot retry job ${jobId}: the job has no title/initial_topic to generate a script from. ` +
            `Re-running SCRIPTING without a topic would produce a script about nothing.`,
        );
      }
      const queue = createAIGenerationQueue(conn);
      await queue.add(`retry-${jobId}`, {
        job_id: jobId,
        generation_type: "script" as const,
        template_id: templateId,
        topic,
      });
      break;
    }

    case "queue-render-heavy": {
      const queue = createRenderHeavyQueue(conn);
      await queue.add(`retry-${jobId}`, {
        job_id: jobId,
        priority: 0,
      });
      break;
    }

    default:
      throw new Error(`Unknown queue name: ${queueName}`);
  }
}
