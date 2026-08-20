"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { createIngestQueue, createRedisConnection } from "@repo/queue";

export interface CreateJobInput {
  channel_id: string;
  format: string;
  template_id: string;
  initial_topic?: string;
  production_version?: "V1" | "V2" | "V3";
  script_text?: string;
  skip_image_qc?: boolean;
  skip_final_qc?: boolean;
  /**
   * TECH_COMPARISON only. When false (the default) the job parks at
   * AWAITING_RESEARCH until an operator uploads Perplexity research files; when
   * true the script is written from the LLM's own knowledge and the human gate
   * is skipped. The toggle existed only on the /formats ingestion panel, so
   * every job created from the job-create form silently parked.
   */
  skip_research?: boolean;
  image_generation_mode?: "auto" | "manual";
  language?: string;
  aspect_ratio?: "16:9" | "9:16" | "1:1" | "4:3";
  target_duration_seconds?: number;
  narration_source_path?: string;
  archetype_id?: string;
  character_ids?: string[];
  metadata?: Record<string, unknown>;
  bundestag_clip_paths?: string[];
  pre_uploaded_assets?: Array<{
    key: string;
    type: string;
    size_bytes: number;
  }>;
}

export interface CreateJobResult {
  success: boolean;
  error?: string;
}

export async function createJob(
  input: CreateJobInput,
): Promise<CreateJobResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "create:job")) {
    return { success: false, error: "Permission denied" };
  }

  if (!input.channel_id || !input.template_id || !input.format) {
    return {
      success: false,
      error: "channel_id, template_id, and format are required",
    };
  }

  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl) {
    return { success: false, error: "Redis not configured" };
  }

  try {
    const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
    const ingestQueue = createIngestQueue(conn);

    await ingestQueue.add("ingest-job", {
      channel_id: input.channel_id,
      format: input.format as any,
      template_id: input.template_id,
      production_version: (input.production_version ?? "V2") as any,
      initial_topic: input.initial_topic,
      script_text: input.script_text || undefined,
      skip_image_qc: input.skip_image_qc ?? false,
      skip_final_qc: input.skip_final_qc ?? false,
      skip_research: input.skip_research ?? false,
      image_generation_mode: input.image_generation_mode ?? "auto",
      language: input.language ?? "en",
      aspect_ratio: input.aspect_ratio ?? "16:9",
      target_duration_seconds: input.target_duration_seconds || undefined,
      narration_source_path: input.narration_source_path || undefined,
      archetype_id: input.archetype_id || undefined,
      character_ids: input.character_ids?.length
        ? input.character_ids
        : undefined,
      metadata: input.metadata || undefined,
      bundestag_clip_paths: input.bundestag_clip_paths?.length
        ? input.bundestag_clip_paths
        : undefined,
      pre_uploaded_assets: input.pre_uploaded_assets?.length
        ? input.pre_uploaded_assets
        : undefined,
    });

    await conn.quit();

    revalidatePath("/jobs");
    return { success: true };
  } catch (err) {
    console.error("[createJob]", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create job",
    };
  }
}
