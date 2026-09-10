import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getTutorialJobById } from "@repo/db";
import { openTutorialAssetStream } from "@/lib/tutorial/media-access";

export const dynamic = "force-dynamic";

/**
 * GET /api/production/jobs/[id]/audio
 * Stream the generated TTS audio (audio_path) as audio/mpeg.
 * Used by the Studio player to play the voiceover during recording.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const job = await getTutorialJobById(db, id);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = job.created_by === session.userId;
  const isPrivileged =
    hasPermission(session, "manage:tutorial-settings") ||
    session.role === "ADMIN" ||
    session.role === "MANAGER";

  if (!isOwner && !isPrivileged) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!job.audio_path) {
    return NextResponse.json(
      { error: "Audio not yet generated" },
      { status: 404 },
    );
  }

  try {
    const media = await openTutorialAssetStream({ jobId: id, kind: null, path: job.audio_path }, { range: _req.headers.get("range"), ifNoneMatch: _req.headers.get("if-none-match") });
    return new NextResponse(media.status === 304 ? null : media.stream, {
      status: media.status,
      headers: {
        "Content-Type": "audio/mpeg",
        ...(media.status !== 304 ? { "Content-Length": String(media.contentLength) } : {}),
        "Accept-Ranges": "bytes",
        ...(media.contentRange ? { "Content-Range": media.contentRange } : {}),
        ETag: media.etag,
        "Last-Modified": media.lastModified,
        "Cache-Control": "private, no-cache",
      },
    });
  } catch {
    return NextResponse.json({ error: "Audio is no longer available for this job. Restore the original narration; no archived audio revision exists." }, { status: 404 });
  }
}
