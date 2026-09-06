import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  channels,
  db,
  thumbnails,
  tutorialJobs,
  tutorialUploadDispatches,
} from "@/lib/db";
import {
  assertLocalDispatchAsset,
  DispatchGateError,
  DispatchRequestSchema,
  validateDispatchCandidate,
} from "@/lib/tutorial/uploader-dispatch";
import { assessTutorialThumbnailSelection } from "@/lib/tutorial/thumbnail-selection";

export const dynamic = "force-dynamic";

const JobIdSchema = z.string().uuid();

function dispatchView(dispatch: typeof tutorialUploadDispatches.$inferSelect) {
  return {
    id: dispatch.id,
    exchangeJobId: dispatch.exchange_job_id,
    state: dispatch.state,
    latestMessage: dispatch.latest_message,
    errorCode: dispatch.error_code,
    errorMessage: dispatch.error_message,
    youtubeVideoId: dispatch.youtube_video_id,
    youtubeVideoUrl: dispatch.youtube_video_url,
    requestedAt: dispatch.requested_at.toISOString(),
    updatedAt: dispatch.updated_at.toISOString(),
  };
}

/**
 * Request one uploader job for one completed tutorial language variant.
 *
 * This endpoint intentionally does not drive a browser or write Drive files.
 * It records a durable, idempotent request which the separate connector owns.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!hasPermission(session, "upload:youtube-video")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: rawId } = await context.params;
  const parsedId = JobIdSchema.safeParse(rawId);
  if (!parsedId.success) {
    return NextResponse.json(
      { error: "invalid tutorial job id" },
      { status: 400 },
    );
  }
  const parsedRequest = DispatchRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsedRequest.success) {
    return NextResponse.json(
      {
        error:
          "visibility, made_for_kids=false, and monetization are required; monetization=on also requires ad_suitability_confirmed=true",
        detail: parsedRequest.error.issues.map((issue) => issue.message),
      },
      { status: 400 },
    );
  }
  const tutorialJobId = parsedId.data;

  // A repeated click is a read of the original request, never a second upload.
  const [alreadyRequested] = await db
    .select()
    .from(tutorialUploadDispatches)
    .where(eq(tutorialUploadDispatches.tutorial_job_id, tutorialJobId))
    .limit(1);
  if (alreadyRequested) {
    return NextResponse.json({
      success: true,
      idempotent: true,
      dispatch: dispatchView(alreadyRequested),
    });
  }

  const [job] = await db
    .select({
      id: tutorialJobs.id,
      status: tutorialJobs.status,
      isUploaded: tutorialJobs.is_uploaded,
      sourceJobId: tutorialJobs.source_job_id,
      language: tutorialJobs.language,
      channelId: tutorialJobs.channel_id,
      title: tutorialJobs.title,
      description: tutorialJobs.description,
      tags: tutorialJobs.tags,
      finalPath: tutorialJobs.final_path,
      thumbnailTextTop: tutorialJobs.thumbnail_text_top,
      thumbnailTextBottom: tutorialJobs.thumbnail_text_bottom,
      channelLanguage: channels.language,
      uploaderChannelKey: channels.uploader_channel_key,
    })
    .from(tutorialJobs)
    .leftJoin(channels, eq(channels.id, tutorialJobs.channel_id))
    .where(eq(tutorialJobs.id, tutorialJobId))
    .limit(1);

  if (!job) {
    return NextResponse.json(
      { error: "tutorial job not found" },
      { status: 404 },
    );
  }

  try {
    const attributes = validateDispatchCandidate(job, parsedRequest.data);
    await assertLocalDispatchAsset(job.finalPath!, "video");

    const selectedThumbnails = await db
      .select({
        id: thumbnails.id,
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
          eq(thumbnails.subject_id, tutorialJobId),
          eq(thumbnails.is_selected, true),
        ),
      );
    const selection = assessTutorialThumbnailSelection(job, selectedThumbnails);
    if (!selection.ready || !selection.thumbnail) {
      throw new DispatchGateError(
        "selected_thumbnail_invalid",
        selection.reasons.join("; "),
      );
    }
    const selectedThumbnail = selection.thumbnail;
    const selectedThumbnailPath = selectedThumbnail.outputPath!;
    await assertLocalDispatchAsset(selectedThumbnailPath, "thumbnail");

    const idempotencyKey = `tutorial:${tutorialJobId}:upload:r1`;
    const inserted = await db
      .insert(tutorialUploadDispatches)
      .values({
        tutorial_job_id: tutorialJobId,
        revision: 1,
        idempotency_key: idempotencyKey,
        channel_key: job.uploaderChannelKey!.trim(),
        video_path: job.finalPath!.trim(),
        thumbnail_id: selectedThumbnail.id,
        thumbnail_path: selectedThumbnailPath,
        state: "requested",
        attributes,
        requested_by: session.userId,
      })
      .onConflictDoNothing({
        target: tutorialUploadDispatches.tutorial_job_id,
      })
      .returning();

    const dispatch =
      inserted[0] ??
      (
        await db
          .select()
          .from(tutorialUploadDispatches)
          .where(eq(tutorialUploadDispatches.tutorial_job_id, tutorialJobId))
          .limit(1)
      )[0];
    if (!dispatch) {
      throw new Error(
        "Dispatch insert conflicted but no durable row was found",
      );
    }

    return NextResponse.json(
      {
        success: true,
        idempotent: inserted.length === 0,
        dispatch: dispatchView(dispatch),
      },
      { status: inserted.length === 0 ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof DispatchGateError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 },
      );
    }
    console.error("Failed to request tutorial uploader dispatch:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
