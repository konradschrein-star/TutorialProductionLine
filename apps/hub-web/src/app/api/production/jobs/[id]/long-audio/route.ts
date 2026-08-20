import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getTutorialJobById } from "@repo/db";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

export const dynamic = "force-dynamic";

/**
 * GET /api/production/jobs/[id]/long-audio
 * Stream the concatenated long-form TTS audio (long_audio_path) as audio/mpeg.
 * Used by the Stitcher UI to download the full multi-part voiceover for review.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const job = await getTutorialJobById(db, id);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = job.created_by === session.userId;
  const isPrivileged =
    hasPermission(session, "manage:tutorial-settings") ||
    session.role === "ADMIN" ||
    session.role === "MANAGER";

  if (!isOwner && !isPrivileged) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!job.long_audio_path) {
    return NextResponse.json(
      { error: "Long audio not yet generated" },
      { status: 404 },
    );
  }

  // Sanitize title for use in Content-Disposition filename.
  const safeTitle = job.title.replace(/[^a-zA-Z0-9]+/g, "_");
  const filename = `${safeTitle}-long-audio.mp3`;

  try {
    // Verify the file exists on disk before attempting to stream it.
    let fileStats: Awaited<ReturnType<typeof stat>>;
    try {
      fileStats = await stat(job.long_audio_path);
    } catch {
      return NextResponse.json(
        { error: "Long audio file not found on disk" },
        { status: 404 },
      );
    }
    const fileSize = fileStats.size;
    const rangeHeader = _req.headers.get("range");

    // Without a validator a browser cannot use If-Range, so an interrupted
    // download of a large multi-part voiceover has to restart from byte 0
    // instead of resuming. That is most of "downloading is quite slow" on a
    // long-haul link that drops connections at peak hours.
    const validators = {
      ETag: `"${fileSize}-${Math.floor(fileStats.mtimeMs)}"`,
      "Last-Modified": fileStats.mtime.toUTCString(),
      "Cache-Control": "private, no-cache",
    };

    if (rangeHeader) {
      // Stream the requested byte range straight off disk (full requested range,
      // not an artificial cap) so the first byte is instant (no "stuck at 0")
      // and playback streams continuously (no per-chunk round-trips = no pauses).
      const [startStr, endStr] = rangeHeader.replace("bytes=", "").split("-");
      const start = parseInt(startStr ?? "0", 10);
      const end = endStr
        ? Math.min(parseInt(endStr, 10), fileSize - 1)
        : fileSize - 1;

      if (Number.isNaN(start) || start >= fileSize || start > end) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${fileSize}` },
        });
      }

      const nodeStream = createReadStream(job.long_audio_path, { start, end });
      return new NextResponse(
        Readable.toWeb(nodeStream) as unknown as ReadableStream,
        {
          status: 206,
          headers: {
            "Content-Type": "audio/mpeg",
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": (end - start + 1).toString(),
            "Content-Disposition": `attachment; filename="${filename}"`,
            ...validators,
          },
        },
      );
    }

    // No Range header — stream the whole file.
    const nodeStream = createReadStream(job.long_audio_path);
    return new NextResponse(
      Readable.toWeb(nodeStream) as unknown as ReadableStream,
      {
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Length": fileSize.toString(),
          "Accept-Ranges": "bytes",
          "Content-Disposition": `attachment; filename="${filename}"`,
          ...validators,
        },
      },
    );
  } catch (err) {
    console.error("Failed to serve tutorial long audio", err);
    return NextResponse.json(
      { error: "Failed to read long audio file" },
      { status: 500 },
    );
  }
}
