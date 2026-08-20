import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { desc, eq } from "drizzle-orm";
import { db, musicLibrary } from "@/lib/db";
import { verifyToken } from "@/lib/auth/jwt";

export const dynamic = "force-dynamic";

/**
 * GET /api/drama/music-library?format=LONG_FORM_DRAMA
 *
 * Lists tracks from the global `music_library` table — the bucket
 * where auto-generated Suno music is written when assemble produces
 * a video. Filter by `format` so each format only sees its own
 * vibe-matched tracks.
 */
export async function GET(req: NextRequest) {
  const token = (await cookies()).get("hub_session")?.value;
  if (!token)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await verifyToken(token);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const format = url.searchParams.get("format");
  const rows = format
    ? await db
        .select()
        .from(musicLibrary)
        .where(eq(musicLibrary.format, format))
        .orderBy(desc(musicLibrary.created_at))
        .limit(500)
    : await db
        .select()
        .from(musicLibrary)
        .orderBy(desc(musicLibrary.created_at))
        .limit(500);

  return NextResponse.json({
    tracks: rows.map((r) => ({
      id: r.id,
      name: r.name,
      duration_seconds: r.duration_seconds,
      genre: r.genre,
      format: r.format,
      created_at: r.created_at,
    })),
  });
}
