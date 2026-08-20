import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNotNull } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { clips, clipLibraries } from "@repo/db";
import { createRedisConnection, createClipRetagQueue } from "@repo/queue";

export const dynamic = "force-dynamic";

/**
 * POST /api/clip-library/[libraryId]/retag
 *
 * Bulk-enqueues all clips with an ai_description for vocabulary tag re-assignment.
 * Used after updating the library's tag_vocabulary to backfill tags on existing clips.
 *
 * Returns: { enqueued: number }
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ libraryId: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { libraryId } = await params;
    if (!libraryId || !/^[0-9a-f-]{36}$/i.test(libraryId)) {
      return NextResponse.json(
        { error: "Invalid library ID" },
        { status: 400 },
      );
    }

    const [library] = await db
      .select({ id: clipLibraries.id })
      .from(clipLibraries)
      .where(eq(clipLibraries.id, libraryId))
      .limit(1);

    if (!library) {
      return NextResponse.json({ error: "Library not found" }, { status: 404 });
    }

    const clipsToRetag = await db
      .select({ id: clips.id })
      .from(clips)
      .where(
        and(eq(clips.library_id, libraryId), isNotNull(clips.ai_description)),
      );

    if (clipsToRetag.length === 0) {
      return NextResponse.json({
        enqueued: 0,
        message: "No clips with descriptions to retag",
      });
    }

    const connection = createRedisConnection({
      url: process.env["REDIS_URL"] ?? "redis://localhost:6379",
      mode: "queue",
    });

    try {
      const queue = createClipRetagQueue(connection);

      const jobs = clipsToRetag.map((clip) => ({
        name: "retag-clip",
        data: { clip_id: clip.id, library_id: libraryId },
        opts: { jobId: `clip-retag-${clip.id}`, removeOnComplete: true },
      }));

      await queue.addBulk(jobs);
      await queue.close();
    } finally {
      await connection.quit().catch(() => {});
    }

    return NextResponse.json({ enqueued: clipsToRetag.length });
  } catch (error) {
    console.error("POST /api/clip-library/[libraryId]/retag error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
