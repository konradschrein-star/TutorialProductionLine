export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { listThumbnailsForSubject } from "@/lib/repositories/thumbnail-studio-repository";
import { db, tutorialJobs } from "@/lib/db";
import { eq } from "drizzle-orm";
import { normalizeTutorialLanguage } from "@repo/contracts";

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
  if (subjectKind !== "tutorial_job") return NextResponse.json(rows);

  const [job] = await db
    .select({
      language: tutorialJobs.language,
      channelId: tutorialJobs.channel_id,
    })
    .from(tutorialJobs)
    .where(eq(tutorialJobs.id, subjectId))
    .limit(1);
  if (!job) {
    return NextResponse.json(
      { error: "Tutorial job not found" },
      { status: 404 },
    );
  }
  const language = normalizeTutorialLanguage(job.language);
  if (!language || !job.channelId) {
    return NextResponse.json(
      {
        error: "Tutorial thumbnail owner is incomplete",
        reasons: [
          ...(!language ? ["tutorial language is missing"] : []),
          ...(!job.channelId ? ["tutorial channel is missing"] : []),
        ],
      },
      { status: 409 },
    );
  }
  return NextResponse.json(
    rows.filter(
      (row) =>
        normalizeTutorialLanguage(row.language) === language &&
        row.channel_id === job.channelId,
    ),
  );
}
