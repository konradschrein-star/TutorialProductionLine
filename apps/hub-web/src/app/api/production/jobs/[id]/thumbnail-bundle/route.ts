export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  configuredTutorialThumbnailMode,
  normalizeTutorialLanguage,
  tutorialChannelProfile,
  resolveTutorialChannelTargets,
} from "@repo/contracts";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, thumbnails, tutorialJobs } from "@/lib/db";
import {
  assessThumbnailPack,
  type ThumbnailPackJob,
} from "@/lib/tutorial/thumbnail-pack";
import { assessTutorialThumbnailSelection } from "@/lib/tutorial/thumbnail-selection";
import { readThumbnailLayout } from "@/lib/thumbnails/layout-document";
import {
  channels,
  characterImages,
  thumbnailLibraryAssets,
  tutorialThumbnailDrafts,
  tutorialSettings,
} from "@repo/db";
import { resolveChannelHost } from "@repo/db/repositories";
import { findSoftwareLogo } from "@/lib/thumbnails/software-logo";
import { deriveLogoSubject } from "@repo/domain";

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
      createdBy: tutorialJobs.created_by,
      sourceJobId: tutorialJobs.source_job_id,
    })
    .from(tutorialJobs)
    .where(eq(tutorialJobs.id, id))
    .limit(1);
  if (!requested) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }
  const privileged =
    session.role === "ADMIN" ||
    session.role === "MANAGER" ||
    hasPermission(session, "manage:tutorial-settings");
  if (!privileged && requested.createdBy !== session.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
      errorStage: tutorialJobs.error_stage,
      errorMessage: tutorialJobs.error_message,
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
    return language ? [{ ...row, language }] : [];
  });
  const subjectIds = activeRows.map((row) => row.jobId);
  const savedDrafts = subjectIds.length
    ? await db
        .select()
        .from(tutorialThumbnailDrafts)
        .where(inArray(tutorialThumbnailDrafts.tutorial_job_id, subjectIds))
    : [];
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
          headlineText: thumbnails.headline_text,
          layoutDocument: thumbnails.prompt_used,
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
  const configuredChannels = await db
    .select({
      id: channels.id,
      language: channels.language,
      metadata: channels.metadata,
      isPrimary: channels.is_primary,
      enabled: channels.accepts_tutorials,
    })
    .from(channels);
  const profileTargets = resolveTutorialChannelTargets(
    root.channelId,
    configuredChannels,
  ).targets.map((target) => target.language);
  // The active pack follows the channel-group configuration. Historical locale
  // rows stay in the database and remain directly addressable, but must not
  // silently reactivate a retired 18-language fan-out in every editor view.
  const requestedLanguage = activeRows.find(
    (row) => row.jobId === requested.id,
  )?.language;
  const expectedLanguages = [
    ...new Set(
      [
        "en",
        ...profileTargets,
        ...(requestedLanguage && requestedLanguage !== "en"
          ? [requestedLanguage]
          : []),
      ]
        .map(normalizeTutorialLanguage)
        .filter((language): language is string => Boolean(language)),
    ),
  ];
  const pack = assessThumbnailPack(jobs, "editing", expectedLanguages);
  const hostImages = new Map<string, string[]>();
  for (const channelId of new Set(
    activeRows
      .map((row) => row.channelId)
      .filter((value): value is string => Boolean(value)),
  )) {
    const channel = configuredChannels.find((item) => item.id === channelId);
    const profile = tutorialChannelProfile(channel?.metadata);
    if (profile.avatarId) {
      const images = await db
        .select({ id: characterImages.id })
        .from(characterImages)
        .where(
          and(
            eq(characterImages.character_id, profile.avatarId),
            eq(characterImages.is_active, true),
          ),
        );
      hostImages.set(
        channelId,
        images
          .filter(
            (image) =>
              !profile.referenceImageIds.length ||
              profile.referenceImageIds.includes(image.id),
          )
          .map((image) => `/api/characters/images/${image.id}/file`),
      );
    } else {
      const host = await resolveChannelHost(db, channelId);
      hostImages.set(
        channelId,
        host?.images.map(
          (image) => `/api/characters/images/${image.id}/file`,
        ) ?? [],
      );
    }
  }
  const logos = await db
    .select({
      name: thumbnailLibraryAssets.name,
      fileName: thumbnailLibraryAssets.file_name,
    })
    .from(thumbnailLibraryAssets)
    .where(eq(thumbnailLibraryAssets.category, "LOGOS"))
    .orderBy(desc(thumbnailLibraryAssets.created_at));
  const softwareLogo = findSoftwareLogo(
    root.title ?? "",
    logos.map((logo) => ({
      name: logo.name,
      url: `/api/media/thumbnail-library/${logo.fileName}`,
    })),
  );
  const softwareSubject = deriveLogoSubject(root.title ?? "");
  const [settings] = await db
    .select({ mode: tutorialSettings.thumbnail_generation_mode })
    .from(tutorialSettings)
    .where(eq(tutorialSettings.id, 1));

  return NextResponse.json({
    rootId,
    softwareLogo,
    softwareSubject,
    generationMode: settings?.mode === "ai" ? "ai" : "manual",
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
        thumbnailMode: row?.channelId
          ? configuredTutorialThumbnailMode(
              configuredChannels.find((channel) => channel.id === row.channelId)
                ?.metadata,
            )
          : undefined,
        hostImageUrls: row?.channelId
          ? (hostImages.get(row.channelId) ?? [])
          : [],
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
        hasSelectedImage: Boolean(selectedRow?.outputPath),
        selectedHeadlineLines: selectedRow?.headlineText
          ? selectedRow.headlineText
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean)
              .slice(0, 4)
          : [],
        layout: readThumbnailLayout(selectedRow?.layoutDocument),
        draftLayout: (() => {
          const draft = savedDrafts.find(
            (item) => item.tutorial_job_id === variant.jobId,
          );
          return draft &&
            draft.base_thumbnail_id === (selection?.thumbnail?.id ?? null)
            ? readThumbnailLayout(JSON.stringify(draft.layout))
            : null;
        })(),
        draftRevision:
          savedDrafts.find((item) => item.tutorial_job_id === variant.jobId)
            ?.revision ?? 0,
        thumbnailReady: selection?.ready ?? false,
        thumbnailReasons: selection?.reasons ?? [
          "language variant job missing",
        ],
        approved:
          selectedRow?.verdict === "acceptable" ||
          selectedRow?.verdict === "strong",
        ready: variant.ready,
        reasons: variant.reasons,
        copyError:
          row?.errorStage === "thumbnail_copy" ? row.errorMessage : null,
      };
    }),
  });
}
