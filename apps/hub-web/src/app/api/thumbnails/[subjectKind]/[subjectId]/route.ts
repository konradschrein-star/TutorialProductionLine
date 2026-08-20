export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { listThumbnailsForSubject } from "@/lib/repositories/thumbnail-studio-repository";

/**
 * GET /api/thumbnails/[subjectKind]/[subjectId]
 *
 * Lists generated thumbnails for a subject, newest first. Used by the
 * Prompt Lab (subjectKind "test") to poll for generation completion, and by
 * job thumbnail panels for content/tutorial jobs.
 */

const SUBJECT_KINDS = [
  "content_job",
  "tutorial_job",
  "studio",
  "test",
] as const;
type SubjectKind = (typeof SUBJECT_KINDS)[number];

function isSubjectKind(value: string): value is SubjectKind {
  return (SUBJECT_KINDS as readonly string[]).includes(value);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ subjectKind: string; subjectId: string }> },
) {
  const session = await getSession();
  if (
    !session ||
    (!hasPermission(session, "view:settings") &&
      !hasPermission(session, "manage:thumbnails"))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { subjectKind, subjectId } = await params;
  if (!isSubjectKind(subjectKind)) {
    return NextResponse.json({ error: "Invalid subjectKind" }, { status: 400 });
  }

  const rows = await listThumbnailsForSubject(subjectKind, subjectId);
  return NextResponse.json(rows);
}
