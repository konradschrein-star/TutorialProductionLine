/**
 * GET /api/business-hub/studio/narration/audio/<file>
 *
 * Streams one sample narration clip so the Studio's `<audio>` element can play
 * it while the head pumps. Range requests are supported because the scrubber
 * seeks, and a browser that cannot seek turns a scrubber into a play button.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import { guardStudio, studioErrorResponse } from "../../../_lib/guard";
import { resolveSampleNarration } from "../../../_lib/presenter-store";

export const dynamic = "force-dynamic";

const AUDIO_MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
};

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ file: string }> },
): Promise<NextResponse> {
  const denied = await guardStudio("read");
  if (denied) return denied;

  try {
    const { file } = await context.params;
    const absPath = await resolveSampleNarration(decodeURIComponent(file));
    const stats = await stat(absPath);
    const contentType =
      AUDIO_MIME[path.extname(absPath).toLowerCase()] ??
      "application/octet-stream";

    const range = req.headers.get("range");
    if (!range) {
      const stream = createReadStream(absPath);
      return new NextResponse(stream as unknown as ReadableStream, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(stats.size),
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=300",
        },
      });
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${stats.size}` },
      });
    }
    const start = match[1] === "" ? 0 : Number(match[1]);
    const end = match[2] === "" ? stats.size - 1 : Number(match[2]);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end >= stats.size ||
      start > end
    ) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${stats.size}` },
      });
    }

    const stream = createReadStream(absPath, { start, end });
    return new NextResponse(stream as unknown as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${stats.size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    return studioErrorResponse(error, "Streaming sample narration failed");
  }
}
