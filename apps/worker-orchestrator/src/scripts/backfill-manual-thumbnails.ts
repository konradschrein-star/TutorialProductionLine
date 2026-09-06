/** Create English + four launch-language manual thumbnails for every finished source video. */
import { config } from "dotenv";
import { resolve } from "node:path";
import { and, createDrizzleClient, eq, inArray, isNotNull, isNull, tutorialJobs } from "@repo/db";
import { ensureManualTutorialThumbnail } from "../utils/tutorial/manual-thumbnail.js";

config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env"), override: false });

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const db = createDrizzleClient(databaseUrl);
const forceRender = process.env["FORCE_RENDER"] === "1";
const jobs = await db.select({
  id: tutorialJobs.id,
  title: tutorialJobs.title,
  language: tutorialJobs.language,
  channel_id: tutorialJobs.channel_id,
}).from(tutorialJobs).where(and(
  eq(tutorialJobs.status, "COMPLETED"),
  isNull(tutorialJobs.parent_job_id),
  isNotNull(tutorialJobs.final_path),
  inArray(tutorialJobs.language, ["English", "en"]),
  isNull(tutorialJobs.source_job_id),
)).orderBy(tutorialJobs.created_at);

let created = 0;
let existing = 0;
let failed = 0;
const languages = ["en", "de", "fr", "it", "nl", "sv"];
for (let offset = 0; offset < jobs.length; offset += 4) {
  await Promise.all(jobs.slice(offset, offset + 4).flatMap((job) =>
    languages.map(async (targetLanguage) => {
      try {
        const result = await ensureManualTutorialThumbnail(db, job, { forceRender, targetLanguage });
        if (result.created) created += 1;
        else existing += 1;
      } catch (error) {
        failed += 1;
        console.error(JSON.stringify({ job_id: job.id, language: targetLanguage, error: error instanceof Error ? error.message : String(error) }));
      }
    }),
  ));
  if ((created + existing + failed) % 40 === 0) console.log(JSON.stringify({ processed: created + existing + failed, created, existing, failed }));
}
console.log(JSON.stringify({ complete: true, total: jobs.length * languages.length, created, existing, failed }));
process.exit(failed > 0 ? 1 : 0);
