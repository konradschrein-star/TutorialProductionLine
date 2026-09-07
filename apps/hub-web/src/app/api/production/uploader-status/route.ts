import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { channels, db, tutorialJobs } from "@/lib/db";
import { getSecret } from "@repo/db";
import { getUploaderSettings } from "@/lib/uploader/settings";

export const dynamic = "force-dynamic";

const UUID_PREFIX =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

type DashboardJob = {
  id?: unknown;
  channel?: unknown;
  profile?: unknown;
  title?: unknown;
  state?: unknown;
  progress?: unknown;
  current_step?: unknown;
  started_at?: unknown;
  updated_at?: unknown;
  finished_at?: unknown;
  outcome?: {
    video_id?: unknown;
    proof?: unknown;
    visibility?: unknown;
    scheduled_for?: unknown;
  } | null;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.length <= 1_000 ? value : null;
}

const UPLOADER_STATES = new Set([
  "waiting_to_be_uploaded",
  "uploading",
  "scheduled",
  "uploaded",
  "failed",
]);
const VISIBILITIES = new Set(["scheduled", "public", "private", "unlisted"]);

function safeDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function authorizedCallback(request: NextRequest): Promise<boolean> {
  const expected = await getSecret(db, "UPLOADER_CALLBACK_SECRET").catch(
    () => "",
  );
  const supplied = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Read the uploader's loopback-only, allow-listed operations dashboard. A
 * succeeded proof is also reconciled into tutorial_jobs, making this endpoint
 * the receipt seam the Studio UI was missing. Failure/uncertain states never
 * claim an upload and are left for a human to inspect.
 */
export async function GET() {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const channelRows = await db
    .select({
      id: channels.id,
      name: channels.name,
      language: channels.language,
      youtubeChannelId: channels.youtube_channel_id,
      isPrimary: channels.is_primary,
      uploaderChannelKey: channels.uploader_channel_key,
    })
    .from(channels)
    .where(eq(channels.accepts_tutorials, true));

  const uploaderSettings = await getUploaderSettings();
  const endpoint = uploaderSettings.dashboardApiUrl;
  const channelViews = channelRows.map((channel) => ({
    ...channel,
    channelUrl: channel.youtubeChannelId?.startsWith("UC")
      ? `https://www.youtube.com/channel/${channel.youtubeChannelId}`
      : null,
    studioUrl: channel.youtubeChannelId?.startsWith("UC")
      ? `https://studio.youtube.com/channel/${channel.youtubeChannelId}`
      : "https://studio.youtube.com/",
  }));

  try {
    const response = await fetch(endpoint, {
      headers: { "X-Authenticated-User": session.email ?? session.userId },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok)
      throw new Error(`uploader dashboard HTTP ${response.status}`);
    const raw = (await response.json()) as {
      source?: { state?: unknown; message?: unknown; read_at?: unknown };
      jobs?: DashboardJob[];
    };

    const jobs = (Array.isArray(raw.jobs) ? raw.jobs : []).map((job) => {
      const id = text(job.id) ?? "unknown";
      const sourceJobId = id.match(UUID_PREFIX)?.[1] ?? null;
      const videoId = text(job.outcome?.video_id);
      const visibility = text(job.outcome?.visibility);
      const scheduledFor = text(job.outcome?.scheduled_for);
      return {
        id,
        sourceJobId,
        channel: text(job.channel),
        profile: text(job.profile),
        title: text(job.title),
        state: text(job.state) ?? "unknown",
        progress:
          typeof job.progress === "number" && Number.isFinite(job.progress)
            ? Math.max(0, Math.min(100, job.progress))
            : 0,
        currentStep: text(job.current_step),
        startedAt: text(job.started_at),
        updatedAt: text(job.updated_at),
        finishedAt: text(job.finished_at),
        videoId: videoId && VIDEO_ID.test(videoId) ? videoId : null,
        visibility:
          visibility && VISIBILITIES.has(visibility) ? visibility : null,
        scheduledFor,
      };
    });

    // Dashboard history is newest-first. Reconcile only the newest successful
    // receipt for each source UUID, including a "-reconcile" operation.
    const reconciled = new Set<string>();
    for (const job of jobs) {
      if (
        job.state !== "succeeded" ||
        !job.sourceJobId ||
        !job.videoId ||
        reconciled.has(job.sourceJobId)
      )
        continue;
      reconciled.add(job.sourceJobId);
      const scheduledAt = safeDate(job.scheduledFor);
      const isActuallyPublic = job.visibility === "public";
      const isScheduled =
        job.visibility === "scheduled" || Boolean(scheduledAt);
      const completedAt = safeDate(job.finishedAt) ?? new Date();
      await db
        .update(tutorialJobs)
        .set({
          // A proven save is an upload even when the video remains private.
          // Reserve "scheduled" for a receipt with an actual publish time.
          uploader_status: isScheduled ? "scheduled" : "uploaded",
          youtube_visibility:
            job.visibility ?? (isActuallyPublic ? "public" : "private"),
          scheduled_for: scheduledAt,
          is_uploaded: isActuallyPublic,
          uploaded_at: isActuallyPublic ? completedAt : null,
          youtube_published_at: isActuallyPublic ? completedAt : null,
          uploader_last_callback_at: completedAt,
          upload_verified_at: completedAt,
          uploaded_by: "tutorial-uploader",
          youtube_upload_url: `https://www.youtube.com/watch?v=${job.videoId}`,
        })
        .where(eq(tutorialJobs.id, job.sourceJobId));
    }

    return NextResponse.json({
      connected: true,
      source: {
        state: text(raw.source?.state),
        message: text(raw.source?.message),
        readAt: text(raw.source?.read_at),
      },
      operationsUrl: uploaderSettings.operationsUrl,
      configuration: {
        enabled: uploaderSettings.enabled,
        executionMode: uploaderSettings.executionMode,
        transport: uploaderSettings.transport,
      },
      channels: channelViews,
      jobs,
    });
  } catch (error) {
    return NextResponse.json({
      connected: false,
      error: error instanceof Error ? error.message : "Uploader unavailable",
      operationsUrl: uploaderSettings.operationsUrl,
      configuration: {
        enabled: uploaderSettings.enabled,
        executionMode: uploaderSettings.executionMode,
        transport: uploaderSettings.transport,
      },
      channels: channelViews,
      jobs: [],
    });
  }
}

/**
 * Authenticated uploader callback. Events are idempotent by eventId and retain
 * scheduled/public truth separately, so a successful scheduled upload is not
 * falsely presented as already public.
 */
export async function POST(request: NextRequest) {
  if (!(await authorizedCallback(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    eventId?: unknown;
    jobId?: unknown;
    uploaderJobId?: unknown;
    status?: unknown;
    visibility?: unknown;
    scheduledFor?: unknown;
    youtubeVideoId?: unknown;
    youtubeUrl?: unknown;
    occurredAt?: unknown;
  } | null;
  const eventId = text(body?.eventId);
  const jobId = text(body?.jobId);
  const status = text(body?.status);
  const visibility = text(body?.visibility);
  if (!eventId || !jobId || !status || !UPLOADER_STATES.has(status)) {
    return NextResponse.json(
      { error: "eventId, jobId and a valid status are required" },
      { status: 400 },
    );
  }
  if (visibility && !VISIBILITIES.has(visibility)) {
    return NextResponse.json({ error: "Invalid visibility" }, { status: 400 });
  }

  const [current] = await db
    .select({ id: tutorialJobs.id, eventId: tutorialJobs.uploader_event_id })
    .from(tutorialJobs)
    .where(eq(tutorialJobs.id, jobId))
    .limit(1);
  if (!current)
    return NextResponse.json({ error: "Tutorial not found" }, { status: 404 });
  if (current.eventId === eventId) {
    return NextResponse.json({ ok: true, duplicate: true, jobId, status });
  }

  const happenedAt = safeDate(body?.occurredAt) ?? new Date();
  const scheduledFor = safeDate(body?.scheduledFor);
  const videoId = text(body?.youtubeVideoId);
  const suppliedUrl = text(body?.youtubeUrl);
  const youtubeUrl =
    suppliedUrl ??
    (videoId && VIDEO_ID.test(videoId)
      ? `https://www.youtube.com/watch?v=${videoId}`
      : undefined);
  const publicNow = status === "uploaded" && visibility === "public";

  await db
    .update(tutorialJobs)
    .set({
      uploader_status: status,
      youtube_visibility:
        visibility ?? (status === "scheduled" ? "scheduled" : undefined),
      scheduled_for: scheduledFor ?? undefined,
      uploader_job_id: text(body?.uploaderJobId) ?? undefined,
      uploader_event_id: eventId,
      uploader_last_callback_at: happenedAt,
      youtube_upload_url: youtubeUrl,
      is_uploaded: publicNow,
      uploaded_at: publicNow ? happenedAt : undefined,
      youtube_published_at: publicNow ? happenedAt : undefined,
      upload_verified_at: publicNow ? happenedAt : undefined,
      uploaded_by: "tutorial-uploader",
    })
    .where(eq(tutorialJobs.id, jobId));

  return NextResponse.json({ ok: true, duplicate: false, jobId, status });
}
