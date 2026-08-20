import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { resolvePrincipal, ApiAuthError } from "@/app/api/_lib/auth";
import { db } from "@/lib/db";
import { getTutorialJobById } from "@repo/db";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "node:stream";

export const dynamic = "force-dynamic";

/**
 * GET /api/production/jobs/[id]/download
 * Stream the completed final.mp4 as video/mp4.
 *
 * `?inline=1` serves it for playback instead of download: Content-Disposition
 * becomes `inline` and HTTP Range is honoured. Range is not a nicety here — a
 * <video> element issues `Range: bytes=0-` on load and further ranges to seek,
 * and a server that answers 200-with-the-whole-file gives a player that cannot
 * scrub and, on Safari, will not start at all. The Review tab plays videos
 * through this route, so the two behaviours live together rather than in a
 * second copy of the auth block below.
 *
 * Auth: a browser user (hub session + view:production, owner-or-privileged), OR
 * a machine principal via Authorization: Bearer ${CF_API_TOKEN}. The machine
 * path exists so the Keyword Tool uploader can fetch the deliverable
 * server-to-server (Video ERP binding) without a hub session.
 */

/** Parse a single-range `bytes=start-end` header. Multi-range is not supported
 *  (no player asks for it) and anything unparseable falls back to a full body. */
function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  let start: number;
  let end: number;
  if (rawStart === "") {
    // Suffix range: the last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let machine = false;
  const authHeader = req.headers.get("authorization");
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    try {
      machine = (await resolvePrincipal(req)).kind === "machine";
    } catch (err) {
      const status = err instanceof ApiAuthError ? err.status : 500;
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Auth failure" },
        { status },
      );
    }
  }

  const session = machine ? null : await getSession();
  if (!machine) {
    if (!session || !hasPermission(session, "view:production")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const job = await getTutorialJobById(db, id);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!machine && session) {
    const isOwner = job.created_by === session.userId;
    const isPrivileged =
      hasPermission(session, "manage:tutorial-settings") ||
      session.role === "ADMIN" ||
      session.role === "MANAGER";

    if (!isOwner && !isPrivileged) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  if (job.status !== "COMPLETED") {
    return NextResponse.json(
      { error: "Video not ready for download" },
      { status: 400 },
    );
  }

  if (!job.final_path) {
    return NextResponse.json(
      { error: "Video file path not available" },
      { status: 500 },
    );
  }

  try {
    // Stream final.mp4 off disk rather than buffering it into memory. This
    // route is also pulled server-to-server by the Video ERP uploader for large
    // deliverables; readFile() would OOM hub-web on big renders.
    const fileStats = await stat(job.final_path);
    const filename = `${job.title.replace(/[^a-z0-9]/gi, "_")}_final.mp4`;
    const inline = req.nextUrl.searchParams.get("inline") === "1";
    const disposition = `${inline ? "inline" : "attachment"}; filename="${filename}"`;

    const range = inline
      ? parseRange(req.headers.get("range"), fileStats.size)
      : null;

    if (range) {
      const nodeStream = createReadStream(job.final_path, {
        start: range.start,
        end: range.end,
      });
      return new NextResponse(
        Readable.toWeb(nodeStream) as unknown as ReadableStream,
        {
          status: 206,
          headers: {
            "Content-Type": "video/mp4",
            "Content-Length": String(range.end - range.start + 1),
            "Content-Range": `bytes ${range.start}-${range.end}/${fileStats.size}`,
            "Accept-Ranges": "bytes",
            "Content-Disposition": disposition,
            "Cache-Control": "private, max-age=3600",
          },
        },
      );
    }

    const nodeStream = createReadStream(job.final_path);

    return new NextResponse(
      Readable.toWeb(nodeStream) as unknown as ReadableStream,
      {
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": fileStats.size.toString(),
          "Accept-Ranges": "bytes",
          "Content-Disposition": disposition,
          ...(inline ? { "Cache-Control": "private, max-age=3600" } : {}),
        },
      },
    );
  } catch (err) {
    console.error("Failed to download tutorial video", err);
    return NextResponse.json(
      { error: "Failed to read video file" },
      { status: 500 },
    );
  }
}
