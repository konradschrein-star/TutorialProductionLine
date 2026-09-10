import { NextResponse } from "next/server";
import { z } from "zod";
import { currentReviewQaDetail, reviewQaEvidence } from "@/lib/tutorial/review-qa";
import { and, desc, eq, gte, isNotNull, isNull, inArray, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  db,
  tutorialJobs,
  channels,
  thumbnails,
  storageArtifacts,
} from "@/lib/db";
import { normalizeTutorialLanguage } from "@repo/contracts";
import { assessTutorialThumbnailSelection } from "@/lib/tutorial/thumbnail-selection";
import { reviewMediaAvailability } from "@/lib/tutorial/media-availability";
import { getHubConfig } from "@/lib/config";
import { loadStorageConfigFromDatabase } from "@repo/storage";

export const dynamic = "force-dynamic";

/** Final review is an explicit approval step. Rework preserves all existing assets. */

/** Default window. "Today" for a VA who works past midnight is still today. */
const DEFAULT_LOOKBACK_HOURS = 0;

export async function GET(request: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const requestedId = url.searchParams.get("jobId");
  if (requestedId !== null && !z.string().uuid().safeParse(requestedId).success) return NextResponse.json({ error: "This review link contains an invalid tutorial ID." }, { status: 400 });
  const hoursRaw = Number(url.searchParams.get("hours"));
  const hours =
    Number.isFinite(hoursRaw) && hoursRaw > 0 && hoursRaw <= 24 * 30
      ? hoursRaw
      : DEFAULT_LOOKBACK_HOURS;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const includeReviewed = url.searchParams.get("reviewed") === "1";
  const beforeAt = url.searchParams.get("beforeAt");
  const beforeId = url.searchParams.get("beforeId");
  if ((beforeAt || beforeId) && (!z.string().datetime().safeParse(beforeAt).success || !z.string().uuid().safeParse(beforeId).success)) return NextResponse.json({ error: "Invalid review page cursor" }, { status: 400 });

  const canSeeEveryone =
    session.role === "ADMIN" ||
    session.role === "MANAGER" ||
    hasPermission(session, "manage:tutorial-settings");
  const wantsEveryone = url.searchParams.get("scope") === "all";
  const scopeAll = canSeeEveryone && (wantsEveryone || Boolean(requestedId));
  if (requestedId) {
    const [target] = await db.select({ id: tutorialJobs.id, createdBy: tutorialJobs.created_by, status: tutorialJobs.status, sourceJobId: tutorialJobs.source_job_id, language: tutorialJobs.language }).from(tutorialJobs).where(eq(tutorialJobs.id, requestedId)).limit(1);
    if (!target || (!canSeeEveryone && target.createdBy !== session.userId)) return NextResponse.json({ error: "The linked tutorial was not found or you do not have access to it." }, { status: 404 });
    if (target.status !== "COMPLETED" || target.sourceJobId || normalizeTutorialLanguage(target.language) !== "en") return NextResponse.json({ error: "This tutorial is not ready for final review. Final review requires a completed English original." }, { status: 409 });
  }

  const fetchedRows = await db
    .select({
      id: tutorialJobs.id,
      cursorAt: tutorialJobs.created_at,
      title: tutorialJobs.title,
      language: tutorialJobs.language,
      channelId: tutorialJobs.channel_id,
      channelName: channels.name,
      completedAt: tutorialJobs.completed_at,
      finalPath: tutorialJobs.final_path,
      qaRecordingPath: tutorialJobs.recording_path,
      qaAudioPath: tutorialJobs.audio_path,
      qaRecordedAt: tutorialJobs.recorded_at,
      qaScriptDigest: sql<string>`md5(coalesce(${tutorialJobs.script_text}, ''))`,
      durationS: tutorialJobs.recording_duration_s,
      reviewStatus: tutorialJobs.va_review_status,
      reviewedAt: tutorialJobs.va_reviewed_at,
      qaStatus: tutorialJobs.output_qa_status,
      qaDetail: tutorialJobs.output_qa_detail,
      deliveredToDrive: tutorialJobs.delivered_to_drive,
      description: tutorialJobs.description,
      tags: tutorialJobs.tags,
      createdBy: tutorialJobs.created_by,
    })
    .from(tutorialJobs)
    .leftJoin(channels, eq(channels.id, tutorialJobs.channel_id))
    .where(
      and(
        eq(tutorialJobs.status, "COMPLETED"),
        ...(requestedId ? [eq(tutorialJobs.id, requestedId)] : [
          ...(hours > 0 ? [gte(tutorialJobs.completed_at, since)] : []),
          ...(includeReviewed ? [] : [isNull(tutorialJobs.va_review_status)]),
          ...(beforeAt && beforeId ? [sql`(${tutorialJobs.created_at}, ${tutorialJobs.id}) < (${beforeAt}::timestamptz, ${beforeId}::uuid)`] : []),
        ]),
        // Only the ENGLISH originals the VA actually recorded. Localized
        // children (source_job_id set) reuse the same recorded background and
        // are auto-delivered, so they never need a separate approval — showing
        // them would make the VA re-approve the same video for every locale.
        isNull(tutorialJobs.source_job_id),
        sql`lower(trim(${tutorialJobs.language})) in ('en', 'english')`,
        ...(scopeAll ? [] : [eq(tutorialJobs.created_by, session.userId)]),
      ),
    )
    .orderBy(desc(tutorialJobs.created_at), desc(tutorialJobs.id))
    .limit(201);
  const rows = fetchedRows.slice(0,200);
  const tail = rows.at(-1);
  const nextCursor = !requestedId && fetchedRows.length > 200 && tail ? { beforeAt: tail.cursorAt, beforeId: tail.id } : null;
  if (requestedId && rows.length !== 1) return NextResponse.json({ error: "The linked tutorial changed or is no longer available for final review." }, { status: 409 });

  const ids = rows.map((r) => r.id);

  const variantRows =
    ids.length > 0
      ? await db
          .select({
            id: tutorialJobs.id,
            sourceJobId: tutorialJobs.source_job_id,
            language: tutorialJobs.language,
            title: tutorialJobs.title,
            channelId: tutorialJobs.channel_id,
          })
          .from(tutorialJobs)
          .where(
            and(
              isNotNull(tutorialJobs.source_job_id),
              inArray(tutorialJobs.source_job_id, ids),
            ),
          )
      : [];
  const allThumbnailJobIds = [
    ...ids,
    ...variantRows.map((variant) => variant.id),
  ];

  // Thumbnails are polymorphic (subject_kind + subject_id, no FK), so they
  // cannot be joined — fetched for these jobs and matched in memory. The row id
  // is returned, not just a boolean: the Review tab renders the picture, and
  // /api/production/jobs/[id]/thumbnail/[thumbId] is the one thumbnail route a
  // TUTORIAL_VA can actually read (the /api/thumbnails/* family wants
  // view:settings, which they do not hold).
  const thumbRows =
    allThumbnailJobIds.length > 0
      ? await db
          .select({
            id: thumbnails.id,
            subjectId: thumbnails.subject_id,
            outputPath: thumbnails.output_path,
            isSelected: thumbnails.is_selected,
            language: thumbnails.language,
            channelId: thumbnails.channel_id,
            status: thumbnails.status,
            reviewVerdict: thumbnails.review_verdict,
            createdAt: thumbnails.created_at,
          })
          .from(thumbnails)
          .where(
            and(
              eq(thumbnails.subject_kind, "tutorial_job"),
              eq(thumbnails.status, "completed"),
              inArray(thumbnails.subject_id, allThumbnailJobIds),
            ),
          )
          .orderBy(desc(thumbnails.is_selected), desc(thumbnails.created_at))
      : [];

  // Selected first, then newest — so the first hit per subject is the one that
  // ships.
  const thumbnailOwners = [
    ...rows.map((row) => ({
      id: row.id,
      language: row.language,
      channelId: row.channelId,
    })),
    ...variantRows.map((row) => ({
      id: row.id,
      language: row.language,
      channelId: row.channelId,
    })),
  ];
  const thumbBySubject = new Map<string, string>();
  const approvedThumbSubjects = new Set<string>();
  for (const owner of thumbnailOwners) {
    const selection = assessTutorialThumbnailSelection(
      owner,
      thumbRows.filter((thumbnail) => thumbnail.subjectId === owner.id),
    );
    if (selection.thumbnail) {
      thumbBySubject.set(owner.id, selection.thumbnail.id);
      if (thumbRows.find(thumbnail => thumbnail.id === selection.thumbnail!.id)?.reviewVerdict === "acceptable") approvedThumbSubjects.add(owner.id);
    }
  }

  // Drive presence is read from storage_artifacts, never from the
  // delivered_to_drive boolean alone — that flag is hand-written and has a
  // documented history of being set without an upload happening.
  const artRows =
    ids.length > 0
      ? await db
          .select({
            jobId: storageArtifacts.job_id,
            kind: storageArtifacts.kind,
            driveFileId: storageArtifacts.drive_file_id,
            ownerKind: storageArtifacts.owner_kind,
            state: storageArtifacts.state,
            vpsPath: storageArtifacts.vps_path,
            checksumSha256: storageArtifacts.checksum_sha256,
            bytes: storageArtifacts.bytes,
            verifiedAt: storageArtifacts.verified_at,
          })
          .from(storageArtifacts)
          .where(
            and(
              eq(storageArtifacts.owner_kind, "tutorial_job"),
              inArray(storageArtifacts.job_id, ids),
            ),
          )
      : [];
  const driveConfiguration = ids.length ? await loadStorageConfigFromDatabase(db) : null;
  const availability = await Promise.all(rows.map(r => reviewMediaAvailability(r.id, r.finalPath, artRows, {
    allowedRoots: [getHubConfig().LOCAL_MEDIA_ROOT], maxBytes: 8 * 1024 ** 3, driveConfigured: driveConfiguration?.enabled === true,
  })));

  const jobs = rows.map((r, i) => {
    const qaDetail = currentReviewQaDetail(r.qaDetail, { completedAt: r.completedAt?.toISOString() ?? null, finalPath: r.finalPath, recordingPath: r.qaRecordingPath, audioPath: r.qaAudioPath, recordedAt: r.qaRecordedAt?.toISOString() ?? null, scriptDigest: r.qaScriptDigest });
    return {
    id: r.id,
    title: r.title,
    channelId: r.channelId,
    channelName: r.channelName,
    completedAt: r.completedAt?.toISOString() ?? null,
    durationSeconds: r.durationS !== null ? Number(r.durationS) : null,
    reviewStatus: r.reviewStatus,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    qaStatus: qaDetail ? r.qaStatus : null,
    qaEvidence: reviewQaEvidence(qaDetail),
    qaSummary:
      qaDetail && typeof qaDetail === "object"
        ? ((qaDetail as { summary?: string }).summary ?? null)
        : null,
    thumbnailId: thumbBySubject.get(r.id) ?? null,
    thumbnailVariants: [
      {
        id: r.id,
        language: "en",
        title: r.title,
        thumbnailId: thumbBySubject.get(r.id) ?? null,
        thumbnailApproved: approvedThumbSubjects.has(r.id),
      },
      ...variantRows
        .filter(
          (variant) =>
            variant.sourceJobId === r.id &&
            Boolean(normalizeTutorialLanguage(variant.language) && normalizeTutorialLanguage(variant.language) !== "en"),
        )
        .map((variant) => ({
          id: variant.id,
          language: normalizeTutorialLanguage(variant.language)!,
          title: variant.title,
          thumbnailId: thumbBySubject.get(variant.id) ?? null,
          thumbnailApproved: approvedThumbSubjects.has(variant.id),
        })),
    ],
    hasThumbnail: thumbBySubject.has(r.id),
    // Compatibility label: a receipt, never proof of rehashed current bytes.
    inDrive: availability[i]?.receiptRecorded ?? false,
    hasDescription: Boolean(r.description),
    hasTags: Array.isArray(r.tags) && r.tags.length > 0,
    ...availability[i],
    mine: r.createdBy === session.userId,
    };
  });

  return NextResponse.json({
    requestedJobId: requestedId,
    nextCursor,
    hours,
    scope: scopeAll ? "all" : "mine",
    canSeeEveryone,
    producedCount: jobs.length,
    approvedCount: jobs.filter((j) => j.reviewStatus === "approved").length,
    disapprovedCount: jobs.filter((j) => j.reviewStatus === "disapproved")
      .length,
    jobs,
  });
}
