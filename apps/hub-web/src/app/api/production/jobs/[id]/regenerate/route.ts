import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getTutorialJobById, updateTutorialJob } from "@repo/db";
import {
  createRedisConnection,
  createTutorialGenerateQueue,
  createTutorialSpliceQueue,
} from "@repo/queue";

export const dynamic = "force-dynamic";

const RegenerateSchema = z.object({
  /**
   * "splice" re-runs only the ffmpeg mux. A job wedged in SPLICING already has
   * a good script, good TTS and — most importantly — the VA's recording, so
   * retrying it as "script" would throw all three away and make them record
   * the whole tutorial again.
   */
  target: z.enum(["script", "audio", "splice"]),
  /**
   * Bypass the in-progress guard below. Set by the studio's "Force retry"
   * button, which is only rendered once a job has sat in one status far past
   * its expected duration — i.e. precisely when the worker is presumed dead
   * and the job will never leave that status on its own.
   */
  force: z.boolean().default(false),
});

/**
 * POST /api/production/jobs/[id]/regenerate
 * Re-queue a job for script or audio re-generation.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission(session, "create:tutorial-job")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const job = await getTutorialJobById(db, id);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = job.created_by === session.userId;
  const isPrivileged =
    hasPermission(session, "manage:tutorial-settings") ||
    session.role === "ADMIN" ||
    session.role === "MANAGER";

  if (!isOwner && !isPrivileged) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = RegenerateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { target, force } = parsed.data;

  // Reject when the job is already in progress — otherwise a button-spam
  // would queue parallel BullMQ jobs that all hit the LLM, all write to
  // the same row, and burn tokens for nothing. Only allow regeneration
  // from a settled (failed or finished) state.
  //
  // `force` is the deliberate escape hatch. Without it this guard made the
  // studio's "Force retry" button impossible to use: that button only renders
  // while the job is in one of these very statuses, so every click was a
  // guaranteed 409 and the job stayed wedged forever.
  const IN_PROGRESS = new Set([
    "QUEUED",
    "GENERATING_SCRIPT",
    "GENERATING_AUDIO",
    "SPLICING",
  ]);
  if (IN_PROGRESS.has(job.status) && !force) {
    return NextResponse.json(
      {
        error: `Job is already ${job.status.replace(/_/g, " ").toLowerCase()} — wait for it to finish or fail before retrying.`,
      },
      { status: 409 },
    );
  }

  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl) {
    return NextResponse.json({ error: "REDIS_URL not set" }, { status: 500 });
  }

  if (target === "splice") {
    if (!job.recording_path || !job.audio_path) {
      return NextResponse.json(
        {
          error:
            "Cannot re-splice: this job has no recording and/or no TTS audio yet.",
        },
        { status: 409 },
      );
    }
  }

  // Enqueue FIRST, flip DB status SECOND. If enqueue throws, the job row
  // stays in its current failed/completed state, and the user can simply
  // retry — instead of being stuck in QUEUED forever with no worker.
  const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
  try {
    if (target === "splice") {
      const queue = createTutorialSpliceQueue(conn);
      await queue.add(
        "tutorial-splice",
        { jobId: id },
        { jobId: `tutorial-splice-regen-${id}-${Date.now()}`, attempts: 2 },
      );
    } else {
      const stage = target === "script" ? "script" : "tts";
      const queue = createTutorialGenerateQueue(conn);
      await queue.add(
        "tutorial-generate",
        { jobId: id, stage },
        {
          jobId: `tutorial-${stage}-regen-${id}-${Date.now()}`,
          attempts: 2,
        },
      );
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to enqueue retry: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  } finally {
    await conn.quit();
  }

  if (target === "splice") {
    // Keep script/audio/recording — only the mux is being redone.
    await updateTutorialJob(db, id, {
      status: "SPLICING",
      progress: 90,
      final_path: null,
      error_stage: null,
      error_message: null,
      error_detail: null,
    });
  } else if (target === "script") {
    await updateTutorialJob(db, id, {
      status: "QUEUED",
      progress: 0,
      script_text: null,
      audio_path: null,
      audio_duration_s: null,
      audio_done_at: null,
      final_path: null,
      script_done_at: null,
      error_stage: null,
      error_message: null,
      error_detail: null,
    });
  } else {
    // audio only
    await updateTutorialJob(db, id, {
      status: "GENERATING_AUDIO",
      progress: 40,
      audio_path: null,
      audio_duration_s: null,
      audio_done_at: null,
      final_path: null,
      error_stage: null,
      error_message: null,
      error_detail: null,
    });
  }

  return NextResponse.json({ success: true });
}
