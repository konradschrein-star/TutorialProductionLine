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
  driveFileId: string | null;
  driveUrl: string | null;
  completedAt: string | null;
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
  driveFileId: string | null;
  driveUrl: string | null;
  completedAt: string | null;
  createdAt: string;
  uploader: UploaderDispatchView | null;
  translations: TranslationDeliveryItem[];
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
        completedAt: tutorialJobs.completed_at,
        createdAt: tutorialJobs.created_at,
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
      .limit(300);

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
              completedAt: tutorialJobs.completed_at,
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
      { driveFileId: string | null; driveUrl: string | null }
    >();
    for (const a of artRows) {
      if (a.driveFileId || a.driveWebLink) {
        driveMap.set(a.jobId, {
          driveFileId: a.driveFileId,
          driveUrl:
            a.driveWebLink ??
            (a.driveFileId
              ? `https://drive.google.com/file/d/${a.driveFileId}/view`
              : null),
        });
      }
    }

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
        driveFileId: d?.driveFileId ?? null,
        driveUrl: d?.driveUrl ?? null,
        completedAt: c.completedAt ? c.completedAt.toISOString() : null,
        uploader: dispatchMap.get(c.id) ?? null,
      });
    }

    // 6. Build final response rows
    const videos: VideoDeliveryRow[] = parents.map((p) => {
      const d = driveMap.get(p.id);
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
        driveFileId: d?.driveFileId ?? null,
        driveUrl: d?.driveUrl ?? null,
        completedAt: p.completedAt ? p.completedAt.toISOString() : null,
        createdAt: p.createdAt.toISOString(),
        uploader: dispatchMap.get(p.id) ?? null,
        translations: translationsMap.get(p.id) ?? [],
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
  if (!session || !hasPermission(session, "view:production")) {
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
        uploaded_at: isUploaded ? new Date() : null,
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
