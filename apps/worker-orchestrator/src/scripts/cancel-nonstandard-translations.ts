/**
 * Cancel in-progress and queued translation jobs for non-standard languages.
 *
 * Enforces the 5-language constraint (German, French, Spanish, Japanese, Korean)
 * by cancelling all non-standard translation children currently queued or in-flight
 * and removing them from Redis BullMQ queues.
 *
 * Usage on VPS:
 *   cd /opt/tutorial-studio/apps/worker-orchestrator &&
 *   node --import tsx src/scripts/cancel-nonstandard-translations.ts
 */
import {
  createDrizzleClient,
  tutorialJobs,
  and,
  notInArray,
  isNotNull,
} from "@repo/db";
import {
  createRedisConnection,
  createTutorialTranslateQueue,
  createTutorialSpliceQueue,
} from "@repo/queue";
import { AUTOMATIC_TUTORIAL_LANGUAGE_CODES } from "@repo/contracts";

const DATABASE_URL = process.env["DATABASE_URL"];
const REDIS_URL = process.env["REDIS_URL"];
if (!DATABASE_URL || !REDIS_URL) {
  console.error("DATABASE_URL and REDIS_URL must be set");
  process.exit(1);
}

const ALLOWED_LANGS = [...AUTOMATIC_TUTORIAL_LANGUAGE_CODES];

async function main() {
  const db = createDrizzleClient(DATABASE_URL!);
  const conn = createRedisConnection({ url: REDIS_URL!, mode: "queue" });
  const translateQueue = createTutorialTranslateQueue(conn);
  const spliceQueue = createTutorialSpliceQueue(conn);

  console.log(`Scanning for non-standard translation jobs (allowed: ${ALLOWED_LANGS.join(", ")})...`);

  try {
    // 1. Find all translation children that are not in ALLOWED_LANGS and not already settled
    const pendingNonStandard = await db
      .select({
        id: tutorialJobs.id,
        sourceId: tutorialJobs.source_job_id,
        language: tutorialJobs.language,
        status: tutorialJobs.status,
        title: tutorialJobs.title,
      })
      .from(tutorialJobs)
      .where(
        and(
          isNotNull(tutorialJobs.source_job_id),
          notInArray(tutorialJobs.language, ALLOWED_LANGS),
          notInArray(tutorialJobs.status, ["COMPLETED", "CANCELLED"]),
        ),
      );

    console.log(`Found ${pendingNonStandard.length} active/pending non-standard translation jobs.`);

    let cancelledCount = 0;
    for (const job of pendingNonStandard) {
      // Mark as CANCELLED in DB
      await db
        .update(tutorialJobs)
        .set({
          status: "CANCELLED",
          error_message: `Cancelled: Translation restricted to 5 standard languages (${ALLOWED_LANGS.join(", ")})`,
          error_detail: JSON.stringify({
            stage: "translate_cancel",
            reason: "standard_language_filter",
            language: job.language,
            at: new Date().toISOString(),
          }),
        })
        .where(and(tutorialJobs.id.eq(job.id)));

      // Remove from translate queue if pending
      if (job.sourceId && job.language) {
        const translateJobId = `tutorial-translate-${job.sourceId}-${job.language}`;
        await translateQueue.remove(translateJobId).catch(() => {});
      }

      // Remove from splice queue if pending
      const spliceJobId = `tutorial-splice-${job.id}`;
      await spliceQueue.remove(spliceJobId).catch(() => {});

      cancelledCount++;
      console.log(`Cancelled [${job.language}] job ${job.id} (source: ${job.sourceId})`);
    }

    // 2. Also inspect BullMQ waiting translate jobs directly in Redis
    const waitingTranslateJobs = await translateQueue.getJobs(["waiting", "delayed"]);
    let queueRemovedCount = 0;
    for (const qj of waitingTranslateJobs) {
      const data = qj.data as { targetLanguage?: string; sourceJobId?: string };
      if (data.targetLanguage && !ALLOWED_LANGS.includes(data.targetLanguage.toLowerCase())) {
        await qj.remove().catch(() => {});
        queueRemovedCount++;
        console.log(`Removed translate queue job ${qj.id} for language [${data.targetLanguage}]`);
      }
    }

    console.log(
      JSON.stringify({
        success: true,
        allowed_languages: ALLOWED_LANGS,
        database_jobs_cancelled: cancelledCount,
        queue_jobs_removed: queueRemovedCount,
      }),
    );
  } finally {
    await conn.quit();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Cancellation failed:", err);
  process.exit(1);
});
