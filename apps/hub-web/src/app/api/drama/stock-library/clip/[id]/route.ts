import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, stockClips } from "@/lib/db";
import { verifyToken } from "@/lib/auth/jwt";

export const dynamic = "force-dynamic";

const STOCK_LIB_DIR =
  process.env["STOCK_LIBRARY_DIR"] ?? "/opt/content-forge/media/stock-library";

/**
 * GET /api/drama/stock-library/clip/[id]
 *
 * Streams the mp4 of a single ready stock_clips row. We look up the
 * row by id, double-check the file lives inside STOCK_LIB_DIR, then
 * stream it. Range requests aren't strictly necessary for ~8s clips
 * but it keeps the <video> element happy on Chrome.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = (await cookies()).get("hub_session")?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await verifyToken(token);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }

  const [row] = await db
    .select({ video_path: stockClips.video_path, status: stockClips.status })
    .from(stockClips)
    .where(eq(stockClips.id, id))
    .limit(1);

  if (!row || row.status !== "ready" || !row.video_path) {
    return NextResponse.json({ error: "Not ready" }, { status: 404 });
  }

  // Defence in depth: path must start with the lib dir.
  if (!row.video_path.startsWith(STOCK_LIB_DIR)) {
    return NextResponse.json(
      { error: "Path outside library" },
      { status: 400 },
    );
  }

  let size = 0;
  try {
    const s = await stat(row.video_path);
    if (!s.isFile()) throw new Error("not a file");
    size = s.size;
  } catch {
    return NextResponse.json({ error: "Missing on disk" }, { status: 404 });
  }

  const range = req.headers.get("range");
  if (range) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : size - 1;
      const chunkSize = end - start + 1;
      const nodeStream = createReadStream(row.video_path, { start, end });
      const webStream = Readable.toWeb(nodeStream) as ReadableStream;
      return new NextResponse(webStream, {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Cache-Control": "no-store",
        },
      });
    }
  }

  const nodeStream = createReadStream(row.video_path);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;
  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}
