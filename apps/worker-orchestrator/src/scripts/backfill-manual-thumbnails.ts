/** Create one owned manual thumbnail for every finished active-language variant. */
import { config } from "dotenv";
import { resolve } from "node:path";
import {
  and,
  createDrizzleClient,
  eq,
  inArray,
  isNotNull,
  isNull,
  storageArtifacts,
  tutorialJobs,
} from "@repo/db";
import { ensureManualTutorialThumbnail } from "../utils/tutorial/manual-thumbnail.js";

config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env"), override: false });

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const db = createDrizzleClient(databaseUrl);
const forceRender = process.env["FORCE_RENDER"] === "1";
const jobs = await db
  .select({
    id: tutorialJobs.id,
    title: tutorialJobs.title,
    language: tutorialJobs.language,
    channel_id: tutorialJobs.channel_id,
    source_job_id: tutorialJobs.source_job_id,
    thumbnail_text_top: tutorialJobs.thumbnail_text_top,
    thumbnail_text_bottom: tutorialJobs.thumbnail_text_bottom,
  })
  .from(tutorialJobs)
  .where(
    and(
      eq(tutorialJobs.status, "COMPLETED"),
      isNull(tutorialJobs.parent_job_id),
      isNotNull(tutorialJobs.final_path),
      inArray(tutorialJobs.language, ["English", "en", "de", "fr", "it", "sv"]),
    ),
  )
  .orderBy(tutorialJobs.created_at);

let created = 0;
let existing = 0;
let failed = 0;
for (let offset = 0; offset < jobs.length; offset += 4) {
  await Promise.all(
    jobs.slice(offset, offset + 4).map(async (job) => {
      try {
        const result = await ensureManualTutorialThumbnail(db, job, {
          forceRender,
        });
        if (forceRender) {
          // `ensureManualTutorialThumbnail` updates the selected local asset,
          // but the Drive scanner normally sees a settled thumbnail artifact
          // and correctly skips it. Re-open only that thumbnail artifact so
          // the scanner replaces the old Drive file with the newly rendered
          // bytes. Jobs that have never shipped a thumbnail have no row yet;
          // their normal first delivery remains unchanged.
          await db
            .update(storageArtifacts)
            .set({
              state: "pending",
              error_kind: "thumbnail_replaced",
              error_message:
                "Thumbnail bulk refresh completed; replace Drive copy",
              updated_at: new Date(),
            })
            .where(
              and(
                eq(storageArtifacts.job_id, job.id),
                eq(storageArtifacts.owner_kind, "tutorial_job"),
                eq(storageArtifacts.kind, "thumbnail"),
              ),
            );
        }
        if (result.created) created += 1;
        else existing += 1;
      } catch (error) {
        failed += 1;
        console.error(
          JSON.stringify({
            job_id: job.id,
            language: job.language,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }),
  );
  if ((created + existing + failed) % 40 === 0)
    console.log(
      JSON.stringify({
        processed: created + existing + failed,
        created,
        existing,
        failed,
      }),
    );
}
console.log(
  JSON.stringify({
    complete: true,
    total: jobs.length,
    created,
    existing,
    failed,
  }),
);
process.exit(failed > 0 ? 1 : 0);
