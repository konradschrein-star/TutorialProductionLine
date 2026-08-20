import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { clips } from "@repo/db";
import { createRedisConnection, createClipRetagQueue } from "@repo/queue";

export const dynamic = "force-dynamic";

/**
 * POST /api/clip-library/clips/[clipId]/retag
 *
 * Enqueues a single clip for AI vocabulary re-tagging.
 * Used to trigger retag from the HITL review UI without bulk-reprocessing the whole library.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ clipId: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { clipId } = await params;
    if (!clipId || !/^[0-9a-f-]{36}$/i.test(clipId)) {
      return NextResponse.json({ error: "Invalid clip ID" }, { status: 400 });
    }

    const [clip] = await db
      .select({
        id: clips.id,
        library_id: clips.library_id,
        ai_description: clips.ai_description,
      })
      .from(clips)
      .where(eq(clips.id, clipId))
      .limit(1);

    if (!clip) {
      return NextResponse.json({ error: "Clip not found" }, { status: 404 });
    }

    if (!clip.ai_description) {
      return NextResponse.json(
        { error: "Clip has no AI description — run VLM labeling first" },
        { status: 422 },
      );
    }

    const connection = createRedisConnection({
      url: process.env["REDIS_URL"] ?? "redis://localhost:6379",
      mode: "queue",
    });

    try {
      const queue = createClipRetagQueue(connection);
      await queue.add(
        "retag-clip",
        { clip_id: clip.id, library_id: clip.library_id },
        { jobId: `clip-retag-${clip.id}`, removeOnComplete: true },
      );
      await queue.close();
    } finally {
      await connection.quit().catch(() => {});
    }

    return NextResponse.json({ enqueued: true });
  } catch (error) {
    console.error("POST /api/clip-library/clips/[clipId]/retag error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
