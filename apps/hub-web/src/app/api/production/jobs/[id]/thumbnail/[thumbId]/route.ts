import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getTutorialJobById } from "@repo/db";
import { getThumbnail } from "@/lib/repositories/thumbnail-studio-repository";

export const dynamic = "force-dynamic";

/**
 * GET /api/production/jobs/[id]/thumbnail/[thumbId]
 *
 * Serves a generated thumbnail image file for a tutorial job. Production-scoped
 * (view:production + ownership) so tutorial VAs — who lack the view:settings
 * that /api/thumbnails/image/[id] requires — can still see their thumbnail
 * inside the Studio. The image path is read from the DB (never user input) and
 * the thumbnail is verified to belong to this tutorial job, so this is not a
 * path-traversal or cross-subject leak vector.
 */

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; thumbId: string }> },
) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, thumbId } = await params;

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

  const thumbnail = await getThumbnail(thumbId);
  if (
    !thumbnail ||
    thumbnail.subject_kind !== "tutorial_job" ||
    thumbnail.subject_id !== id ||
    !thumbnail.output_path
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(thumbnail.output_path);
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
