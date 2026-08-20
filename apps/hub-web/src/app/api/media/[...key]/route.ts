import { type NextRequest, NextResponse } from "next/server";
import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve, extname, join } from "node:path";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".json": "application/json",
  ".vtt": "text/vtt",
  ".srt": "application/x-subrip",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * GET /api/media/[...key]
 *
 * Streams any file under LOCAL_MEDIA_ROOT by storage key. Supports HTTP Range
 * for video seeking. Auth-gated to logged-in sessions because keys are not
 * meant to be public. Path traversal is blocked by resolving + comparing to
 * the absolute media root.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ key: string[] }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session?.userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { key } = await context.params;
  if (!Array.isArray(key) || key.length === 0) {
    return NextResponse.json({ error: "missing key" }, { status: 400 });
  }

  const mediaRoot = process.env["LOCAL_MEDIA_ROOT"];
  if (!mediaRoot) {
    return NextResponse.json(
      { error: "LOCAL_MEDIA_ROOT not configured" },
      { status: 500 },
    );
  }

  const rootAbs = resolve(mediaRoot);
  const targetAbs = resolve(join(rootAbs, ...key));
  if (!targetAbs.startsWith(rootAbs + "/") && targetAbs !== rootAbs) {
    return NextResponse.json(
      { error: "path traversal blocked" },
      { status: 403 },
    );
  }
  if (!existsSync(targetAbs)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const stats = statSync(targetAbs);
  if (!stats.isFile()) {
    return NextResponse.json({ error: "not a file" }, { status: 404 });
  }

  const contentType =
    MIME[extname(targetAbs).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.get("range");

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${stats.size}` },
      });
    }
    const start = m[1] === "" ? 0 : Number(m[1]);
    const end = m[2] === "" ? stats.size - 1 : Number(m[2]);
    if (
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      start < 0 ||
      end >= stats.size ||
      start > end
    ) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${stats.size}` },
      });
    }
    const stream = createReadStream(targetAbs, { start, end });
    return new NextResponse(stream as unknown as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${stats.size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  const stream = createReadStream(targetAbs);
  return new NextResponse(stream as unknown as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stats.size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
