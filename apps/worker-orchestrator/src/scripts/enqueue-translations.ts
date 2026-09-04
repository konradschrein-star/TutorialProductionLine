/**
 * Batch-enqueue tutorial translations for all imported English source jobs.
 *
 * Mirrors /api/production/tutorial-translate/enqueue exactly (same queue, job
 * name, idempotent jobId, skip-if-child-exists) but runs server-side over the
 * whole back-catalog. The unattended language set is compiled into
 * @repo/contracts; environment values cannot widen it. Other knobs still
 * allow a one-source pilot before the full run:
 *
 *   DATABASE_URL, REDIS_URL      (from /opt/tutorial-studio/.env)
 *   BATCH_LIMIT=1                 (optional — only the first N source jobs)
 *   BATCH_SOURCE_ID=<uuid>        (optional — only this one source job)
 *   DRY_RUN=1                     (optional — plan only, enqueue nothing)
 *
 * Run on the VPS:  cd /opt/tutorial-studio/apps/worker-orchestrator &&
 *   node --import tsx src/scripts/enqueue-translations.ts
 */
import { existsSync } from "node:fs";
import {
  createDrizzleClient,
  tutorialJobs,
  eq,
  and,
  isNull,
} from "@repo/db";
import {
  createRedisConnection,
  createTutorialTranslateQueue,
} from "@repo/queue";
import { AUTOMATIC_TUTORIAL_LANGUAGE_CODES } from "@repo/contracts";

const DATABASE_URL = process.env["DATABASE_URL"];
const REDIS_URL = process.env["REDIS_URL"];
if (!DATABASE_URL || !REDIS_URL) {
  console.error("DATABASE_URL and REDIS_URL must be set");
  process.exit(1);
}

const LANGS = [...AUTOMATIC_TUTORIAL_LANGUAGE_CODES];

const LIMIT = process.env["BATCH_LIMIT"]
  ? parseInt(process.env["BATCH_LIMIT"], 10)
  : undefined;
const ONLY_SOURCE = process.env["BATCH_SOURCE_ID"];
const DRY_RUN = process.env["DRY_RUN"] === "1";

async function main() {
  const db = createDrizzleClient(DATABASE_URL!);

  const baseWhere = and(
    eq(tutorialJobs.language, "en"),
    eq(tutorialJobs.status, "COMPLETED"),
    isNull(tutorialJobs.source_job_id),
  );

  let sources = await db
    .select({
      id: tutorialJobs.id,
      title: tutorialJobs.title,
      recording: tutorialJobs.recording_path,
      script: tutorialJobs.script_text,
    })
    .from(tutorialJobs)
    .where(baseWhere)
    .orderBy(tutorialJobs.created_at);

  if (ONLY_SOURCE) sources = sources.filter((s) => s.id === ONLY_SOURCE);
  if (LIMIT !== undefined) sources = sources.slice(0, LIMIT);

  const conn = createRedisConnection({ url: REDIS_URL!, mode: "queue" });
  const queue = createTutorialTranslateQueue(conn);

  let enq = 0;
  let skippedNoFile = 0;
  let skippedExisting = 0;
  try {
    for (const s of sources) {
      if (!s.recording || !s.script) {
        skippedNoFile++;
        continue;
      }
      if (!existsSync(s.recording)) {
        skippedNoFile++;
        console.log(`skip (no recording file): ${s.id} ${s.title?.slice(0, 50)}`);
        continue;
      }
      for (const lang of LANGS) {
        const [existing] = await db
          .select({ id: tutorialJobs.id })
          .from(tutorialJobs)
          .where(
            and(
              eq(tutorialJobs.source_job_id, s.id),
              eq(tutorialJobs.language, lang),
            ),
          )
          .limit(1);
        if (existing) {
          skippedExisting++;
          continue;
        }
        if (!DRY_RUN) {
          const jid = `tutorial-translate-${s.id}-${lang}`;
          // Clear any stale completed/failed job with this id so re-runs aren't
          // silently deduped by BullMQ (no-op if absent or currently active).
          await queue.remove(jid).catch(() => {});
          await queue.add(
            "tutorial-translate",
            { sourceJobId: s.id, targetLanguage: lang },
            { jobId: jid, attempts: 2 },
          );
        }
        enq++;
      }
    }
  } finally {
    await conn.quit();
  }

  console.log(
    JSON.stringify({
      dry_run: DRY_RUN,
      source_jobs: sources.length,
      languages: LANGS,
      enqueued: enq,
      skipped_no_recording: skippedNoFile,
      skipped_existing_child: skippedExisting,
    }),
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("enqueue failed:", e);
  process.exit(1);
});
