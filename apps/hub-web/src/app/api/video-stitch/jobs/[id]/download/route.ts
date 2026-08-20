import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { videoStitchJobs } from "@repo/db";
import { eq, and } from "drizzle-orm";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "node:stream";

export const dynamic = "force-dynamic";

/**
 * GET /api/video-stitch/jobs/[id]/download
 * Download a completed video
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Allow tutorial VAs too — the query below already scopes to the caller's
  // own jobs, so a VA can only download their own long-form stitch result.
  const session = await getSession();
  if (
    !session ||
    (!hasPermission(session, "view:jobs") &&
      !hasPermission(session, "create:tutorial-job"))
  ) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const [job] = await db
      .select()
      .from(videoStitchJobs)
      .where(
        and(
          eq(videoStitchJobs.id, id),
          eq(videoStitchJobs.created_by_user_id, session.userId),
        ),
      );

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.status !== "RENDERED") {
      return NextResponse.json(
        { error: "Video not ready for download" },
        { status: 400 },
      );
    }

    if (!job.output_video_path) {
      return NextResponse.json(
        { error: "Video file path not available" },
        { status: 500 },
      );
    }

    // Stream the render off disk instead of buffering the whole MP4 into memory
    // (long-form stitches are hundreds of MB to GBs — readFile() OOMs the node
    // process). Sanitize the filename to prevent Content-Disposition injection.
    const fileStats = await stat(job.output_video_path);
    const safeFilename = (job.output_filename || "video.mp4").replace(
      /["\r\n\\]/g,
      "_",
    );
    const nodeStream = createReadStream(job.output_video_path);

    return new NextResponse(
      Readable.toWeb(nodeStream) as unknown as ReadableStream,
      {
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": fileStats.size.toString(),
          "Content-Disposition": `attachment; filename="${safeFilename}"`,
        },
      },
    );
  } catch (err) {
    console.error("Failed to download video", err);
    return NextResponse.json(
      { error: "Failed to download video" },
      { status: 500 },
    );
  }
}
