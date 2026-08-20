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
 * True when the client's If-None-Match names the ETag we are about to serve.
 * Accepts the comma-separated list and the weak `W/` prefix browsers may send.
 */
function isFresh(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const strip = (t: string) => t.trim().replace(/^W\//, "");
  return ifNoneMatch.split(",").some((t) => strip(t) === strip(etag));
}

/**
 * GET /api/production/jobs/[id]/audio
 * Stream the generated TTS audio (audio_path) as audio/mpeg.
 * Used by the Studio player to play the voiceover during recording.
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

  if (!job.audio_path) {
    return NextResponse.json(
      { error: "Audio not yet generated" },
      { status: 404 },
    );
  }

  let fileStats;
  try {
    fileStats = await stat(job.audio_path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // The DB still carries an audio_path but the file is gone (the old
      // cleanup watchdog deleted tts.mp3 from ~2,100 finished jobs before it
      // was taught to leave narration alone). This is a missing resource, not
      // a server fault — answering 500 left the Studio player stuck at 0:00.
      console.warn(
        `Tutorial audio missing on disk for job ${id}: ${job.audio_path}`,
      );
      return NextResponse.json(
        { error: "Audio is no longer available for this job" },
        { status: 404 },
      );
    }
    console.error("Failed to stat tutorial audio", err);
    return NextResponse.json(
      { error: "Failed to read audio file" },
      { status: 500 },
    );
  }

  try {
    const fileSize = fileStats.size;
    const rangeHeader = _req.headers.get("range");

    // The narration for a job is immutable until it is explicitly regenerated,
    // so let the browser keep its copy and revalidate instead of re-downloading.
    // VAs replay the same track dozens of times while recording; `no-store` was
    // costing them a full 3-4 MB transfer per play over a long, congested link.
    // `no-cache` still forces a revalidation on every play, so a regenerated
    // audio file is picked up immediately — it just costs a 304 instead of 4 MB.
    const etag = `"${fileSize}-${Math.floor(fileStats.mtimeMs)}"`;
    const lastModified = fileStats.mtime.toUTCString();
    const validators = {
      ETag: etag,
      "Last-Modified": lastModified,
      "Cache-Control": "private, no-cache",
    };

    if (isFresh(_req.headers.get("if-none-match"), etag)) {
      return new NextResponse(null, { status: 304, headers: validators });
    }

    if (rangeHeader) {
      // Stream the requested byte range straight off disk. We serve the FULL
      // requested range (not an artificial small cap) via a Node read stream,
      // so the first byte reaches the browser immediately (no whole-file buffer
      // = no "stuck at 0") and playback streams continuously (no per-chunk
      // round-trips starving the buffer = no "random pauses").
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

      const nodeStream = createReadStream(job.audio_path, { start, end });
      return new NextResponse(
        Readable.toWeb(nodeStream) as unknown as ReadableStream,
        {
          status: 206,
          headers: {
            "Content-Type": "audio/mpeg",
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": (end - start + 1).toString(),
            ...validators,
          },
        },
      );
    }

    // No Range header — stream the whole file.
    const nodeStream = createReadStream(job.audio_path);
    return new NextResponse(
      Readable.toWeb(nodeStream) as unknown as ReadableStream,
      {
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Length": fileSize.toString(),
          "Accept-Ranges": "bytes",
          ...validators,
        },
      },
    );
  } catch (err) {
    console.error("Failed to serve tutorial audio", err);
    return NextResponse.json(
      { error: "Failed to read audio file" },
      { status: 500 },
    );
  }
}
