import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  db,
  tutorialJobs,
  channels,
  users,
  storageArtifacts,
  thumbnails,
  tutorialUploadDispatches,
  tutorialSourceRevision,
  tutorialJobEvents,
} from "@/lib/db";
import { assessTutorialThumbnailSelection } from "@/lib/tutorial/thumbnail-selection";
import { verifyPublicationApproval } from "@/lib/tutorial/verify-publication-approval";
import { mayAccessDelivery, uploaderChannelIds } from "@/lib/tutorial/delivery-access";
import {
  DispatchGateError,
  validateDispatchCandidate,
} from "@/lib/tutorial/uploader-dispatch";

export const dynamic = "force-dynamic";

export interface UploaderDispatchView {
  id: string;
  state: string;
  latestMessage: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  youtubeVideoUrl: string | null;
  requestedAt: string;
  updatedAt: string;
}

export interface TranslationDeliveryItem {
  finalReviewRecorded: boolean;
  id: string;
  sourceJobId: string;
  language: string;
  title: string;
  status: string;
  finalPath: string | null;
  isUploaded: boolean;
  uploadedAt: string | null;
  uploadedBy: string | null;
  youtubeUploadUrl: string | null;
  uploaderStatus: string | null;
  youtubeVisibility: string | null;
  scheduledFor: string | null;
  youtubePublishedAt: string | null;
  uploadVerifiedAt: string | null;
  driveFileId: string | null;
  driveUrl: string | null;
  completedAt: string | null;
  description: string | null;
  tags: string[] | null;
  deliveredToDrive: boolean;
  driveState: "uploaded" | "uploading" | "failed" | "held" | "pending";
  driveArtifactCount: number;
  driveFolderPath: string | null;
  driveError: string | null;
  thumbnailId: string | null;
  thumbnailKind: "none" | "automatic" | "ai";
  thumbnailApproved: boolean;
  dispatchBlockers: string[];
  uploader: UploaderDispatchView | null;
}

export interface VideoDeliveryRow {
  finalReviewRecorded: boolean;
  id: string;
  title: string;
  keywordRef: string | null;
  ktUrl: string | null;
  channelName: string | null;
  creatorName: string | null;
  creatorEmail: string | null;
  status: string;
  finalPath: string | null;
  durationS: number | null;
  isUploaded: boolean;
  uploadedAt: string | null;
  uploadedBy: string | null;
  youtubeUploadUrl: string | null;
  uploaderStatus: string | null;
  youtubeVisibility: string | null;
  scheduledFor: string | null;
  youtubePublishedAt: string | null;
  uploadVerifiedAt: string | null;
  driveFileId: string | null;
  driveUrl: string | null;
  completedAt: string | null;
  createdAt: string;
  uploader: UploaderDispatchView | null;
  translations: TranslationDeliveryItem[];
  description: string | null;
  tags: string[] | null;
  deliveredToDrive: boolean;
  driveState: "uploaded" | "uploading" | "failed" | "held" | "pending";
  driveArtifactCount: number;
  driveFolderPath: string | null;
  driveError: string | null;
  thumbnailId: string | null;
  thumbnailKind: "none" | "automatic" | "ai";
  thumbnailApproved: boolean;
  dispatchBlockers: string[];
}

export interface UploadCalendarDay {
  date: string;
  channelId: string | null;
  channelName: string;
  language: string;
  count: number;
  latestUploadAt: string;
}

/**
 * GET /api/production/uploads
 *
 * Master Delivery & Uploads overview table:
 * Fetches all completed parent tutorial videos with adjacent keyword, creator,
 * Google Drive links, manual status, uploader receipt projection, and nested
 * translations.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session || (!hasPermission(session, "view:production") && !hasPermission(session, "upload:youtube-video"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const canDispatch = hasPermission(session, "upload:youtube-video");
  const privileged = session.role === "ADMIN" || session.role === "MANAGER" || hasPermission(session, "manage:tutorial-settings");
  const query = new URL(request.url).searchParams;
  const parsedQuery = z.object({ q: z.string().trim().max(200).default(""), filter: z.enum(["ALL", "PENDING", "UPLOADED"]).default("ALL"), beforeAt: z.string().datetime().optional(), beforeId: z.string().uuid().optional() }).refine((value) => Boolean(value.beforeAt) === Boolean(value.beforeId), "Both cursor fields are required").safeParse(Object.fromEntries(query));
  if (!parsedQuery.success) return NextResponse.json({ error: "Invalid search, filter or pagination cursor." }, { status: 400 });
  const { q, filter, beforeAt, beforeId } = parsedQuery.data;
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const sortTime = sql`coalesce(${tutorialJobs.completed_at}, ${tutorialJobs.created_at})`;

  try {
    const assignedChannelIds = session.role === "UPLOADER_VA" ? await uploaderChannelIds(session.userId) : [];
    const visibilityScope = privileged ? undefined : session.role === "UPLOADER_VA" ? (assignedChannelIds.length ? inArray(tutorialJobs.channel_id, assignedChannelIds) : sql`false`) : eq(tutorialJobs.created_by, session.userId);
    // Keep the calendar independent from the 60-row operational table below.
    // At five channels per hour that table only covers a few days, while the
    // calendar needs enough history to make missed channel-days visible.
    const calendarSince = new Date();
    calendarSince.setUTCHours(0, 0, 0, 0);
    calendarSince.setUTCDate(1);
    calendarSince.setUTCMonth(calendarSince.getUTCMonth() - 5);
    const calendarTimestamp = sql<Date>`coalesce(
      ${tutorialJobs.youtube_published_at},
      ${tutorialJobs.uploaded_at},
      ${tutorialJobs.uploader_last_callback_at}
    )`;
    const calendarDate = sql<string>`to_char(
      ${calendarTimestamp} at time zone 'Europe/Berlin',
      'YYYY-MM-DD'
    )`;
    const calendarLanguage = sql<string>`coalesce(
      ${channels.language},
      ${tutorialJobs.language},
      'unknown'
    )`;
    const calendarRows = await db
      .select({
        date: calendarDate,
        channelId: tutorialJobs.channel_id,
        channelName: channels.name,
        language: calendarLanguage,
        count: sql<number>`cast(count(*) as integer)`,
        // Aggregates over timestamptz are returned as strings by this driver.
        latestUploadAt: sql<string>`max(${calendarTimestamp})`,
      })
      .from(tutorialJobs)
      .leftJoin(channels, eq(channels.id, tutorialJobs.channel_id))
      .where(
        and(
          sql`${calendarTimestamp} >= ${calendarSince.toISOString()}::timestamptz`,
          visibilityScope,
          or(
            eq(tutorialJobs.is_uploaded, true),
            inArray(tutorialJobs.uploader_status, ["scheduled", "uploaded"]),
          ),
        ),
      )
      .groupBy(
        calendarDate,
        tutorialJobs.channel_id,
        channels.name,
        calendarLanguage,
      )
      .orderBy(calendarDate);

    const uploadCalendar: UploadCalendarDay[] = calendarRows.map((row) => ({
      date: row.date,
      channelId: row.channelId,
      channelName: row.channelName ?? "Unassigned channel",
      language: row.language,
      count: Number(row.count),
      latestUploadAt: new Date(row.latestUploadAt).toISOString(),
    }));

    // 1. Fetch completed primary tutorial jobs (originals)
    const fetchedParents = await db
      .select({
        cursorTime: sql<string>`to_char(${sortTime} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        id: tutorialJobs.id,
        title: tutorialJobs.title,
        keywordRef: tutorialJobs.keyword_ref,
        ktUrl: tutorialJobs.kt_url,
        channelName: channels.name,
        channelId: tutorialJobs.channel_id,
        language: tutorialJobs.language,
        channelLanguage: channels.language,
        uploaderChannelKey: channels.uploader_channel_key,
        createdById: tutorialJobs.created_by,
        creatorName: users.name,
        creatorEmail: users.email,
        status: tutorialJobs.status,
        finalPath: tutorialJobs.final_path,
        durationS: tutorialJobs.recording_duration_s,
        isUploaded: tutorialJobs.is_uploaded,
        uploadedAt: tutorialJobs.uploaded_at,
        uploadedBy: tutorialJobs.uploaded_by,
        youtubeUploadUrl: tutorialJobs.youtube_upload_url,
        uploaderStatus: tutorialJobs.uploader_status,
        youtubeVisibility: tutorialJobs.youtube_visibility,
        scheduledFor: tutorialJobs.scheduled_for,
        youtubePublishedAt: tutorialJobs.youtube_published_at,
        uploadVerifiedAt: tutorialJobs.upload_verified_at,
        completedAt: tutorialJobs.completed_at,
        createdAt: tutorialJobs.created_at,
        description: tutorialJobs.description,
        tags: tutorialJobs.tags,
        thumbnailTextTop: tutorialJobs.thumbnail_text_top,
        thumbnailTextBottom: tutorialJobs.thumbnail_text_bottom,
        deliveredToDrive: tutorialJobs.delivered_to_drive,
        outputQaStatus: tutorialJobs.output_qa_status,
        outputQaDetail: tutorialJobs.output_qa_detail,
        reviewStatus: tutorialJobs.va_review_status,
        hasApproval: sql<boolean>`${tutorialJobs.publication_approval} is not null`,
      })
      .from(tutorialJobs)
      .leftJoin(channels, eq(channels.id, tutorialJobs.channel_id))
      .leftJoin(users, eq(users.id, tutorialJobs.created_by))
      .where(
        and(
          eq(tutorialJobs.status, "COMPLETED"),
          isNull(tutorialJobs.source_job_id),
          eq(tutorialJobs.va_review_status, "approved"),
          isNotNull(tutorialJobs.publication_approval),
          visibilityScope,
          filter === "ALL" ? undefined : eq(tutorialJobs.is_uploaded, filter === "UPLOADED"),
          q ? or(ilike(tutorialJobs.title, pattern), ilike(tutorialJobs.keyword_ref, pattern), ilike(users.name, pattern), ilike(users.email, pattern), sql`exists (select 1 from tutorial_jobs locale_search where locale_search.source_job_id = ${tutorialJobs.id} and locale_search.title ilike ${pattern})`) : undefined,
          beforeAt && beforeId ? sql`(${sortTime}, ${tutorialJobs.id}) < (${beforeAt}::timestamptz, ${beforeId}::uuid)` : undefined,
        ),
      )
      .orderBy(
        sql`${sortTime} DESC`,
        desc(tutorialJobs.id),
      )
      // Rendering 300 expandable rows (plus every translation) made a single
      // click re-render thousands of controls and lock up modest VA laptops.
      // Search/filter happen before the bounded page, including locale titles.
      .limit(61);
    const parents = fetchedParents.slice(0, 60);
    const last = parents.at(-1);
    const nextCursor = fetchedParents.length > 60 && last ? { beforeAt: last.cursorTime, beforeId: last.id } : null;

    const parentIds = parents.map((p) => p.id);

    // 2. Fetch all child translation variants for these parents
    const childRows =
      parentIds.length > 0
        ? await db
            .select({
              id: tutorialJobs.id,
              sourceJobId: tutorialJobs.source_job_id,
              language: tutorialJobs.language,
              channelId: tutorialJobs.channel_id,
              channelLanguage: channels.language,
              uploaderChannelKey: channels.uploader_channel_key,
              title: tutorialJobs.title,
              status: tutorialJobs.status,
              finalPath: tutorialJobs.final_path,
              isUploaded: tutorialJobs.is_uploaded,
              uploadedAt: tutorialJobs.uploaded_at,
              uploadedBy: tutorialJobs.uploaded_by,
              youtubeUploadUrl: tutorialJobs.youtube_upload_url,
              uploaderStatus: tutorialJobs.uploader_status,
              youtubeVisibility: tutorialJobs.youtube_visibility,
              scheduledFor: tutorialJobs.scheduled_for,
              youtubePublishedAt: tutorialJobs.youtube_published_at,
              uploadVerifiedAt: tutorialJobs.upload_verified_at,
              completedAt: tutorialJobs.completed_at,
              description: tutorialJobs.description,
              tags: tutorialJobs.tags,
              thumbnailTextTop: tutorialJobs.thumbnail_text_top,
              thumbnailTextBottom: tutorialJobs.thumbnail_text_bottom,
              deliveredToDrive: tutorialJobs.delivered_to_drive,
              outputQaStatus: tutorialJobs.output_qa_status,
              outputQaDetail: tutorialJobs.output_qa_detail,
              hasApproval: sql<boolean>`${tutorialJobs.publication_approval} is not null`,
            })
            .from(tutorialJobs)
            .leftJoin(channels, eq(channels.id, tutorialJobs.channel_id))
            .where(
              and(
                isNotNull(tutorialJobs.source_job_id),
                inArray(tutorialJobs.source_job_id, parentIds),
                visibilityScope,
              ),
            )
        : [];

    const allJobIds = [...parentIds, ...childRows.map((c) => c.id)];

    // 3. Fetch Google Drive storage artifacts for all these jobs
    const artRows =
      allJobIds.length > 0
        ? await db
            .select({
              jobId: storageArtifacts.job_id,
              driveFileId: storageArtifacts.drive_file_id,
              driveWebLink: storageArtifacts.drive_web_link,
              kind: storageArtifacts.kind,
              state: storageArtifacts.state,
              driveFolderPath: storageArtifacts.drive_folder_path,
              driveFolderId: storageArtifacts.drive_folder_id,
              errorMessage: storageArtifacts.error_message,
            })
            .from(storageArtifacts)
            .where(
              and(
                eq(storageArtifacts.owner_kind, "tutorial_job"),
                inArray(storageArtifacts.job_id, allJobIds),
              ),
            )
        : [];

    const driveMap = new Map<
      string,
      {
        driveFileId: string | null;
        driveUrl: string | null;
        state: string;
        count: number;
        folderPath: string | null;
        error: string | null;
      }
    >();
    for (const a of artRows) {
      const previous = driveMap.get(a.jobId);
      const count = (previous?.count ?? 0) + (a.state === "uploaded" ? 1 : 0);
      if (a.kind === "final_video" || !previous) {
        driveMap.set(a.jobId, {
          driveFileId: a.driveFileId,
          driveUrl:
            (a.driveFolderId
              ? `https://drive.google.com/drive/folders/${a.driveFolderId}`
              : null) ??
            a.driveWebLink ??
            (a.driveFileId
              ? `https://drive.google.com/file/d/${a.driveFileId}/view`
              : null),
          state: a.state,
          count,
          folderPath: a.driveFolderPath,
          error: a.errorMessage,
        });
      } else {
        previous.count = count;
        if (!previous.error && a.errorMessage) previous.error = a.errorMessage;
      }
    }

    const thumbRows =
      allJobIds.length > 0
        ? await db
            .select({
              id: thumbnails.id,
              subjectId: thumbnails.subject_id,
              generationKind: thumbnails.generation_kind,
              providerUsed: thumbnails.provider_used,
              promptMode: thumbnails.prompt_mode,
              reviewVerdict: thumbnails.review_verdict,
              isSelected: thumbnails.is_selected,
              language: thumbnails.language,
              channelId: thumbnails.channel_id,
              status: thumbnails.status,
              outputPath: thumbnails.output_path,
              createdAt: thumbnails.created_at,
            })
            .from(thumbnails)
            .where(
              and(
                eq(thumbnails.subject_kind, "tutorial_job"),
                eq(thumbnails.status, "completed"),
                inArray(thumbnails.subject_id, allJobIds),
              ),
            )
            .orderBy(desc(thumbnails.is_selected), desc(thumbnails.created_at))
        : [];
    const thumbnailSelection = (job: {
      id: string;
      language: string | null;
      channelId: string | null;
    }) =>
      assessTutorialThumbnailSelection(
        job,
        thumbRows.filter((thumbnail) => thumbnail.subjectId === job.id),
      );
    const thumbnailKind = (
      thumbnail: (typeof thumbRows)[number] | undefined,
    ): "none" | "automatic" | "ai" => {
      if (!thumbnail) return "none";
      if (
        thumbnail.generationKind === "edit" ||
        thumbnail.promptMode === "manual"
      )
        return "automatic";
      if (thumbnail.providerUsed) return "ai";
      return "automatic";
    };
    const driveState = (
      delivered: boolean,
      qa: string | null,
      drive: ReturnType<typeof driveMap.get>,
    ) => {
      if (delivered && drive?.state === "uploaded") return "uploaded" as const;
      if (qa === "failed") return "held" as const;
      if (drive?.state === "uploading") return "uploading" as const;
      if (drive?.state === "failed") return "failed" as const;
      return "pending" as const;
    };
    const dispatchBlockers = (
      candidate: Parameters<typeof validateDispatchCandidate>[0],
      selection: ReturnType<typeof assessTutorialThumbnailSelection>,
    ): string[] => {
      const blockers = [...selection.reasons];
      try {
        validateDispatchCandidate(candidate, {
          visibility: "private",
          made_for_kids: false,
          monetization: "off",
        });
      } catch (error) {
        blockers.unshift(
          error instanceof DispatchGateError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error),
        );
      }
      return blockers;
    };

    // 4. Read the Studio projection of uploader receipts. The uploader remains
    // a separate service; these rows are its durable request/receipt boundary.
    const dispatchRows =
      allJobIds.length > 0
        ? await db
            .select({
              id: tutorialUploadDispatches.id,
              jobId: tutorialUploadDispatches.tutorial_job_id,
              state: tutorialUploadDispatches.state,
              latestMessage: tutorialUploadDispatches.latest_message,
              errorCode: tutorialUploadDispatches.error_code,
              errorMessage: tutorialUploadDispatches.error_message,
              youtubeVideoUrl: tutorialUploadDispatches.youtube_video_url,
              requestedAt: tutorialUploadDispatches.requested_at,
              updatedAt: tutorialUploadDispatches.updated_at,
            })
            .from(tutorialUploadDispatches)
            .where(inArray(tutorialUploadDispatches.tutorial_job_id, allJobIds))
        : [];
    const dispatchMap = new Map<string, UploaderDispatchView>();
    for (const dispatch of dispatchRows) {
      dispatchMap.set(dispatch.jobId, {
        id: dispatch.id,
        state: dispatch.state,
        latestMessage: dispatch.latestMessage,
        errorCode: dispatch.errorCode,
        errorMessage: dispatch.errorMessage,
        youtubeVideoUrl: dispatch.youtubeVideoUrl,
        requestedAt: dispatch.requestedAt.toISOString(),
        updatedAt: dispatch.updatedAt.toISOString(),
      });
    }

    // 5. Group translations by parent ID
    const translationsMap = new Map<string, TranslationDeliveryItem[]>();
    for (const c of childRows) {
      if (!c.sourceJobId) continue;
      if (!translationsMap.has(c.sourceJobId)) {
        translationsMap.set(c.sourceJobId, []);
      }
      const d = driveMap.get(c.id);
      const selection = thumbnailSelection(c);
      const thumbnail = selection.thumbnail
        ? thumbRows.find((row) => row.id === selection.thumbnail!.id)
        : undefined;
      translationsMap.get(c.sourceJobId)!.push({
        finalReviewRecorded: Boolean(c.hasApproval && parents.some(p => p.id === c.sourceJobId && p.reviewStatus === "approved" && p.hasApproval)),
        id: c.id,
        sourceJobId: c.sourceJobId,
        language: c.language ?? "Translated",
        title: c.title,
        status: c.status,
        finalPath: c.finalPath,
        isUploaded: Boolean(c.isUploaded),
        uploadedAt: c.uploadedAt ? c.uploadedAt.toISOString() : null,
        uploadedBy: c.uploadedBy,
        youtubeUploadUrl: c.youtubeUploadUrl,
        uploaderStatus: c.uploaderStatus,
        youtubeVisibility: c.youtubeVisibility,
        scheduledFor: c.scheduledFor?.toISOString() ?? null,
        youtubePublishedAt: c.youtubePublishedAt?.toISOString() ?? null,
        uploadVerifiedAt: c.uploadVerifiedAt?.toISOString() ?? null,
        driveFileId: d?.driveFileId ?? null,
        driveUrl: d?.driveUrl ?? null,
        completedAt: c.completedAt ? c.completedAt.toISOString() : null,
        description: c.description,
        tags: c.tags,
        deliveredToDrive: c.deliveredToDrive,
        driveState: driveState(c.deliveredToDrive, c.outputQaStatus, d),
        driveArtifactCount: d?.count ?? 0,
        driveFolderPath: d?.folderPath ?? null,
        driveError:
          d?.error ??
          (c.outputQaStatus === "failed" ? "Held by output QA" : null),
        thumbnailId: thumbnail?.id ?? null,
        thumbnailKind: thumbnailKind(thumbnail),
        thumbnailApproved:
          thumbnail?.reviewVerdict === "acceptable" ||
          thumbnail?.reviewVerdict === "strong",
        dispatchBlockers: dispatchBlockers(
          {
            status: c.status,
            isUploaded: c.isUploaded,
            sourceJobId: c.sourceJobId,
            language: c.language,
            channelId: c.channelId,
            channelLanguage: c.channelLanguage,
            title: c.title,
            description: c.description,
            tags: c.tags,
            finalPath: c.finalPath,
            uploaderChannelKey: c.uploaderChannelKey,
            thumbnailTextTop: c.thumbnailTextTop,
            thumbnailTextBottom: c.thumbnailTextBottom,
          },
          selection,
        ),
        uploader: dispatchMap.get(c.id) ?? null,
      });
    }

    // 6. Build final response rows
    const videos: VideoDeliveryRow[] = parents.map((p) => {
      const d = driveMap.get(p.id);
      const selection = thumbnailSelection(p);
      const thumbnail = selection.thumbnail
        ? thumbRows.find((row) => row.id === selection.thumbnail!.id)
        : undefined;
      return {
        id: p.id,
        finalReviewRecorded: p.reviewStatus === "approved" && Boolean(p.hasApproval),
        title: p.title,
        keywordRef: p.keywordRef,
        ktUrl: p.ktUrl,
        channelName: p.channelName,
        creatorName: p.creatorName ?? "VA",
        creatorEmail: p.creatorEmail,
        status: p.status,
        finalPath: p.finalPath,
        durationS: p.durationS ? Number(p.durationS) : null,
        isUploaded: Boolean(p.isUploaded),
        uploadedAt: p.uploadedAt ? p.uploadedAt.toISOString() : null,
        uploadedBy: p.uploadedBy,
        youtubeUploadUrl: p.youtubeUploadUrl,
        uploaderStatus: p.uploaderStatus,
        youtubeVisibility: p.youtubeVisibility,
        scheduledFor: p.scheduledFor?.toISOString() ?? null,
        youtubePublishedAt: p.youtubePublishedAt?.toISOString() ?? null,
        uploadVerifiedAt: p.uploadVerifiedAt?.toISOString() ?? null,
        driveFileId: d?.driveFileId ?? null,
        driveUrl: d?.driveUrl ?? null,
        completedAt: p.completedAt ? p.completedAt.toISOString() : null,
        createdAt: p.createdAt.toISOString(),
        uploader: dispatchMap.get(p.id) ?? null,
        translations: (translationsMap.get(p.id) ?? []).filter(item => item.finalReviewRecorded),
        description: p.description,
        tags: p.tags,
        deliveredToDrive: p.deliveredToDrive,
        driveState: driveState(p.deliveredToDrive, p.outputQaStatus, d),
        driveArtifactCount: d?.count ?? 0,
        driveFolderPath: d?.folderPath ?? null,
        driveError:
          d?.error ??
          (p.outputQaStatus === "failed" ? "Held by output QA" : null),
        thumbnailId: thumbnail?.id ?? null,
        thumbnailKind: thumbnailKind(thumbnail),
        thumbnailApproved:
          thumbnail?.reviewVerdict === "acceptable" ||
          thumbnail?.reviewVerdict === "strong",
        dispatchBlockers: dispatchBlockers(
          {
            status: p.status,
            isUploaded: p.isUploaded,
            sourceJobId: null,
            language: p.language,
            channelId: p.channelId,
            channelLanguage: p.channelLanguage,
            title: p.title,
            description: p.description,
            tags: p.tags,
            finalPath: p.finalPath,
            uploaderChannelKey: p.uploaderChannelKey,
            thumbnailTextTop: p.thumbnailTextTop,
            thumbnailTextBottom: p.thumbnailTextBottom,
          },
          selection,
        ),
      };
    });

    const totalUploaded = videos.filter((v) => v.isUploaded).length;
    const totalPending = videos.length - totalUploaded;

    return NextResponse.json({
      videos,
      totalCount: videos.length,
      totalUploaded,
      totalPending,
      canDispatch,
      canViewPlan: hasPermission(session, "view:production"),
      canInspectUploader: session.role === "ADMIN",
      uploadCalendar,
      nextCursor,
      countScope: "page",
    });
  } catch (error) {
    console.error("Failed to load uploads delivery overview:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/production/uploads
 *
 * Mark a video or translation variant as uploaded or pending upload.
 * Body: { jobId: string, isUploaded: boolean, youtubeUrl?: string }
 */
export async function PATCH(request: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:thumbnails")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const parsed = z.object({ jobId: z.string().uuid(), isUploaded: z.boolean(), youtubeUrl: z.string().max(500).optional() }).strict().safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Expected a tutorial ID, boolean status and optional YouTube URL." }, { status: 400 });
    const { jobId, isUploaded } = parsed.data;
    const uploader = session.email ?? session.userId ?? "manual_uploader";
    return db.transaction(async (tx) => {
    const [initial] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, jobId)).limit(1);
    const privileged = session.role === "ADMIN" || session.role === "MANAGER" || hasPermission(session, "manage:tutorial-settings");
    if (!initial) return NextResponse.json({ error: "Tutorial not found" }, { status: 404 });
    if (!privileged && !await mayAccessDelivery(session, initial)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const [source] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, initial.source_job_id ?? initial.id)).for("update");
    const [current] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, jobId)).for("update");
    if (!source || !current || (!privileged && !await mayAccessDelivery(session, current))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const [blockingDispatch] = await tx
      .select({ id: tutorialUploadDispatches.id })
      .from(tutorialUploadDispatches)
      .where(eq(tutorialUploadDispatches.tutorial_job_id, jobId))
      .limit(1);
    if (blockingDispatch || current.upload_verified_at || current.uploader_job_id) {
      return NextResponse.json(
        {
          error:
            "Manual upload status is locked while an uploader dispatch exists",
        },
        { status: 409 },
      );
    }

    let youtubeUrl: string | null = null;
    if (isUploaded) {
      try {
        const url = new URL(parsed.data.youtubeUrl ?? "");
        const videoId = url.hostname === "youtu.be" ? url.pathname.slice(1) : ["youtube.com", "www.youtube.com"].includes(url.hostname) && url.pathname === "/watch" ? url.searchParams.get("v") : null;
        if (url.protocol !== "https:" || !videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error();
        youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
      } catch { return NextResponse.json({ error: "Provide the HTTPS YouTube watch/share link for the uploaded video." }, { status: 400 }); }
      if (source.va_review_status !== "approved") return NextResponse.json({ error: "Final review is required before manual delivery." }, { status: 409 });
      try {
        await verifyPublicationApproval(tx, source, tutorialSourceRevision(source));
        if (current.id !== source.id) await verifyPublicationApproval(tx, current, tutorialSourceRevision(source));
      } catch { return NextResponse.json({ error: "Current assets need final review before manual delivery can be recorded." }, { status: 409 }); }
    } else if (current.uploader_status && current.uploader_status !== "reported_uploaded") {
      return NextResponse.json({ error: "Only an unverified manual report can be withdrawn here. Reconcile external uploader state separately." }, { status: 409 });
    }
    await tx
      .update(tutorialJobs)
      .set({
        is_uploaded: isUploaded,
        uploader_status: isUploaded ? "reported_uploaded" : null,
        youtube_visibility: null,
        uploaded_at: isUploaded ? new Date() : null,
        youtube_published_at: null,
        upload_verified_at: null,
        uploaded_by: isUploaded ? uploader : null,
        youtube_upload_url: youtubeUrl,
      })
      .where(eq(tutorialJobs.id, jobId));

    await tx.insert(tutorialJobEvents).values({ tutorial_job_id: jobId, actor_id: session.userId, event_type: isUploaded ? "manual_upload_reported" : "manual_upload_report_withdrawn", payload: { verified: false, youtubeUrl, approvalRevision: (current.publication_approval as { revision?: string } | null)?.revision ?? null } });
    return NextResponse.json({
      success: true,
      jobId,
      isUploaded,
      uploadedBy: isUploaded ? uploader : null,
      verified: false,
      publicationConfirmed: false,
    });
    });
  } catch (error) {
    console.error("Failed to update upload status:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
