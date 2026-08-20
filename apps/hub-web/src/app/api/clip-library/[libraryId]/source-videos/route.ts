import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sourceVideos, clipLibraries } from "@repo/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/clip-library/[libraryId]/source-videos
 *
 * List all source videos for a library with ingest status.
 *
 * Response: { sourceVideos: [...], total }
 */
export async function GET(
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

    // Verify library exists
    const [library] = await db
      .select({ id: clipLibraries.id })
      .from(clipLibraries)
      .where(eq(clipLibraries.id, libraryId))
      .limit(1);

    if (!library) {
      return NextResponse.json({ error: "Library not found" }, { status: 404 });
    }

    const rows = await db
      .select()
      .from(sourceVideos)
      .where(eq(sourceVideos.library_id, libraryId))
      .orderBy(sourceVideos.created_at);

    return NextResponse.json({
      sourceVideos: rows,
      total: rows.length,
    });
  } catch (error) {
    console.error(
      "GET /api/clip-library/[libraryId]/source-videos error:",
      error,
    );
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
