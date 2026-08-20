import { access } from "node:fs/promises";
import { join } from "node:path";
import type { Queue } from "bullmq";
import { inArray, and, isNotNull } from "drizzle-orm";
import { tutorialJobs, updateTutorialJob } from "@repo/db";
import type { DrizzleClient } from "@repo/db";
import type { TutorialSplicePayload } from "@repo/contracts";

const LOCAL_MEDIA_ROOT =
  process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";

/**
 * On startup, recover tutorial jobs left in SPLICING or AWAITING_UPLOAD
 * after a worker process was killed mid-splice.
 *
 *   final.mp4 on disk → FFmpeg finished but DB update was lost → COMPLETED
 *   final.mp4 missing → FFmpeg never finished → re-enqueue splice job
 */
export async function reconcileSplicingJobs(
  db: DrizzleClient,
  tutorialSpliceQueue: Queue<TutorialSplicePayload>,
): Promise<void> {
  try {
    const stuck = await db
      .select({
        id: tutorialJobs.id,
        title: tutorialJobs.title,
        status: tutorialJobs.status,
        recording_path: tutorialJobs.recording_path,
        audio_path: tutorialJobs.audio_path,
      })
      .from(tutorialJobs)
      .where(
        and(
          inArray(tutorialJobs.status, ["SPLICING", "AWAITING_UPLOAD"]),
          isNotNull(tutorialJobs.recording_path),
          isNotNull(tutorialJobs.audio_path),
        ),
      )
      .limit(50);

    if (stuck.length === 0) return;

    console.log(
      JSON.stringify({
        level: "info",
        message: `[splice-reconciler] ${stuck.length} stuck job(s) — checking disk`,
        jobs: stuck.map((r) => `${r.status}:${r.id.slice(0, 8)}`),
      }),
    );

    for (const row of stuck) {
      const expectedFinal = join(
        LOCAL_MEDIA_ROOT,
        "tutorial",
        row.id,
        "final.mp4",
      );

      const finalExists = await access(expectedFinal)
        .then(() => true)
        .catch(() => false);

      if (finalExists) {
        // Route through updateTutorialJob so the Video ERP status webhook fires
        // for reconciler-driven completions too (single choke-point).
        await updateTutorialJob(db, row.id, {
          status: "COMPLETED",
          final_path: expectedFinal,
          completed_at: new Date(),
          progress: 100,
        });

        console.log(
          JSON.stringify({
            level: "info",
            message: "[splice-reconciler] Recovered completed job",
            job_id: row.id,
            title: row.title,
            final_path: expectedFinal,
          }),
        );
      } else {
        // FFmpeg never finished — reset to AWAITING_UPLOAD and re-enqueue.
        await updateTutorialJob(db, row.id, {
          status: "AWAITING_UPLOAD",
          progress: 90,
        });

        await tutorialSpliceQueue.add(
          "tutorial-splice",
          { jobId: row.id },
          { jobId: `tutorial-splice-${row.id}`, attempts: 2 },
        );

        console.log(
          JSON.stringify({
            level: "info",
            message: "[splice-reconciler] Re-enqueued incomplete splice",
            job_id: row.id,
            title: row.title,
          }),
        );
      }
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "[splice-reconciler] Startup reconcile failed (non-fatal)",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
