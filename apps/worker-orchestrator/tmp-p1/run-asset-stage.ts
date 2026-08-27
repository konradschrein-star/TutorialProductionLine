// SCRATCH — P1 tracer. Not shipped code.
// Creates (or reuses) a BUSINESS_PLAN_HUB job and runs the whole asset stage.
import { config as dotenvConfig } from "dotenv";
import path from "node:path";
import { readFile } from "node:fs/promises";

dotenvConfig({ path: path.resolve(process.cwd(), "../../.env") });

const { loadConfig } = await import("@repo/config");
loadConfig();

const { createDrizzleClient } = await import("@repo/db");
const { contentJobs, contentTemplates } = await import("@repo/db/schema");
const { eq } = await import("drizzle-orm");
const { Queue } = await import("bullmq");
const { runBusinessHubAssetStage } = await import(
  "../src/processors/business-hub/pipeline.js"
);

const TEMPLATE_ID = "2ad9ad0f-64cf-4807-9651-f402a3782f09";
const CHANNEL_ID = "ee6a2526-5c61-42d2-aa3f-be32aabbc9d7";
const TOPIC = "How to write a business plan for a bakery";

const db = createDrizzleClient(process.env["DATABASE_URL"]!);

const scriptPath = path.resolve(process.cwd(), "tmp-p1", "script-final.txt");
const script = (await readFile(scriptPath, "utf8")).trim();

const figures = {
  "bakery-breakeven": {
    kind: "break-even",
    inputs: {
      fixedCosts: 42000,
      pricePerUnit: 6,
      variableCostPerUnit: 2.4,
    },
  },
};

const hub = {
  family: "how-to-write-for",
  topic: TOPIC,
  target_seconds: 260,
  presenter_mode: "none",
  figures,
};

let jobId = process.env["P1_JOB_ID"];
if (jobId === undefined || jobId.trim().length === 0) {
  const [row] = await db
    .insert(contentJobs)
    .values({
      channel_id: CHANNEL_ID,
      template_id: TEMPLATE_ID,
      status: "ASSET_COLLECTION",
      status_updated_at: new Date(),
      format: "BUSINESS_PLAN_HUB",
      language: "en",
      initial_topic: TOPIC,
      title: "How To Write A Business Plan For A Bakery",
      description: "P1 tracer bullet render.",
      script,
      aspect_ratio: "16:9",
      target_duration_seconds: 260,
      render_engine: "FFMPEG",
      production_version: "V3",
      metadata: { business_hub: hub },
    })
    .returning({ id: contentJobs.id });
  jobId = row!.id;
  console.log("CREATED JOB", jobId);
} else {
  await db
    .update(contentJobs)
    .set({
      script,
      status: "ASSET_COLLECTION",
      status_updated_at: new Date(),
      metadata: { business_hub: hub },
    })
    .where(eq(contentJobs.id, jobId));
  console.log("REUSING JOB", jobId);
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

const connection = { url: process.env["REDIS_URL"] ?? "redis://localhost:6381" };
const qmsValidation = new Queue("qms-validation", { connection });

try {
  const result = await runBusinessHubAssetStage({
    db,
    jobId,
    job: job!,
    template: template!,
    queues: { qmsValidation },
  });
  console.log("ASSET STAGE OK", JSON.stringify(result, null, 2));
} finally {
  await qmsValidation.close();
}
process.exit(0);
