import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, tutorialJobs } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/production/jobs/[id]/download
 *
 * Direct download endpoint for manual uploaders to download the finished tutorial MP4.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Job ID required" }, { status: 400 });
  }

  try {
    const job = await db.query.tutorialJobs.findFirst({
      where: eq(tutorialJobs.id, id),
    });

    if (!job) {
      return NextResponse.json({ error: "Tutorial job not found" }, { status: 404 });
    }

    const filePath = job.final_path || job.recording_path;
    if (!filePath || !existsSync(filePath)) {
      return NextResponse.json(
        { error: "Video file not found on disk" },
        { status: 404 },
      );
    }

    const stat = statSync(filePath);
    const sanitizedTitle = (job.title || "tutorial")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 80);
    const filename = `${sanitizedTitle}_${job.language || "EN"}.mp4`;

    const stream = createReadStream(filePath);
    const webStream = Readable.toWeb(stream);

    return new NextResponse(webStream as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error(`Failed to stream download for job ${id}:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Download failed" },
      { status: 500 },
    );
  }
}
