export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { musicLibrary } from "@repo/db/schema";
import { eq } from "drizzle-orm";
import { getSession } from "@/app/(authenticated)/_lib/v2-auth";
import { createReadStream, statSync } from "fs";
import { Readable } from "stream";
import { contentTypeForExtension, extensionOf } from "../../_lib/audio-file";

/**
 * Node read stream -> web ReadableStream.
 *
 * Uses Readable.toWeb rather than a hand-rolled controller: the previous
 * version imported ReadableStream from "stream/web", which is a different
 * type from the one Response accepts, and never handled backpressure.
 */
function toWebStream(
  path: string,
  opts?: { start: number; end: number },
): ReadableStream<Uint8Array> {
  return Readable.toWeb(
    createReadStream(path, opts),
  ) as ReadableStream<Uint8Array>;
}

/**
 * GET /api/music-library/[id]/stream
 * Stream a system-wide music_library track for preview.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Get track file path (music_library is system-wide, no ownership)
    const [track] = await db
      .select()
      .from(musicLibrary)
      .where(eq(musicLibrary.id, id));

    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    // Check if file exists
    let fileStats;
    try {
      fileStats = statSync(track.file_path);
    } catch (error) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Serve the real content type. Claiming audio/mpeg for a wav or flac made
    // some browsers refuse to play a perfectly good file.
    const contentType = contentTypeForExtension(extensionOf(track.file_path));

    // Range requests power seeking in the inline audio players.
    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!match) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${fileStats.size}` },
        });
      }

      const [, rawStart, rawEnd] = match;
      let start = rawStart ? Number.parseInt(rawStart, 10) : 0;
      let end = rawEnd ? Number.parseInt(rawEnd, 10) : fileStats.size - 1;

      // A suffix range ("bytes=-500") means the last N bytes.
      if (!rawStart && rawEnd) {
        start = Math.max(0, fileStats.size - Number.parseInt(rawEnd, 10));
        end = fileStats.size - 1;
      }

      // Clamp rather than hand ffmpeg/the browser an impossible window.
      end = Math.min(end, fileStats.size - 1);

      if (start > end || start >= fileStats.size) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${fileStats.size}` },
        });
      }

      return new NextResponse(toWebStream(track.file_path, { start, end }), {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileStats.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": (end - start + 1).toString(),
          "Content-Type": contentType,
        },
      });
    }

    return new NextResponse(toWebStream(track.file_path), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": fileStats.size.toString(),
        "Accept-Ranges": "bytes",
      },
    });
  } catch (error) {
    console.error("Failed to stream music track:", error);
    return NextResponse.json(
      { error: "Failed to stream track" },
      { status: 500 },
    );
  }
}
