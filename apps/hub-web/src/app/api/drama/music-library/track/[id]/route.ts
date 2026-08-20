import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, musicLibrary } from "@/lib/db";
import { verifyToken } from "@/lib/auth/jwt";

export const dynamic = "force-dynamic";

const MEDIA_BASE = "/opt/content-forge/media";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = (await cookies()).get("hub_session")?.value;
  if (!token)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await verifyToken(token);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id))
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  const [row] = await db
    .select({ file_path: musicLibrary.file_path })
    .from(musicLibrary)
    .where(eq(musicLibrary.id, id))
    .limit(1);
  if (!row?.file_path)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Defence: stay inside the known media root.
  if (!row.file_path.startsWith(MEDIA_BASE))
    return NextResponse.json({ error: "Bad path" }, { status: 400 });

  let size = 0;
  try {
    const s = await stat(row.file_path);
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
      const nodeStream = createReadStream(row.file_path, { start, end });
      const webStream = Readable.toWeb(nodeStream) as ReadableStream;
      return new NextResponse(webStream, {
        status: 206,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(end - start + 1),
          "Cache-Control": "no-store",
        },
      });
    }
  }
  const nodeStream = createReadStream(row.file_path);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;
  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}
