import { timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { channels, db, storageArtifacts, tutorialJobs } from "@/lib/db";
import { getSecret } from "@repo/db";
import { getUploaderSettings } from "@/lib/uploader/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authorized(request: NextRequest): Promise<boolean> {
  const expected = await getSecret(db, "UPLOADER_CALLBACK_SECRET").catch(
    () => "",
  );
  const supplied =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Read-only uploader manifest. This endpoint deliberately has no claim/start
 * mutation: the external worker can validate complete Drive bundles overnight
 * while execution remains disabled or in dry-run mode.
 */
export async function GET(request: NextRequest) {
  if (!(await authorized(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const settings = await getUploaderSettings();
  const limit = Math.min(
    100,
    Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 25),
  );
  const jobs = await db
    .select({
      id: tutorialJobs.id,
      sourceJobId: tutorialJobs.source_job_id,
      title: tutorialJobs.title,
      language: tutorialJobs.language,
      description: tutorialJobs.description,
      tags: tutorialJobs.tags,
      scheduledFor: tutorialJobs.scheduled_for,
      uploaderStatus: tutorialJobs.uploader_status,
      channelId: tutorialJobs.channel_id,
      channelName: channels.name,
      youtubeChannelId: channels.youtube_channel_id,
    })
    .from(tutorialJobs)
    .leftJoin(channels, eq(channels.id, tutorialJobs.channel_id))
    .where(
      and(
        eq(tutorialJobs.status, "COMPLETED"),
        eq(tutorialJobs.delivered_to_drive, true),
        ne(tutorialJobs.is_uploaded, true),
        isNotNull(tutorialJobs.final_path),
      ),
    )
    .orderBy(desc(tutorialJobs.completed_at), desc(tutorialJobs.created_at))
    .limit(limit);
  const ids = jobs.map((job) => job.id);
  const artifacts = ids.length
    ? await db
        .select({
          jobId: storageArtifacts.job_id,
          kind: storageArtifacts.kind,
          state: storageArtifacts.state,
          filename: storageArtifacts.filename,
          driveFileId: storageArtifacts.drive_file_id,
          driveWebLink: storageArtifacts.drive_web_link,
          driveFolderPath: storageArtifacts.drive_folder_path,
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
  const byJob = new Map<string, typeof artifacts>();
  for (const artifact of artifacts)
    byJob.set(artifact.jobId, [...(byJob.get(artifact.jobId) ?? []), artifact]);
  const executable =
    settings.enabled &&
    settings.executionMode === "live" &&
    !settings.requireManualRelease;

  return NextResponse.json({
    version: 1,
    generatedAt: new Date().toISOString(),
    safety: {
      executionMode: settings.executionMode,
      uploaderEnabled: settings.enabled,
      requireManualRelease: settings.requireManualRelease,
      executable,
    },
    jobs: jobs.map((job) => {
      const files = byJob.get(job.id) ?? [];
      const uploadedKinds = new Set(
        files
          .filter((file) => file.state === "uploaded" && file.driveFileId)
          .map((file) => file.kind),
      );
      const missing: string[] = [];
      if (!uploadedKinds.has("final_video")) missing.push("video");
      if (!uploadedKinds.has("thumbnail")) missing.push("thumbnail");
      if (!uploadedKinds.has("metadata") && !uploadedKinds.has("upload_sheet"))
        missing.push("metadata file");
      if (!job.description?.trim()) missing.push("description");
      if (!Array.isArray(job.tags) || job.tags.length === 0)
        missing.push("tags");
      if (!job.youtubeChannelId) missing.push("YouTube channel ID");
      return {
        id: job.id,
        sourceJobId: job.sourceJobId,
        channel: {
          id: job.channelId,
          name: job.channelName,
          youtubeChannelId: job.youtubeChannelId,
        },
        language: job.language ?? "en",
        metadata: {
          title: job.title,
          description: job.description,
          tags: job.tags ?? [],
        },
        requestedPublish: {
          visibility: settings.defaultVisibility,
          scheduledFor: job.scheduledFor?.toISOString() ?? null,
          timezone: settings.timezone,
        },
        uploaderStatus: job.uploaderStatus ?? "waiting_to_be_uploaded",
        ready: missing.length === 0,
        executable: executable && missing.length === 0,
        blockers: missing,
        driveFolderPath:
          files.find((file) => file.driveFolderPath)?.driveFolderPath ?? null,
        files: files.map((file) => ({
          kind: file.kind,
          filename: file.filename,
          state: file.state,
          driveFileId: file.driveFileId,
          driveWebLink: file.driveWebLink,
          verifiedAt: file.verifiedAt?.toISOString() ?? null,
        })),
      };
    }),
  });
}
