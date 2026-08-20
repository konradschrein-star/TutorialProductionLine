export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { videoStitchJobs } from "@repo/db";
import { eq, and } from "drizzle-orm";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { Readable } from "node:stream";
import path from "node:path";

/**
 * GET /api/download?jobId={uuid}
 *
 * Securely downloads a completed video stitch job.
 * Verifies user ownership before allowing download.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session, "view:jobs")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const jobId = request.nextUrl.searchParams.get("jobId");
  const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!jobId || !UUID_REGEX.test(jobId)) {
    return NextResponse.json({ error: "Invalid job ID" }, { status: 400 });
  }

  // Get job and verify ownership
  const [job] = await db
    .select()
    .from(videoStitchJobs)
    .where(
      and(
        eq(videoStitchJobs.id, jobId),
        eq(videoStitchJobs.created_by_user_id, session.userId),
      ),
    )
    .limit(1);

  if (!job || !job.output_video_path) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // Verify path is within media root (defense-in-depth)
  const mediaRoot = process.env.LOCAL_MEDIA_ROOT!;
  const resolvedPath = path.resolve(job.output_video_path);
  if (!resolvedPath.startsWith(path.resolve(mediaRoot))) {
    return NextResponse.json({ error: "Invalid file path" }, { status: 403 });
  }

  try {
    const fileStats = await stat(job.output_video_path);
    const stream = createReadStream(job.output_video_path);

    // Sanitize filename to prevent header injection
    const safeFilename = (job.output_filename || "video.mp4").replace(
      /["\r\n\\]/g,
      "_",
    ); // Remove quotes, newlines, backslashes

    // Convert Node.js stream to Web ReadableStream
    const webStream = Readable.toWeb(stream) as ReadableStream;

    return new NextResponse(webStream, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": fileStats.size.toString(),
        "Content-Disposition": `attachment; filename="${safeFilename}"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
