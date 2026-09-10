export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { getThumbnail } from "@/lib/repositories/thumbnail-studio-repository";
import { db, tutorialJobs } from "@/lib/db";
import { eq } from "drizzle-orm";
import { mayAccessDelivery } from "@/lib/tutorial/delivery-access";
import { withTutorialAsset } from "@/lib/tutorial/media-access";

/**
 * GET /api/thumbnails/image/[id]
 *
 * Serves the rendered image file for a generated thumbnail row. The file
 * path is read from the DB (`output_path`), never from user input, so this
 * is not exposed to path traversal.
 */

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  // `manage:thumbnails` (UPLOADER_VA) can view a rendered thumbnail — it is
  // the picture they are being asked to approve or replace.
  if (
    !session ||
    (!hasPermission(session, "view:settings") &&
      !hasPermission(session, "manage:thumbnails"))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const thumbnail = await getThumbnail(id);
  if (!thumbnail || !thumbnail.output_path) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (thumbnail.subject_kind === "tutorial_job") {
    const [job] = await db.select({ created_by: tutorialJobs.created_by, channel_id: tutorialJobs.channel_id })
      .from(tutorialJobs).where(eq(tutorialJobs.id, thumbnail.subject_id)).limit(1);
    if (!job || !await mayAccessDelivery(session, job)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } else if (!hasPermission(session, "view:settings")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let buffer: Buffer;
  try {
    buffer = thumbnail.subject_kind === "tutorial_job"
      ? await withTutorialAsset({ jobId: thumbnail.subject_id, kind: "thumbnail", path: thumbnail.output_path }, (path) => readFile(path))
      : await readFile(thumbnail.output_path);
  } catch {
    return NextResponse.json(
      { error: "File not found on disk" },
      { status: 404 },
    );
  }

  const ext = extname(thumbnail.output_path).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? "image/jpeg";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
