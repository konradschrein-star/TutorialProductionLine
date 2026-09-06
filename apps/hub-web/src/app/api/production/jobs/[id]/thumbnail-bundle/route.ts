export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, or } from "drizzle-orm";
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (
    !session ||
    (!hasPermission(session, "manage:thumbnails") &&
      !hasPermission(session, "view:production"))
  ) {
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
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  const rootId = requested.sourceJobId ?? requested.id;
  const rows = await db
    .select({
      jobId: tutorialJobs.id,
      sourceJobId: tutorialJobs.source_job_id,
      language: tutorialJobs.language,
      channelId: tutorialJobs.channel_id,
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
  const root = rows.find((row) => row.jobId === rootId);
  if (
    !root ||
    root.sourceJobId !== null ||
    normalizeTutorialLanguage(root.language) !== "en"
  ) {
    return NextResponse.json(
      { error: "Explicit English source video not found" },
      { status: 409 },
    );
  }

  const activeRows = rows.flatMap((row) => {
    const language = normalizeTutorialLanguage(row.language);
    return language &&
      THUMBNAIL_PACK_LANGUAGES.some((candidate) => candidate === language)
      ? [{ ...row, language }]
      : [];
  });
  const subjectIds = activeRows.map((row) => row.jobId);
  const thumbnailRows = subjectIds.length
    ? await db
        .select({
          id: thumbnails.id,
          subjectId: thumbnails.subject_id,
          language: thumbnails.language,
          channelId: thumbnails.channel_id,
          status: thumbnails.status,
          isSelected: thumbnails.is_selected,
          outputPath: thumbnails.output_path,
          verdict: thumbnails.review_verdict,
        })
        .from(thumbnails)
        .where(
          and(
            eq(thumbnails.subject_kind, "tutorial_job"),
            inArray(thumbnails.subject_id, subjectIds),
          ),
        )
        .orderBy(desc(thumbnails.created_at))
    : [];

  const selections = new Map(
    activeRows.map((row) => {
      const candidates = thumbnailRows.filter(
        (thumbnail) => thumbnail.subjectId === row.jobId,
      );
      return [
        row.jobId,
        assessTutorialThumbnailSelection(row, candidates),
      ] as const;
    }),
  );
  const jobs: ThumbnailPackJob[] = activeRows.map((row) => ({
    ...row,
    thumbnailId: selections.get(row.jobId)?.thumbnail?.id ?? null,
  }));
  const pack = assessThumbnailPack(jobs);

  return NextResponse.json({
    rootId,
    requestedId: id,
    ready: pack.ready,
    expected: pack.expected,
    readyCount: pack.readyCount,
    variants: pack.variants.map((variant) => {
      const row = activeRows.find(
        (candidate) => candidate.jobId === variant.jobId,
      );
      const selection = row ? selections.get(row.jobId) : undefined;
      const selectedRow = selection?.thumbnail
        ? thumbnailRows.find(
            (thumbnail) => thumbnail.id === selection.thumbnail!.id,
          )
        : undefined;
      return {
        id: variant.jobId,
        sourceJobId: row?.sourceJobId ?? null,
        language: variant.language,
        title: variant.title,
        status: variant.status,
        thumbnailTextTop: variant.thumbnailTextTop,
        thumbnailTextBottom: variant.thumbnailTextBottom,
        videoUrl:
          variant.jobId && variant.finalPath
            ? `/api/production/jobs/${variant.jobId}/download?inline=1`
            : null,
        thumbnailId: selection?.thumbnail?.id ?? null,
        thumbnailReady: selection?.ready ?? false,
        thumbnailReasons: selection?.reasons ?? [
          "language variant job missing",
        ],
        approved:
          selectedRow?.verdict === "acceptable" ||
          selectedRow?.verdict === "strong",
        ready: variant.ready,
        reasons: variant.reasons,
      };
    }),
  });
}
