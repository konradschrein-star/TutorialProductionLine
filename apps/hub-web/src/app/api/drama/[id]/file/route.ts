import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth/jwt";

export const dynamic = "force-dynamic";

// Allow-list of filenames we serve from a drama job's media directory.
// Don't accept arbitrary paths — clients can only ask for files we know
// about by name. Each entry is { filename, mime } where filename is the
// exact basename within /opt/content-forge/media/long-form-drama/<id>/.
const ALLOWED: Record<string, string> = {
  "tts.mp3": "audio/mpeg",
  "tts.json": "application/json",
  "output.mp4": "video/mp4",
  "subtitles.ass": "text/plain",
};

const MEDIA_BASE =
  process.env["DRAMA_MEDIA_DIR"] ?? "/opt/content-forge/media/long-form-drama";

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

  const { id: jobId } = await params;
  const url = new URL(req.url);
  const name = url.searchParams.get("name");

  if (!name || !(name in ALLOWED)) {
    return NextResponse.json({ error: "Unknown file" }, { status: 400 });
  }

  // Basic UUID guard so the id can't be used to traverse the tree.
  if (!/^[0-9a-f-]{36}$/.test(jobId)) {
    return NextResponse.json({ error: "Bad job id" }, { status: 400 });
  }

  const filePath = join(MEDIA_BASE, jobId, name);

  let size = 0;
  try {
    const s = await stat(filePath);
    if (!s.isFile()) throw new Error("not a file");
    size = s.size;
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;
  return new NextResponse(webStream, {
    headers: {
      "Content-Type": ALLOWED[name]!,
      "Content-Length": String(size),
      "Cache-Control": "no-store",
    },
  });
}
