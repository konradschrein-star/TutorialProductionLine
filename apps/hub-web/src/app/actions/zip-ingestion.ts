"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { createIngestQueue, createRedisConnection } from "@repo/queue";
import type { IngestPayload } from "@repo/contracts";

/**
 * Staged-Job Dispatch Server Action
 *
 * `dispatchStagedJobs` — fans the create form's staging table out to the
 * ingest queue (one job per staged row). The legacy zip-only bulk path
 * (`bulkCreateFromZip`) and the agent topic-list path (`bulkCreateFromTopics`)
 * were removed 2026-07-11: job creation is now agent-friendly at any scale, so
 * a dedicated bulk entry point earned its keep no longer. Historical filename
 * kept to avoid churning the 3 live import sites.
 */

// --- Unified Staging Table Dispatch ---

export interface StagedJobPayload {
  topic: string;
  script_text: string | null;
  channel_id: string;
  template_id: string;
  format: string;
  production_version: "V1" | "V2" | "V3";
  subtitles: boolean;
  skip_image_qc: boolean;
  skip_final_qc: boolean;
  language: string;
  /** TTS voice_id (selected from tts_voices table) */
  voice_id?: string | null;
  /** Unused legacy field — videos now uploaded via /api/upload */
  video_key: string | null;
  /** Pre-uploaded asset from /api/upload (R2 key + metadata) */
  pre_uploaded_asset: {
    key: string;
    type: string;
    size_bytes: number;
  } | null;
  /**
   * Assembled style asset context for illustration-mode formats (CASUALLY_EXPLAINED).
   * Concatenated descriptions of selected personas, backgrounds, and style guide.
   * Stored in content_jobs.metadata.style_asset_context for scene-analysis to read.
   */
  style_asset_context?: string | null;
  /**
   * Optional environment UUID. When set, scene-analysis injects the environment
   * description and PIP spatial hints into every enriched image prompt for this job.
   */
  environment_id?: string | null;
  /**
   * Media assets (video/audio/image) selected from the media library during job creation.
   * Stored in content_jobs.metadata.media_asset_refs for usage tracking and impact analysis.
   * Each ref includes: asset_id, asset_type, name, size_bytes for traceability.
   */
  media_asset_refs?: Array<{
    zone_id: string;
    asset_id: string;
    asset_type: "video" | "audio" | "image";
    name: string;
    size_bytes: number;
  }>;
  /**
   * Character UUIDs for illustration formats (CASUALLY_EXPLAINED).
   * Passed to ingest queue and stored in content_jobs for consistent character generation.
   */
  character_ids?: string[];
  /**
   * Image generation mode: 'auto' (AI generates images) or 'manual' (VA uploads images).
   * Only applicable to formats using script-based image generation.
   * TECH_COMPARISON and other special workflows do not use this field.
   */
  image_generation_mode?: "auto" | "manual";
  /**
   * Pre-uploaded video clip file paths (for Bundestag format).
   * Array of absolute paths to video files that have been manually staged via SCP.
   * Each path should be validated to exist on the server during orchestrator ingestion.
   */
  bundestag_clip_paths?: string[];
  /**
   * Archetype ID defining visual style — CRITICAL for per_video_assets assembly.
   * Inherited from template but can be overridden per job.
   */
  archetype_id?: string;
  /**
   * Style library ID for reference images.
   * Inherited from template default_style_library_id but can be overridden per job.
   */
  style_library_id?: string;
}

export interface DispatchResult {
  success: boolean;
  queued: number;
  results: Array<{
    topic: string;
    success: boolean;
    error?: string;
  }>;
}

/**
 * Dispatch staged jobs from the unified staging table.
 *
 * Receives a FormData with:
 * - `jobs` (JSON string): Array of StagedJobPayload
 * - `video_<index>` (File): Video files keyed by their index
 */
export async function dispatchStagedJobs(
  formData: FormData,
): Promise<DispatchResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "create:job")) {
    return {
      success: false,
      queued: 0,
      results: [{ topic: "", success: false, error: "Permission denied" }],
    };
  }

  const jobsJson = formData.get("jobs") as string;
  if (!jobsJson) {
    return {
      success: false,
      queued: 0,
      results: [{ topic: "", success: false, error: "No jobs provided" }],
    };
  }

  let jobPayloads: StagedJobPayload[];
  try {
    jobPayloads = JSON.parse(jobsJson);
  } catch {
    return {
      success: false,
      queued: 0,
      results: [{ topic: "", success: false, error: "Invalid jobs JSON" }],
    };
  }

  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl) {
    return {
      success: false,
      queued: 0,
      results: [{ topic: "", success: false, error: "Redis not configured" }],
    };
  }

  const ingestJobs: Array<{
    name: string;
    data: IngestPayload;
    opts: { delay: number };
  }> = [];

  const results: DispatchResult["results"] = [];

  for (let i = 0; i < jobPayloads.length; i++) {
    const job = jobPayloads[i];

    // Build pre_uploaded_assets from the already-uploaded R2 asset
    const preUploadedAssets: Array<{
      key: string;
      type: string;
      size_bytes: number;
    }> = [];

    if (job.pre_uploaded_asset) {
      preUploadedAssets.push(job.pre_uploaded_asset);
    }

    const payload: IngestPayload = {
      channel_id: job.channel_id,
      format: job.format as IngestPayload["format"],
      template_id: job.template_id,
      production_version: job.production_version ?? "V2",
      initial_topic: job.topic,
      skip_image_qc: job.skip_image_qc ?? false,
      skip_final_qc: job.skip_final_qc ?? false,
      skip_research: false,
      language: job.language ?? "en",
      aspect_ratio: "16:9",
      image_generation_mode: job.image_generation_mode ?? "auto",
      ...(job.script_text ? { script_text: job.script_text } : {}),
      ...(preUploadedAssets.length > 0
        ? { pre_uploaded_assets: preUploadedAssets }
        : {}),
      ...(job.character_ids && job.character_ids.length > 0
        ? { character_ids: job.character_ids }
        : {}),
      ...(job.bundestag_clip_paths && job.bundestag_clip_paths.length > 0
        ? { bundestag_clip_paths: job.bundestag_clip_paths }
        : {}),
      ...(job.archetype_id ? { archetype_id: job.archetype_id } : {}),
      ...(job.style_asset_context ||
      job.environment_id ||
      job.media_asset_refs ||
      job.voice_id ||
      job.style_library_id
        ? {
            metadata: {
              ...(job.style_asset_context
                ? { style_asset_context: job.style_asset_context }
                : {}),
              ...(job.environment_id
                ? { environment_id: job.environment_id }
                : {}),
              ...(job.media_asset_refs && job.media_asset_refs.length > 0
                ? { media_asset_refs: job.media_asset_refs }
                : {}),
              ...(job.voice_id ? { voice_id: job.voice_id } : {}),
              ...(job.style_library_id
                ? { style_library_id: job.style_library_id }
                : {}),
            },
          }
        : {}),
    };

    ingestJobs.push({
      name: "ingest-job",
      data: payload,
      opts: { delay: i * 100 },
    });

    results.push({ topic: job.topic, success: true });
  }

  // Fan out to queue
  let queued = 0;
  try {
    const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
    const ingestQueue = createIngestQueue(conn);

    if (ingestJobs.length > 0) {
      const bulkResults = await ingestQueue.addBulk(ingestJobs);
      queued = bulkResults.length;
    }

    await conn.quit();
  } catch (err) {
    return {
      success: false,
      queued: 0,
      results: [
        {
          topic: "",
          success: false,
          error: `Queue dispatch failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        },
      ],
    };
  }

  revalidatePath("/jobs");
  revalidatePath("/formats");

  return {
    success: queued > 0,
    queued,
    results,
  };
}
