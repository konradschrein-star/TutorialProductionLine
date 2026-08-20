import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { clips, sourceVideos, clipLibraries } from "@repo/db";
import { eq, isNull, and } from "drizzle-orm";
import { createClipExtractQueue } from "@repo/queue";
import { createRedisConnection } from "@repo/queue";

export const dynamic = "force-dynamic";

/**
 * POST /api/clip-library/[libraryId]/materialize
 *
 * Triggers FFmpeg clip extraction for all source videos that have clips
 * without cdn_url (i.e., not yet materialized).
 *
 * Also sets the library's clip_storage_strategy to 'materialized'.
 *
 * Returns: { dispatched: number, source_videos: string[] }
 */
export async function POST(
  _request: NextRequest,
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

  // Verify library exists
  const [library] = await db
    .select({ id: clipLibraries.id })
    .from(clipLibraries)
    .where(eq(clipLibraries.id, libraryId))
    .limit(1);

  if (!library) {
    return NextResponse.json({ error: "Library not found" }, { status: 404 });
  }

  // Set library strategy to materialized
  await db
    .update(clipLibraries)
    .set({ clip_storage_strategy: "materialized" })
    .where(eq(clipLibraries.id, libraryId));

  // Find source videos that have at least one unextracted clip
  const unextractedClips = await db
    .selectDistinct({ source_video_id: clips.source_video_id })
    .from(clips)
    .where(and(eq(clips.library_id, libraryId), isNull(clips.cdn_url)));

  if (unextractedClips.length === 0) {
    return NextResponse.json({
      dispatched: 0,
      source_videos: [],
      message: "All clips already materialized",
    });
  }

  // Dispatch clip-extract job for each source video
  const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";
  const connection = createRedisConnection({ url: redisUrl, mode: "queue" });

  try {
    const queue = createClipExtractQueue(connection);
    const dispatchedIds: string[] = [];

    for (const row of unextractedClips) {
      const sourceVideoId = row.source_video_id;
      await queue.add(
        "extract-clips",
        { source_video_id: sourceVideoId, library_id: libraryId },
        {
          jobId: `clip-extract-${sourceVideoId}`,
          removeOnComplete: true,
        },
      );
      dispatchedIds.push(sourceVideoId);
    }

    return NextResponse.json({
      dispatched: dispatchedIds.length,
      source_videos: dispatchedIds,
    });
  } finally {
    await connection.quit();
  }
}
