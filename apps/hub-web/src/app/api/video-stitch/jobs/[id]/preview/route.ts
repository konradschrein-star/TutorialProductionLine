import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { videoStitchJobs } from "@repo/db";
import { eq } from "drizzle-orm";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "node:stream";

export const dynamic = "force-dynamic";

/**
 * GET /api/video-stitch/jobs/[id]/preview
 *
 * Stream the rendered output (output_video_path) as video/mp4 with Range
 * support, so the stitcher job list can play it inline for visual verification
 * without forcing a download.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Allow tutorial VAs too — the isOwner check below scopes access to the
  // caller's own jobs.
  const session = await getSession();
  if (
    !session ||
    (!hasPermission(session, "view:jobs") &&
      !hasPermission(session, "create:tutorial-job"))
  ) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const [job] = await db
    .select()
    .from(videoStitchJobs)
    .where(eq(videoStitchJobs.id, id));

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const isOwner = job.created_by_user_id === session.userId;
  const isPrivileged =
    hasPermission(session, "manage:tutorial-settings") ||
    session.role === "ADMIN" ||
    session.role === "MANAGER";
  if (!isOwner && !isPrivileged) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  if (!job.output_video_path) {
    return NextResponse.json(
      { error: "No rendered output yet" },
      { status: 404 },
    );
  }

  try {
    const fileStats = await stat(job.output_video_path);
    const fileSize = fileStats.size;
    const rangeHeader = request.headers.get("range");

    if (rangeHeader) {
      // Stream the requested range off disk. The old open()+allocUnsafe(chunkSize)
      // allocated the whole file when the browser opened with `Range: bytes=0-`
      // (chunkSize === fileSize), OOM-ing hub-web on large stitched renders.
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

      const nodeStream = createReadStream(job.output_video_path, {
        start,
        end,
      });
      return new NextResponse(
        Readable.toWeb(nodeStream) as unknown as ReadableStream,
        {
          status: 206,
          headers: {
            "Content-Type": "video/mp4",
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": (end - start + 1).toString(),
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const nodeStream = createReadStream(job.output_video_path);
    return new NextResponse(
      Readable.toWeb(nodeStream) as unknown as ReadableStream,
      {
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": fileSize.toString(),
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (err) {
    console.error("Failed to serve stitch preview", err);
    return NextResponse.json(
      { error: "Failed to read output video" },
      { status: 500 },
    );
  }
}
