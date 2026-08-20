import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sourceVideos, clipLibraries } from "@repo/db";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/clip-library/[libraryId]/source-videos/[videoId]
 *
 * Deletes a source video and all its clips (cascade) plus the source file on disk.
 * Works for any status including failed jobs.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ libraryId: string; videoId: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { libraryId, videoId } = await params;
    if (!UUID_RE.test(libraryId) || !UUID_RE.test(videoId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
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

    // Fetch the source video (must belong to this library)
    const [video] = await db
      .select({
        id: sourceVideos.id,
        source_file_path: sourceVideos.source_file_path,
      })
      .from(sourceVideos)
      .where(
        and(
          eq(sourceVideos.id, videoId),
          eq(sourceVideos.library_id, libraryId),
        ),
      )
      .limit(1);

    if (!video) {
      return NextResponse.json(
        { error: "Source video not found" },
        { status: 404 },
      );
    }

    // Delete from DB — clips cascade automatically via FK onDelete: "cascade"
    await db.delete(sourceVideos).where(eq(sourceVideos.id, videoId));

    // Best-effort: remove source file from disk (don't fail if missing)
    if (video.source_file_path) {
      try {
        const fs = await import("node:fs/promises");
        await fs.unlink(video.source_file_path);
      } catch {
        // file already gone or never existed — fine
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE source-video error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
