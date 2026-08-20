import { NextResponse, type NextRequest } from "next/server";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname } from "node:path";
import { db } from "@/lib/db";
import { subtitleFonts } from "@repo/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/subtitle-fonts/[id]/file?weight=700
 *
 * Streams the actual font binary for a `subtitle_fonts` row so the browser can
 * register an @font-face for it (font cards on /subtitles/fonts, and the
 * caption previews on /subtitles + /subtitles/[id], which must render in the
 * preset's real typeface).
 *
 * Why this exists instead of reusing /api/media/fonts/<file_name>:
 *  - it resolves the path from the DB row (`weights[].file_path` / `file_path`),
 *    so it works for ANY font row regardless of whether the file happens to sit
 *    under LOCAL_MEDIA_ROOT;
 *  - /api/media/[...key] compares `targetAbs.startsWith(rootAbs + "/")`, which
 *    is always false on Windows (`resolve()` yields backslashes) and 403s every
 *    request in local dev.
 *
 * The served path is NOT user-controlled — it comes from a DB row written by
 * the upload handler / provisioning script — so there is no traversal surface.
 */
const MIME: Record<string, string> = {
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session?.userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const [font] = await db
    .select()
    .from(subtitleFonts)
    .where(eq(subtitleFonts.id, id))
    .limit(1);

  if (!font) {
    return NextResponse.json({ error: "font not found" }, { status: 404 });
  }

  // Pick the requested weight's file, falling back to the row's primary file.
  const weightParam = req.nextUrl.searchParams.get("weight");
  const weights = Array.isArray(font.weights) ? font.weights : [];
  let filePath = font.file_path;
  if (weightParam) {
    const wanted = Number(weightParam);
    const match = weights.find((w) => w.weight === wanted);
    // No silent substitution: an explicitly requested weight that this family
    // does not have is an error, not "here is a different weight".
    if (!match) {
      return NextResponse.json(
        {
          error: `font "${font.name}" has no weight ${weightParam}`,
          available: weights.map((w) => w.weight),
        },
        { status: 404 },
      );
    }
    filePath = match.file_path;
  }

  if (!existsSync(filePath)) {
    return NextResponse.json(
      { error: `font file missing on disk: ${filePath}` },
      { status: 404 },
    );
  }
  const stats = statSync(filePath);
  if (!stats.isFile()) {
    return NextResponse.json({ error: "not a file" }, { status: 404 });
  }

  const contentType =
    MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  const stream = createReadStream(filePath);

  return new NextResponse(stream as unknown as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stats.size),
      "Cache-Control": "private, max-age=86400",
    },
  });
}
