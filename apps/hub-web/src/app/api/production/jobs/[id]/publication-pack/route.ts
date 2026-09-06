import { NextResponse } from "next/server";
import { and, eq, inArray, or } from "drizzle-orm";
import { normalizeTutorialLanguage } from "@repo/contracts";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, thumbnails, tutorialJobs } from "@/lib/db";
import {
  THUMBNAIL_PACK_LANGUAGES,
  assessThumbnailPack,
  type ThumbnailPackJob,
} from "@/lib/tutorial/thumbnail-pack";
import { assessTutorialThumbnailSelection } from "@/lib/tutorial/thumbnail-selection";

export const dynamic = "force-dynamic";

/** Publication readiness for the five real active-language tutorial variants. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:thumbnails")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const [requested] = await db
    .select({
      id: tutorialJobs.id,
      sourceJobId: tutorialJobs.source_job_id,
    })
    .from(tutorialJobs)
    .where(eq(tutorialJobs.id, id))
    .limit(1);
  if (!requested) {
    return NextResponse.json(
      { error: "Tutorial job not found" },
      { status: 404 },
    );
  }
  const rootId = requested.sourceJobId ?? requested.id;
  const rows = await db
    .select({
      jobId: tutorialJobs.id,
      createdBy: tutorialJobs.created_by,
      sourceJobId: tutorialJobs.source_job_id,
      channelId: tutorialJobs.channel_id,
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
      or(eq(tutorialJobs.id, rootId), eq(tutorialJobs.source_job_id, rootId)),
    );
  const source = rows.find((row) => row.jobId === rootId);
  if (
    !source ||
    source.sourceJobId !== null ||
    normalizeTutorialLanguage(source.language) !== "en"
  ) {
    return NextResponse.json(
      { error: "Explicit English original tutorial not found" },
      { status: 409 },
    );
  }

  const privileged =
    session.role === "ADMIN" ||
    session.role === "MANAGER" ||
    hasPermission(session, "manage:tutorial-settings");
  if (source.createdBy !== session.userId && !privileged) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const activeRows = rows.flatMap((row) => {
    const language = normalizeTutorialLanguage(row.language);
    return language &&
      THUMBNAIL_PACK_LANGUAGES.some((candidate) => candidate === language)
      ? [{ ...row, language }]
      : [];
  });
  const jobIds = activeRows.map((row) => row.jobId);
  const thumbnailRows = jobIds.length
    ? await db
        .select({
          id: thumbnails.id,
          subjectId: thumbnails.subject_id,
          language: thumbnails.language,
          channelId: thumbnails.channel_id,
          status: thumbnails.status,
          isSelected: thumbnails.is_selected,
          outputPath: thumbnails.output_path,
        })
        .from(thumbnails)
        .where(
          and(
            eq(thumbnails.subject_kind, "tutorial_job"),
            inArray(thumbnails.subject_id, jobIds),
          ),
        )
    : [];

  const selections = new Map(
    activeRows.map((row) => [
      row.jobId,
      assessTutorialThumbnailSelection(
        row,
        thumbnailRows.filter((thumbnail) => thumbnail.subjectId === row.jobId),
      ),
    ]),
  );
  const jobs: ThumbnailPackJob[] = activeRows.map((row) => ({
    ...row,
    thumbnailId: selections.get(row.jobId)?.thumbnail?.id ?? null,
  }));
  const pack = assessThumbnailPack(jobs);
  const variants = pack.variants.map((variant) => {
    const selection = variant.jobId ? selections.get(variant.jobId) : undefined;
    const thumbnailReasons = selection?.reasons ?? [
      "language variant job missing",
    ];
    return {
      ...variant,
      thumbnailReady: selection?.ready ?? false,
      thumbnailReasons,
      ready: variant.ready && Boolean(selection?.ready),
      reasons: [...variant.reasons, ...thumbnailReasons],
    };
  });
  return NextResponse.json({
    source: { id: source.jobId, title: source.title },
    expected: pack.expected,
    readyCount: variants.filter((variant) => variant.ready).length,
    ready: variants.every((variant) => variant.ready),
    variants,
  });
}
