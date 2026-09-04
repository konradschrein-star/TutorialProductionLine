import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, thumbnails, tutorialJobs } from "@/lib/db";
import {
  THUMBNAIL_PACK_LANGUAGES,
  assessThumbnailPack,
  type ThumbnailPackJob,
} from "@/lib/tutorial/thumbnail-pack";

export const dynamic = "force-dynamic";

/**
 * The job-bound input for the offline layout compositor. It deliberately
 * returns only translated children from the configured five-language fan-out;
 * it never substitutes English metadata for a missing localized field.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:thumbnails")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const [source] = await db
    .select({
      id: tutorialJobs.id,
      createdBy: tutorialJobs.created_by,
      sourceJobId: tutorialJobs.source_job_id,
      title: tutorialJobs.title,
    })
    .from(tutorialJobs)
    .where(eq(tutorialJobs.id, id))
    .limit(1);

  if (!source || source.sourceJobId !== null) {
    return NextResponse.json(
      { error: "Original tutorial job not found" },
      { status: 404 },
    );
  }

  const privileged =
    session.role === "ADMIN" ||
    session.role === "MANAGER" ||
    hasPermission(session, "manage:tutorial-settings");
  if (source.createdBy !== session.userId && !privileged) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const children = await db
    .select({
      jobId: tutorialJobs.id,
      language: tutorialJobs.language,
      title: tutorialJobs.title,
      description: tutorialJobs.description,
      tags: tutorialJobs.tags,
      thumbnailTextTop: tutorialJobs.thumbnail_text_top,
      thumbnailTextBottom: tutorialJobs.thumbnail_text_bottom,
      status: tutorialJobs.status,
      finalPath: tutorialJobs.final_path,
    })
    .from(tutorialJobs)
    .where(
      and(
        eq(tutorialJobs.source_job_id, source.id),
        inArray(tutorialJobs.language, [...THUMBNAIL_PACK_LANGUAGES]),
      ),
    );

  const childIds = children.map((child) => child.jobId);
  const selected = childIds.length
    ? await db
        .select({
          jobId: thumbnails.subject_id,
          thumbnailId: thumbnails.id,
        })
        .from(thumbnails)
        .where(
          and(
            eq(thumbnails.subject_kind, "tutorial_job"),
            inArray(thumbnails.subject_id, childIds),
            eq(thumbnails.is_selected, true),
            eq(thumbnails.status, "completed"),
          ),
        )
        .orderBy(desc(thumbnails.created_at))
    : [];
  const selectedByJob = new Map(
    selected.map((row) => [row.jobId, row.thumbnailId]),
  );

  const jobs: ThumbnailPackJob[] = children.flatMap((child) =>
    child.language
      ? [
          {
            ...child,
            language: child.language,
            thumbnailId: selectedByJob.get(child.jobId) ?? null,
          },
        ]
      : [],
  );

  return NextResponse.json({
    source: { id: source.id, title: source.title },
    ...assessThumbnailPack(jobs),
  });
}
