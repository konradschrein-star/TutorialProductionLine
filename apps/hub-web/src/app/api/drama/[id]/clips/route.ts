import { NextRequest, NextResponse } from "next/server";
import { eq, asc, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { db, dramaClips, dramaCharacters, contentJobs } from "@/lib/db";
import { verifyToken } from "@/lib/auth/jwt";

export const dynamic = "force-dynamic";

/**
 * GET /api/drama/[id]/clips
 *
 * Returns the drama job's status + every clip with prompt + per-clip
 * progress + the character cards referenced by any clip. Used by the
 * job detail page's DramaClipsPanel to give the user a per-scene view
 * while the pipeline runs.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Hand-roll the session check so an invalid token returns a JSON 401
  // instead of the redirect to /login that getSession() does — the panel
  // is a client fetch that would otherwise see HTML and crash trying to
  // JSON.parse the login page.
  const token = (await cookies()).get("hub_session")?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await verifyToken(token);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: jobId } = await params;

  const [job] = await db
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

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const clips = await db
    .select()
    .from(dramaClips)
    .where(eq(dramaClips.job_id, jobId))
    .orderBy(asc(dramaClips.clip_index));

  const charIds = new Set<string>();
  for (const c of clips) {
    for (const id of c.character_ids ?? []) charIds.add(id);
  }
  const characters = charIds.size
    ? await db
        .select()
        .from(dramaCharacters)
        .where(inArray(dramaCharacters.id, [...charIds]))
    : [];

  const meta = (job.metadata ?? {}) as Record<string, unknown>;
  const dramaConfig =
    (meta["drama_config"] as Record<string, unknown> | undefined) ?? {};

  // State machine history is the timeline of stage transitions — entries
  // look like { from_status, to_status, timestamp, reason? }. The current
  // stage's elapsed timer comes from the most recent transition into it.
  interface HistoryEntry {
    from_status?: string;
    to_status: string;
    timestamp: string;
    reason?: string | null;
  }
  const rawHistory = (job.state_machine_history as HistoryEntry[] | null) ?? [];

  return NextResponse.json({
    job: {
      id: job.id,
      status: job.status,
      created_at: job.created_at,
      status_updated_at: job.status_updated_at,
      render_mode:
        (meta["render_mode"] as string | undefined) ??
        (dramaConfig["renderMode"] as string | undefined) ??
        null,
      script:
        (dramaConfig["script"] as string | undefined) ??
        (meta["drama_script"] as string | undefined) ??
        null,
      state_history: rawHistory,
      has_audio: !!(meta["drama_audio_path"] as string | undefined),
      has_transcript: !!(meta["drama_word_timings"] as unknown),
      word_timings:
        (meta["drama_word_timings"] as
          | Array<{
              word: string;
              start_ms: number;
              end_ms: number;
            }>
          | undefined) ?? null,
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
  });
}
