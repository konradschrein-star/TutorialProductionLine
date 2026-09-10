import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { channels, db, tutorialJobs, tutorialJobEvents } from "@/lib/db";
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
 * Dashboard observations are not revision-bound receipts. Never project them
 * into verified publication state or mutate Studio's reserved publication time.
 */
export async function GET() {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (session.role !== "ADMIN") {
    return NextResponse.json({ connected: false, error: "Uploader network details are Admin-only. Your Delivery rows show your own receipt state.", operationsUrl: "/uploader-ops/", channels: [], jobs: [], inspectionOnly: true });
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

    return NextResponse.json({
      connected: true,
      inspectionOnly: true,
      verification: "Unverified dashboard observations; use revision-bound receipts for delivery truth.",
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
 * Preserve authenticated legacy callback evidence without claiming a verified
 * upload. This protocol has no approved revision or manifest hash. Duplicate
 * event IDs are durable across intervening callbacks and concurrent requests.
 */
export async function POST(request: NextRequest) {
  if (!(await authorizedCallback(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = z.object({ eventId: z.string().min(1).max(128), jobId: z.string().uuid(), uploaderJobId: z.string().max(128).optional(), status: z.string().refine((value) => UPLOADER_STATES.has(value)), visibility: z.string().refine((value) => VISIBILITIES.has(value)).optional(), scheduledFor: z.string().datetime().optional(), occurredAt: z.string().datetime().optional(), youtubeVideoId: z.string().regex(VIDEO_ID).optional(), youtubeUrl: z.string().url().max(1000).optional() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid callback identity, status or timestamp." }, { status: 400 });
  const { eventId, jobId, ...observation } = parsed.data;
  const payload = { ...observation, verified: false, reason: "Legacy callback has no approved asset revision or manifest hash." };
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ id: tutorialJobs.id }).from(tutorialJobs).where(eq(tutorialJobs.id, jobId)).for("update");
    if (!current) return NextResponse.json({ error: "Tutorial not found" }, { status: 404 });
    const [existing] = await tx.select({ payload: tutorialJobEvents.payload }).from(tutorialJobEvents).where(and(eq(tutorialJobEvents.tutorial_job_id, jobId), eq(tutorialJobEvents.event_type, "external_observation"), eq(tutorialJobEvents.event_key, eventId)));
    if (existing) {
      const same = Object.keys(payload).length === Object.keys(existing.payload).length && Object.entries(payload).every(([key, value]) => existing.payload[key] === value);
      if (!same) return NextResponse.json({ error: "This event ID already contains different evidence. Original observation retained." }, { status: 409 });
      return NextResponse.json({ ok: true, duplicate: true, verified: false, jobId, status: observation.status });
    }
    await tx.insert(tutorialJobEvents).values({ tutorial_job_id: jobId, event_type: "external_observation", event_key: eventId, payload });
    return NextResponse.json({ ok: true, duplicate: false, verified: false, jobId, status: observation.status, reconciliationRequired: true }, { status: 202 });
  });
}
