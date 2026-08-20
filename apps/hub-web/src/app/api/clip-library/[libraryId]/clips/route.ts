import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { clips, sourceVideos } from "@repo/db";
import { eq, and, count } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/clip-library/[libraryId]/clips
 *
 * List clips for a library with pagination and filters.
 *
 * Query params:
 *   status         - clip review_status filter (pending|approved|edited|flagged|skipped)
 *   labeling_step  - clip labeling_step filter (vlm|whisper|face|audio|done)
 *   source_video_id - filter by source video UUID
 *   page           - 1-indexed page number (default 1)
 *   limit          - page size (default 20, max 100)
 *
 * Response: { clips: [...], total, page, limit }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ libraryId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { libraryId } = await params;
  if (!libraryId || !/^[0-9a-f-]{36}$/i.test(libraryId)) {
    return NextResponse.json({ error: "Invalid library ID" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status") ?? undefined;
  const labelingStepFilter = searchParams.get("labeling_step") ?? undefined;
  const sourceVideoIdFilter = searchParams.get("source_video_id") ?? undefined;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)),
  );
  const offset = (page - 1) * limit;

  // Build where conditions
  const conditions = [eq(clips.library_id, libraryId)];

  if (statusFilter) {
    const validStatuses = [
      "pending",
      "approved",
      "edited",
      "flagged",
      "skipped",
    ] as const;
    if (
      validStatuses.includes(statusFilter as (typeof validStatuses)[number])
    ) {
      conditions.push(
        eq(clips.review_status, statusFilter as (typeof validStatuses)[number]),
      );
    }
  }

  if (labelingStepFilter) {
    const validSteps = ["vlm", "whisper", "face", "audio", "done"] as const;
    if (
      validSteps.includes(labelingStepFilter as (typeof validSteps)[number])
    ) {
      conditions.push(
        eq(
          clips.labeling_step,
          labelingStepFilter as (typeof validSteps)[number],
        ),
      );
    }
  }

  if (sourceVideoIdFilter && /^[0-9a-f-]{36}$/i.test(sourceVideoIdFilter)) {
    conditions.push(eq(clips.source_video_id, sourceVideoIdFilter));
  }

  const where = and(...conditions);

  try {
    const [totalResult, rows] = await Promise.all([
      db.select({ total: count() }).from(clips).where(where),
      db
        .select({
          id: clips.id,
          library_id: clips.library_id,
          source_video_id: clips.source_video_id,
          source_video_cdn_url: sourceVideos.cdn_url,
          start_ms: clips.start_ms,
          end_ms: clips.end_ms,
          cdn_url: clips.cdn_url,
          thumbnail_url: clips.thumbnail_url,
          review_status: clips.review_status,
          labeling_step: clips.labeling_step,
          ai_description: clips.ai_description,
          shot_scale: clips.shot_scale,
          dominant_mood: clips.dominant_mood,
          audio_class: clips.audio_class,
          tags_characters: clips.tags_characters,
          tags_mood: clips.tags_mood,
          tags_location: clips.tags_location,
          tags_action: clips.tags_action,
          tags_custom: clips.tags_custom,
          characters_present: clips.characters_present,
          transcript: clips.transcript,
          transcript_json: clips.transcript_json,
          width: clips.width,
          height: clips.height,
          fps: clips.fps,
          ai_confidence: clips.ai_confidence,
          clip_type: clips.clip_type,
          // Visual analysis
          motion_level: clips.motion_level,
          camera_movement: clips.camera_movement,
          lighting_style: clips.lighting_style,
          color_temperature: clips.color_temperature,
          face_count: clips.face_count,
          has_text_overlay: clips.has_text_overlay,
          dialogue_present: clips.dialogue_present,
          source_episode: clips.source_episode,
          scene_context: clips.scene_context,
          keywords: clips.keywords,
          // Human review
          quality_score: clips.quality_score,
          manual_notes: clips.manual_notes,
          is_usable: clips.is_usable,
          reviewed_at: clips.reviewed_at,
          times_used: clips.times_used,
          last_used_at: clips.last_used_at,
        })
        .from(clips)
        .leftJoin(sourceVideos, eq(clips.source_video_id, sourceVideos.id))
        .where(where)
        .limit(limit)
        .offset(offset),
    ]);

    const total = totalResult[0]?.total ?? 0;

    return NextResponse.json({
      clips: rows,
      total,
      page,
      limit,
    });
  } catch (err) {
    console.error("GET /api/clip-library/[libraryId]/clips error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
