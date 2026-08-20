import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { clips, clipLibraries } from "@repo/db";
import { createRedisConnection, createClipEmbedQueue } from "@repo/queue";

export const dynamic = "force-dynamic";

/**
 * POST /api/clip-library/[libraryId]/reembed
 *
 * Bulk-enqueues all clips in a library for re-embedding.
 * Used after fixing the halfvec dimension bug to regenerate all embeddings.
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

    const allClips = await db
      .select({ id: clips.id })
      .from(clips)
      .where(eq(clips.library_id, libraryId));

    if (allClips.length === 0) {
      return NextResponse.json({
        enqueued: 0,
        message: "No clips in this library",
      });
    }

    const connection = createRedisConnection({
      url: process.env["REDIS_URL"] ?? "redis://localhost:6379",
      mode: "queue",
    });

    try {
      const queue = createClipEmbedQueue(connection);

      const jobs = allClips.map((clip) => ({
        name: "embed-clip",
        data: { clip_id: clip.id },
        opts: { jobId: `clip-embed-${clip.id}`, removeOnComplete: true },
      }));

      await queue.addBulk(jobs);
      await queue.close();
    } finally {
      await connection.quit().catch(() => {});
    }

    return NextResponse.json({ enqueued: allClips.length });
  } catch (error) {
    console.error("POST /api/clip-library/[libraryId]/reembed error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
