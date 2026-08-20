import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { videoStitchJobs } from "@repo/db";
import { VideoStitchPayloadSchema } from "@repo/contracts";
import { createRedisConnection, createVideoStitchQueue } from "@repo/queue";

export const dynamic = "force-dynamic";

// Option fields the "finish this job" panel may override on a DRAFT before it
// starts (captions / music / transitions). Only these keys are applied.
const ALLOWED_OVERRIDES = [
  "captions_enabled",
  "caption_preset_id",
  "caption_config",
  "remotion_enabled",
  "remotion_preset_id",
  "music_enabled",
  "music_tracks",
  "music_volume",
  "transition_type",
  "transition_duration_seconds",
  "speed_adjust_mode",
  "output_filename",
] as const;

/**
 * POST /api/video-stitch/jobs/[id]/start
 *
 * Transitions a DRAFT stitch job to PENDING and enqueues it for processing.
 * DRAFT jobs are created by send-to-stitcher for LONG_FORM tutorial handoffs
 * and are not auto-enqueued, so the VA can review (and optionally enable
 * captions/music) before starting. An optional JSON body may carry the VA's
 * chosen option overrides (ALLOWED_OVERRIDES), applied to the draft on start.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // create:job (ADMIN/MANAGER) OR a tutorial VA starting their own handoff
  // draft (ownership enforced below). Tutorial VAs reach here via the
  // long-form send-to-stitcher flow.
  const session = await getSession();
  if (
    !session ||
    (!hasPermission(session, "create:job") &&
      !hasPermission(session, "create:tutorial-job"))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const [job] = await db
    .select()
    .from(videoStitchJobs)
    .where(eq(videoStitchJobs.id, id));

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Owners can start their own draft; create:job holders can start any.
  if (
    job.created_by_user_id !== session.userId &&
    !hasPermission(session, "create:job")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (job.status !== "DRAFT") {
    return NextResponse.json(
      { error: `Job is ${job.status}, not DRAFT` },
      { status: 409 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const overrides: Record<string, unknown> = {};
  for (const key of ALLOWED_OVERRIDES) {
    if (body[key] !== undefined) overrides[key] = body[key];
  }

  await db
    .update(videoStitchJobs)
    .set({
      ...(overrides as Partial<typeof videoStitchJobs.$inferInsert>),
      status: "PENDING",
      updated_at: new Date(),
    })
    .where(eq(videoStitchJobs.id, id));

  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl) {
    return NextResponse.json(
      { error: "REDIS_URL not configured" },
      { status: 500 },
    );
  }

  const redis = createRedisConnection({ url: redisUrl, mode: "queue" });
  try {
    const queue = createVideoStitchQueue(redis);
    const payload = VideoStitchPayloadSchema.parse({ job_id: id, priority: 5 });
    await queue.add("video-stitch", payload, {
      jobId: id,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    });
  } finally {
    await redis.quit();
  }

  return NextResponse.json({ job_id: id, status: "PENDING" });
}
