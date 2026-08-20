import { stat } from "node:fs/promises";
import { eq, and, inArray, isNull, isNotNull } from "drizzle-orm";
import { tutorialJobs, videoStitchJobs, updateTutorialJob } from "@repo/db";
import type { DrizzleClient } from "@repo/db";

/**
 * Stitch-path reconciler — the counterpart to splice-reconciler for LONG_FORM
 * tutorial parents.
 *
 * WHY THIS EXISTS
 * ---------------
 * stitch-processor.ts promotes a LONG_FORM parent to COMPLETED after a
 * successful render. For 45 days that code was not in the deployed bundle at
 * all: pm2 ran a dist/ compiled 2026-06-19, and the app appeared nowhere in
 * .github/workflows/ci.yml, so nothing ever rebuilt it. 28 finished videos sat
 * invisible for up to 28 days and never reached Google Drive.
 *
 * The rebuild fixed the forward path. This exists so that a *future* missed
 * write-back — a DB blip, a worker killed between the render and the update, a
 * BullMQ stall that skips the processor's catch entirely — costs minutes
 * instead of a month. A best-effort state write with no reconciler behind it is
 * a silent data-loss channel.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 *  - It never STARTS a render. That gate is intentionally human
 *    (/tutorial-studio/video-stitcher) and is a product decision, not a bug.
 *  - It never touches child rows. Children rest at RECORDED by design; fixing
 *    the parent is what resolves them.
 *  - It never retries FAILED work. Some failures are 27+ days old and may fail
 *    for good reasons. It names them, loudly, and stops.
 *  - It never estimates missing data. A NULL output path or an absent file
 *    means the job is SURFACED, not guessed at. Promoting a job whose artifact
 *    is gone would write a COMPLETED row pointing at nothing, which the Drive
 *    scanner would then fail on forever.
 */

/** Poll cadence. Startup-only is exactly why the original bug hid for 45 days. */
const POLL_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Grace period before promoting a freshly-rendered job. The processor's own
 * write-back is the fast path and must stay the fast path; this only covers
 * the case where it did not happen.
 */
const PROMOTE_GRACE_MS = 10 * 60 * 1000;

/** Anything non-terminal older than this gets a loud, countable signal. */
const STALE_ALARM_MS = 24 * 60 * 60 * 1000;

type AnomalyKind =
  | "ARTIFACT_GONE"
  | "MISSING_OUTPUT_PATH"
  | "DANGLING_STITCH_REF"
  | "STITCH_FAILED"
  | "AWAITING_HUMAN_RENDER";

type Anomaly = {
  kind: AnomalyKind;
  job_id: string;
  title: string;
  detail: string;
  age_hours: number;
};

function log(level: "info" | "warn" | "error", message: string, extra: object) {
  console.log(
    JSON.stringify({
      level,
      message,
      ...extra,
      timestamp: new Date().toISOString(),
    }),
  );
}

const ageHours = (d: Date | null): number =>
  d === null ? -1 : Math.round((Date.now() - d.getTime()) / 36e5);

/**
 * Trust the filesystem over DB status — the whole point of the reconciler
 * pattern. Returns byte count, or null if this is not a real non-empty file.
 * Never invents a path.
 */
async function verifyArtifact(path: string): Promise<number | null> {
  try {
    const s = await stat(path);
    if (!s.isFile() || s.size === 0) return null;
    return s.size;
  } catch {
    return null;
  }
}

/** PASS 1 — promote parents whose stitch job genuinely finished. */
async function promoteFinished(
  db: DrizzleClient,
  anomalies: Anomaly[],
): Promise<number> {
  const rows = await db
    .select({
      id: tutorialJobs.id,
      title: tutorialJobs.title,
      parent_status: tutorialJobs.status,
      updated_at: tutorialJobs.updated_at,
      stitch_id: videoStitchJobs.id,
      stitch_status: videoStitchJobs.status,
      output_video_path: videoStitchJobs.output_video_path,
      output_duration_seconds: videoStitchJobs.output_duration_seconds,
      render_completed_at: videoStitchJobs.render_completed_at,
    })
    .from(tutorialJobs)
    .innerJoin(
      videoStitchJobs,
      eq(videoStitchJobs.id, tutorialJobs.stitch_job_id),
    )
    .where(
      and(
        eq(tutorialJobs.mode, "LONG_FORM"),
        isNull(tutorialJobs.parent_job_id),
        eq(tutorialJobs.status, "SENT_TO_STITCHER"),
      ),
    )
    .limit(200);

  let promoted = 0;

  for (const row of rows) {
    const age = ageHours(row.updated_at);

    if (row.stitch_status === "FAILED") {
      // The processor now mirrors failures onto the parent, so reaching here
      // means that write was itself missed. Surface it; never auto-retry.
      anomalies.push({
        kind: "STITCH_FAILED",
        job_id: row.id,
        title: row.title,
        detail: `stitch job ${row.stitch_id} is FAILED but the parent was never marked — needs a human, NOT a blind retry`,
        age_hours: age,
      });
      continue;
    }

    if (row.stitch_status !== "RENDERED" && row.stitch_status !== "UPLOADED") {
      // DRAFT / PENDING / PROCESSING — the render is the deliberate human gate.
      // Not an error, but it must be countable if nobody ever presses it.
      if (Date.now() - row.updated_at.getTime() > STALE_ALARM_MS) {
        anomalies.push({
          kind: "AWAITING_HUMAN_RENDER",
          job_id: row.id,
          title: row.title,
          detail: `stitch job ${row.stitch_id} is ${row.stitch_status} — waiting on the manual render gate in /tutorial-studio/video-stitcher`,
          age_hours: age,
        });
      }
      continue;
    }

    // Don't race the processor's own write-back on a fresh render.
    if (
      row.render_completed_at !== null &&
      Date.now() - row.render_completed_at.getTime() < PROMOTE_GRACE_MS
    ) {
      continue;
    }

    // NO SYNTHETIC FALLBACKS: a RENDERED job with no output path is a data
    // integrity fault, not something to reconstruct from the job id.
    if (!row.output_video_path) {
      anomalies.push({
        kind: "MISSING_OUTPUT_PATH",
        job_id: row.id,
        title: row.title,
        detail: `stitch job ${row.stitch_id} is ${row.stitch_status} but output_video_path is NULL — refusing to guess a path`,
        age_hours: age,
      });
      continue;
    }

    const bytes = await verifyArtifact(row.output_video_path);
    if (bytes === null) {
      anomalies.push({
        kind: "ARTIFACT_GONE",
        job_id: row.id,
        title: row.title,
        detail: `stitch ${row.stitch_status} but ${row.output_video_path} is missing or empty — re-stitch or recover, do NOT force-promote`,
        age_hours: age,
      });
      continue;
    }

    // Route through updateTutorialJob so the Video ERP status webhook fires for
    // reconciler-driven completions too — the single choke-point, same
    // reasoning as splice-reconciler.
    await updateTutorialJob(db, row.id, {
      status: "COMPLETED",
      final_path: row.output_video_path,
      completed_at: row.render_completed_at ?? new Date(),
      progress: 100,
      // Duration ONLY when the stitch row actually recorded one. Never derived.
      ...(row.output_duration_seconds !== null
        ? { recording_duration_s: String(row.output_duration_seconds) }
        : {}),
    });

    promoted++;
    log("warn", "[stitch-reconciler] promoted stranded parent to COMPLETED", {
      job_id: row.id,
      title: row.title,
      stitch_status: row.stitch_status,
      final_path: row.output_video_path,
      bytes,
      stranded_hours: age,
      note: "the processor write-back did not land — investigate why",
    });
  }

  return promoted;
}

/**
 * PASS 2 — surface what must never be auto-fixed.
 *
 * Parents pointing at a stitch row that no longer exists. The leftJoin + IS NULL
 * is the point: an innerJoin silently hides these, which is how one stayed
 * invisible for a week.
 */
async function surfaceDangling(
  db: DrizzleClient,
  anomalies: Anomaly[],
): Promise<void> {
  const dangling = await db
    .select({
      id: tutorialJobs.id,
      title: tutorialJobs.title,
      stitch_job_id: tutorialJobs.stitch_job_id,
      updated_at: tutorialJobs.updated_at,
    })
    .from(tutorialJobs)
    .leftJoin(
      videoStitchJobs,
      eq(videoStitchJobs.id, tutorialJobs.stitch_job_id),
    )
    .where(
      and(
        isNotNull(tutorialJobs.stitch_job_id),
        isNull(videoStitchJobs.id),
        inArray(tutorialJobs.status, ["SENT_TO_STITCHER", "READY_TO_STITCH"]),
      ),
    )
    .limit(50);

  for (const row of dangling) {
    anomalies.push({
      kind: "DANGLING_STITCH_REF",
      job_id: row.id,
      title: row.title,
      detail: `stitch_job_id ${row.stitch_job_id} does not exist in video_stitch_jobs — the row was deleted and no video was produced. Cannot self-heal: clearing stitch_job_id and resetting to READY_TO_STITCH is a deliberate human repair.`,
      age_hours: ageHours(row.updated_at),
    });
  }
}

export async function reconcileStitchJobs(db: DrizzleClient): Promise<void> {
  const startedAt = Date.now();
  const anomalies: Anomaly[] = [];
  let promoted = 0;

  try {
    promoted = await promoteFinished(db, anomalies);
    await surfaceDangling(db, anomalies);
  } catch (err) {
    // A pass that throws must be loud. Swallowing this is the original sin of
    // this entire pipeline.
    log("error", "[stitch-reconciler] cycle FAILED", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      promoted_before_failure: promoted,
    });
    return;
  }

  const byKind = anomalies.reduce<Record<string, number>>((acc, a) => {
    acc[a.kind] = (acc[a.kind] ?? 0) + 1;
    return acc;
  }, {});

  // One countable line EVERY cycle, always. Silence was the root cause: a cycle
  // that logs nothing is indistinguishable from a cycle that never ran, which
  // is precisely how this stayed hidden.
  log(
    anomalies.length > 0 ? "warn" : "info",
    "[stitch-reconciler] cycle complete",
    {
      promoted,
      anomalies: anomalies.length,
      by_kind: byKind,
      duration_ms: Date.now() - startedAt,
    },
  );

  for (const a of anomalies) {
    log("error", "[stitch-reconciler] NEEDS HUMAN", {
      kind: a.kind,
      job_id: a.job_id,
      title: a.title,
      age_hours: a.age_hours,
      detail: a.detail,
    });
  }
}

/** Runs once at startup + every 10 minutes thereafter. */
export function startStitchReconcilerInterval(
  db: DrizzleClient,
  intervalMs: number = POLL_INTERVAL_MS,
): NodeJS.Timeout {
  void reconcileStitchJobs(db);
  return setInterval(() => {
    void reconcileStitchJobs(db);
  }, intervalMs);
}
