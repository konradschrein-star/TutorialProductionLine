import { eq, asc, inArray } from "drizzle-orm";
import { contentJobs, dramaClips, dramaCharacters } from "@repo/db";
import { CfApiError } from "../errors.js";
import type { CfRuntime } from "../runtime.js";

export interface JobClipsResponse {
  job: {
    id: string;
    status: string;
    created_at: string;
    status_updated_at: string | null;
    render_mode: string | null;
    script: string | null;
    state_history: Array<{
      from_status?: string;
      to_status: string;
      timestamp: string;
      reason?: string | null;
    }>;
    has_audio: boolean;
    has_transcript: boolean;
  };
  characters: Array<{
    id: string;
    name: string;
    description: string | null;
    thumbnail_url: string | null;
  }>;
  clips: Array<{
    id: string;
    clip_index: number;
    section_type: string | null;
    text: string;
    start_ms: number;
    end_ms: number;
    image_prompt: string | null;
    image_path: string | null;
    image_status: string | null;
    video_path: string | null;
    video_status: string | null;
    character_ids: string[] | null;
  }>;
}

/**
 * Per-clip view for drama jobs. Mirrors the response of the legacy
 * apps/hub-web/src/app/api/drama/[id]/clips/route.ts.
 */
export async function listJobClips(
  rt: CfRuntime,
  jobId: string,
): Promise<JobClipsResponse> {
  const [job] = await rt.db
    .select({
      id: contentJobs.id,
      status: contentJobs.status,
      metadata: contentJobs.metadata,
      created_at: contentJobs.created_at,
      status_updated_at: contentJobs.status_updated_at,
      state_machine_history: contentJobs.state_machine_history,
    })
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);
  if (!job) throw new CfApiError("NOT_FOUND", `Job ${jobId} not found`);

  const clips = await rt.db
    .select()
    .from(dramaClips)
    .where(eq(dramaClips.job_id, jobId))
    .orderBy(asc(dramaClips.clip_index));

  const charIds = new Set<string>();
  for (const c of clips) {
    for (const id of c.character_ids ?? []) charIds.add(id);
  }
  const characters = charIds.size
    ? await rt.db
        .select()
        .from(dramaCharacters)
        .where(inArray(dramaCharacters.id, [...charIds]))
    : [];

  const meta = (job.metadata ?? {}) as Record<string, unknown>;
  const dramaConfig =
    (meta["drama_config"] as Record<string, unknown> | undefined) ?? {};
  const history =
    (job.state_machine_history as JobClipsResponse["job"]["state_history"]) ??
    [];

  return {
    job: {
      id: job.id,
      status: job.status,
      created_at: job.created_at.toISOString(),
      status_updated_at: job.status_updated_at?.toISOString() ?? null,
      render_mode:
        (meta["render_mode"] as string | undefined) ??
        (dramaConfig["renderMode"] as string | undefined) ??
        null,
      script:
        (dramaConfig["script"] as string | undefined) ??
        (meta["drama_script"] as string | undefined) ??
        null,
      state_history: history,
      has_audio: !!(meta["drama_audio_path"] as string | undefined),
      has_transcript: !!(meta["drama_word_timings"] as unknown),
    },
    characters: characters.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      thumbnail_url: c.thumbnail_url,
    })),
    clips: clips.map((c) => ({
      id: c.id,
      clip_index: c.clip_index,
      section_type: c.section_type,
      text: c.text,
      start_ms: c.start_ms,
      end_ms: c.end_ms,
      image_prompt: c.image_prompt,
      image_path: c.image_path,
      image_status: c.image_status,
      video_path: c.video_path,
      video_status: c.video_status,
      character_ids: c.character_ids,
    })),
  };
}
