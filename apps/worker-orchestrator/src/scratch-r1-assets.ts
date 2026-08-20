/**
 * SCRATCH (task R1) — create the v3 job and run the BUSINESS_PLAN_HUB asset
 * stage in-process.
 *
 * Drives `runBusinessHubAssetStage` directly: script (authored onto the row) ->
 * Fish TTS -> Whisper -> planner -> visual sourcing -> plates. The queue and the
 * UI are not involved; only the final QMS transition touches BullMQ.
 *
 * usage: tsx src/scratch-r1-assets.ts <script-file> [existing-job-id]
 */
import "./scratch-r1-env.js";

import { readFile } from "node:fs/promises";

import { Queue } from "bullmq";
import { eq } from "drizzle-orm";

import { loadConfig, getConfig } from "@repo/config";
import { createDrizzleClient, contentJobs, contentTemplates } from "@repo/db";
import { initializeDb } from "@repo/db/singleton";

import { runBusinessHubAssetStage } from "./processors/business-hub/pipeline.js";

const TEMPLATE_ID = "2ad9ad0f-64cf-4807-9651-f402a3782f09";
const CHANNEL_ID = "ee6a2526-5c61-42d2-aa3f-be32aabbc9d7";
const TOPIC = "How to write a business plan for a bakery";
/** `tts_voices` row: Fish — Analytical Male (provider Fish, en). */
const VOICE_ROW_ID = "d2070eba-df24-4d74-acdc-dd5ff27daa1a";

const scriptPath = process.argv[2];
const existingJobId = process.argv[3];
if (scriptPath === undefined) {
  throw new Error("usage: scratch-r1-assets.ts <script-file> [job-id]");
}

async function main(): Promise<void> {
  loadConfig();
  const cfg = getConfig();
  const db = createDrizzleClient(cfg.DATABASE_URL);
  initializeDb(cfg.DATABASE_URL);

  const script = (await readFile(scriptPath, "utf8")).trim();
  if (script.length === 0) throw new Error(`${scriptPath} is empty`);

  let jobId: string;
  if (existingJobId !== undefined) {
    jobId = existingJobId;
    console.log(`[r1] reusing job ${jobId}`);
  } else {
    const [row] = await db
      .insert(contentJobs)
      .values({
        channel_id: CHANNEL_ID,
        template_id: TEMPLATE_ID,
        status: "ASSET_COLLECTION",
        status_updated_at: new Date(),
        production_version: "V3",
        format: "BUSINESS_PLAN_HUB",
        language: "en",
        initial_topic: TOPIC,
        title: TOPIC,
        description: "R1 v3 render — BUSINESS_PLAN_HUB, presenter visible.",
        script,
        aspect_ratio: "16:9",
        // The scene timeline is anchored to the MEASURED narration, never to
        // this. 23 beats of ~28 words at Fish's measured ~190wpm.
        target_duration_seconds: 210,
        render_engine: "REMOTION",
        metadata: {
          business_hub: {
            family: "how-to-write-for",
            topic: TOPIC,
            target_seconds: 210,
            // Design §3.4 — the photographic torso with the flat logo head.
            // v2 shipped "none" and Konrad's note on it was "NO NARRATOR
            // ANYWHERE"; 7 of the 16 poses are calibrated now, and the plan
            // places 5 of them.
            presenterMode: "suit",
            presenter_placement: {
              // MEASURED, not guessed — see src/scratch-r1-geom.ts. This is an
              // apparent-size knob: each pose is scaled so its collar subtends
              // this many pixels, and the figure's real size falls out of the
              // pose's own collar hitbox. At 150 (the value in the docs' worked
              // example) `arms-at-side` — the HOOK pose — resolves 118% of frame
              // height with its head mark centred 182px ABOVE the top edge, i.e.
              // the narrator's head is off screen on the most important beat of
              // the video. 110 is the largest value at which all four placed
              // poses keep the whole head mark inside the frame at the 1.08x
              // peak of the loudness pump (worst case `arms-at-side`, 81px of
              // headroom), and the figure still reads large: 87% of frame height
              // on the solo beats, 59-69% beside a chart.
              target_collar_px: 110,
              bottom_anchor: 1,
              side_inset: 0.06,
              mirror: false,
              // Any lift eats into that 81px of headroom on `arms-at-side`.
              head_lift_px: 0,
            },
            // 14 connective beats; every 4th is stock, so 3 graded Pexels plates
            // and 11 generated ones. Konrad's v2 note was that stock "flashed"
            // against the mat — F1 now grades sourced footage into the palette,
            // and this cadence keeps it to the beats that earn it.
            broll_pexels_every: 4,
            broll_motion: true,
            voice_id: VOICE_ROW_ID,
            image_model: "gpt-image-2",
            image_resolution: "2K",
            // Every input below is SPOKEN ALOUD, verbatim, on the beat that
            // cites it (s08 and s18). v2 dropped its chart because the script
            // named fixed costs and the margin but never a price, and no number
            // is put on screen that the narration does not say.
            //   s08  "twelve thousand dollars a month" / "five dollars" /
            //        "two dollars" -> "four thousand items a month"
            //   s18  "one hundred and twenty thousand dollars" /
            //        "ninety six thousand dollars" -> "one point two five"
            figures: {
              breakeven: {
                kind: "break-even",
                inputs: {
                  fixedCosts: 12000,
                  pricePerUnit: 5,
                  variableCostPerUnit: 2,
                },
              },
              coverage: {
                kind: "dscr",
                inputs: {
                  netOperatingIncome: 120000,
                  annualDebtService: 96000,
                },
              },
            },
          },
        },
      })
      .returning({ id: contentJobs.id });
    if (row === undefined) throw new Error("job insert returned no row");
    jobId = row.id;
    console.log(`[r1] created job ${jobId}`);
  }

  const [job] = await db
    .select()
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);
  const [template] = await db
    .select()
    .from(contentTemplates)
    .where(eq(contentTemplates.id, TEMPLATE_ID))
    .limit(1);
  if (job === undefined) throw new Error(`job ${jobId} not found`);
  if (template === undefined) throw new Error("template not found");

  const qmsValidation = new Queue("qms-validation", {
    connection: { url: cfg.REDIS_URL },
  });

  try {
    const result = await runBusinessHubAssetStage({
      db,
      jobId,
      job,
      template,
      queues: { qmsValidation },
    });
    console.log("\n=== ASSET STAGE RESULT ===");
    console.log(JSON.stringify(result, null, 2));
    console.log(`\n[r1] JOB_ID=${jobId}`);
  } finally {
    await qmsValidation.close();
  }
}

main().catch((err: unknown) => {
  console.error("\n=== ASSET STAGE FAILED ===");
  console.error(err);
  process.exit(1);
});
