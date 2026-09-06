import { NextResponse } from "next/server";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
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
} from "@/lib/db";

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
  uploader: UploaderDispatchView | null;
}

export interface VideoDeliveryRow {
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
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const canDispatch = hasPermission(session, "upload:youtube-video");

  try {
    // 1. Fetch completed primary tutorial jobs (originals)
    const parents = await db
      .select({
        id: tutorialJobs.id,
        title: tutorialJobs.title,
        keywordRef: tutorialJobs.keyword_ref,
        ktUrl: tutorialJobs.kt_url,
        channelName: channels.name,
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
        deliveredToDrive: tutorialJobs.delivered_to_drive,
        outputQaStatus: tutorialJobs.output_qa_status,
        outputQaDetail: tutorialJobs.output_qa_detail,
      })
      .from(tutorialJobs)
      .leftJoin(channels, eq(channels.id, tutorialJobs.channel_id))
      .leftJoin(users, eq(users.id, tutorialJobs.created_by))
      .where(
        and(
          eq(tutorialJobs.status, "COMPLETED"),
          isNull(tutorialJobs.source_job_id),
        ),
      )
      .orderBy(
        sql`${tutorialJobs.completed_at} DESC NULLS LAST`,
        desc(tutorialJobs.created_at),
      )
      // Rendering 300 expandable rows (plus every translation) made a single
      // click re-render thousands of controls and lock up modest VA laptops.
      // The newest 60 is the operational queue; search/paging can be server
      // driven later without returning the whole archive to the browser.
      .limit(60);

    const parentIds = parents.map((p) => p.id);

    // 2. Fetch all child translation variants for these parents
    const childRows =
      parentIds.length > 0
        ? await db
            .select({
              id: tutorialJobs.id,
              sourceJobId: tutorialJobs.source_job_id,
              language: tutorialJobs.language,
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
              deliveredToDrive: tutorialJobs.delivered_to_drive,
              outputQaStatus: tutorialJobs.output_qa_status,
              outputQaDetail: tutorialJobs.output_qa_detail,
            })
            .from(tutorialJobs)
            .where(
              and(
                isNotNull(tutorialJobs.source_job_id),
                inArray(tutorialJobs.source_job_id, parentIds),
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

    const driveMap = new Map<string, {
      driveFileId: string | null;
      driveUrl: string | null;
      state: string;
      count: number;
      folderPath: string | null;
      error: string | null;
    }>();
    for (const a of artRows) {
      const previous = driveMap.get(a.jobId);
      const count = (previous?.count ?? 0) + (a.state === "uploaded" ? 1 : 0);
      if (a.kind === "final_video" || !previous) {
        driveMap.set(a.jobId, {
          driveFileId: a.driveFileId,
          driveUrl:
            (a.driveFolderId ? `https://drive.google.com/drive/folders/${a.driveFolderId}` : null) ?? a.driveWebLink ??
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

    const thumbRows = allJobIds.length > 0
      ? await db
          .select({
            id: thumbnails.id,
            subjectId: thumbnails.subject_id,
            generationKind: thumbnails.generation_kind,
            providerUsed: thumbnails.provider_used,
            promptMode: thumbnails.prompt_mode,
            reviewVerdict: thumbnails.review_verdict,
            isSelected: thumbnails.is_selected,
            createdAt: thumbnails.created_at,
          })
          .from(thumbnails)
          .where(and(
            eq(thumbnails.subject_kind, "tutorial_job"),
            eq(thumbnails.status, "completed"),
            inArray(thumbnails.subject_id, allJobIds),
          ))
          .orderBy(desc(thumbnails.is_selected), desc(thumbnails.created_at))
      : [];
    const thumbnailMap = new Map<string, typeof thumbRows[number]>();
    for (const thumbnail of thumbRows) {
      if (!thumbnailMap.has(thumbnail.subjectId)) thumbnailMap.set(thumbnail.subjectId, thumbnail);
    }
    const thumbnailKind = (thumbnail: typeof thumbRows[number] | undefined): "none" | "automatic" | "ai" => {
      if (!thumbnail) return "none";
      if (thumbnail.generationKind === "edit" || thumbnail.promptMode === "manual") return "automatic";
      if (thumbnail.providerUsed) return "ai";
      return "automatic";
    };
    const driveState = (delivered: boolean, qa: string | null, drive: ReturnType<typeof driveMap.get>) => {
      if (delivered && drive?.state === "uploaded") return "uploaded" as const;
      if (qa === "failed") return "held" as const;
      if (drive?.state === "uploading") return "uploading" as const;
      if (drive?.state === "failed") return "failed" as const;
      return "pending" as const;
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
      const thumbnail = thumbnailMap.get(c.id);
      translationsMap.get(c.sourceJobId)!.push({
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
        driveError: d?.error ?? (c.outputQaStatus === "failed" ? "Held by output QA" : null),
        thumbnailId: thumbnail?.id ?? null,
        thumbnailKind: thumbnailKind(thumbnail),
        thumbnailApproved: thumbnail?.reviewVerdict === "acceptable" || thumbnail?.reviewVerdict === "strong",
        uploader: dispatchMap.get(c.id) ?? null,
      });
    }

    // 6. Build final response rows
    const videos: VideoDeliveryRow[] = parents.map((p) => {
      const d = driveMap.get(p.id);
      const thumbnail = thumbnailMap.get(p.id);
      return {
        id: p.id,
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
        translations: translationsMap.get(p.id) ?? [],
        description: p.description,
        tags: p.tags,
        deliveredToDrive: p.deliveredToDrive,
        driveState: driveState(p.deliveredToDrive, p.outputQaStatus, d),
        driveArtifactCount: d?.count ?? 0,
        driveFolderPath: d?.folderPath ?? null,
        driveError: d?.error ?? (p.outputQaStatus === "failed" ? "Held by output QA" : null),
        thumbnailId: thumbnail?.id ?? null,
        thumbnailKind: thumbnailKind(thumbnail),
        thumbnailApproved: thumbnail?.reviewVerdict === "acceptable" || thumbnail?.reviewVerdict === "strong",
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
    const body = (await request.json()) as {
      jobId?: string;
      isUploaded?: boolean;
      youtubeUrl?: string;
    };

    const jobId = body.jobId;
    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    const isUploaded = Boolean(body.isUploaded);
    const uploader = session.email ?? session.userId ?? "manual_uploader";

    const [blockingDispatch] = await db
      .select({ id: tutorialUploadDispatches.id })
      .from(tutorialUploadDispatches)
      .where(eq(tutorialUploadDispatches.tutorial_job_id, jobId))
      .limit(1);
    if (blockingDispatch) {
      return NextResponse.json(
        {
          error:
            "Manual upload status is locked while an uploader dispatch exists",
        },
        { status: 409 },
      );
    }

    await db
      .update(tutorialJobs)
      .set({
        is_uploaded: isUploaded,
        uploader_status: isUploaded ? "uploaded" : "waiting_to_be_uploaded",
        youtube_visibility: isUploaded ? "public" : null,
        uploaded_at: isUploaded ? new Date() : null,
        youtube_published_at: isUploaded ? new Date() : null,
        upload_verified_at: null,
        uploaded_by: isUploaded ? uploader : null,
        youtube_upload_url: body.youtubeUrl ?? null,
      })
      .where(eq(tutorialJobs.id, jobId));

    return NextResponse.json({
      success: true,
      jobId,
      isUploaded,
      uploadedBy: isUploaded ? uploader : null,
    });
  } catch (error) {
    console.error("Failed to update upload status:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
