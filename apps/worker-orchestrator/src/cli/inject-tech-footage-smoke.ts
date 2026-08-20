#!/usr/bin/env tsx
/**
 * inject-tech-footage-smoke.ts
 *
 * Injects a TECH_COMPARISON job directly at TECH_FOOTAGE_COLLECTING to smoke
 * test the footage pipeline (yt-dlp + Pexels → ASSET_COLLECTION).
 *
 * Run from /opt/content-forge:
 *   ./node_modules/.bin/tsx apps/worker-orchestrator/src/cli/inject-tech-footage-smoke.ts
 */

import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { contentJobs } from "@repo/db";
import { Queue } from "bullmq";

const DB_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://postgres:content_forge_prod@127.0.0.1:5432/content_forge";
const REDIS_HOST = "127.0.0.1";
const REDIS_PORT = 6379;
const CHANNEL_ID = "82df56a3-3f7d-4886-ab9f-c9fb3ee70e74";
const TEMPLATE_ID = "40b01354-75d7-4bb2-86b1-0e437373ac28";

const SCENES = [
  {
    scene_index: 0,
    comparison_block_type: "HOOK",
    comparison_product_slot: null,
    comparison_dimension: null,
    paragraph:
      "MacBook Air M3 versus Dell XPS 15. Apple's ultralight powerhouse against Dell's premium Windows ultrabook.",
  },
  {
    scene_index: 1,
    comparison_block_type: "PRODUCT_INTRO",
    comparison_product_slot: "A",
    comparison_dimension: null,
    paragraph:
      "The M3 chip delivers class-leading performance per watt — silent, fanless, and remarkably fast for everyday and creative workloads.",
  },
  {
    scene_index: 2,
    comparison_block_type: "PRODUCT_INTRO",
    comparison_product_slot: "B",
    comparison_dimension: null,
    paragraph:
      "The XPS 15 brings a gorgeous OLED display and more RAM options, backed by a discrete NVIDIA GPU for demanding tasks.",
  },
  {
    scene_index: 3,
    comparison_block_type: "FEATURE_HIGHLIGHT",
    comparison_product_slot: null,
    comparison_dimension: "Battery Life",
    paragraph:
      "On battery life, the MacBook wins by hours. Apple's efficiency cores keep it running all day; the XPS 15 struggles past six hours under load.",
  },
  {
    scene_index: 4,
    comparison_block_type: "FEATURE_HIGHLIGHT",
    comparison_product_slot: null,
    comparison_dimension: "Display",
    paragraph:
      "On display quality, the XPS 15 OLED edges it out with deeper blacks and richer colors — but the MacBook's Liquid Retina holds its own.",
  },
  {
    scene_index: 5,
    comparison_block_type: "FEATURE_HIGHLIGHT",
    comparison_product_slot: null,
    comparison_dimension: "Performance",
    paragraph:
      "Performance goes to the M3 — even outperforming the XPS 15's discrete GPU on sustained workloads thanks to Apple's unified memory architecture.",
  },
  {
    scene_index: 6,
    comparison_block_type: "VERDICT",
    comparison_product_slot: null,
    comparison_dimension: null,
    paragraph:
      "The verdict: MacBook Air M3 is the better choice for most people. Better battery, better performance, lighter weight, and a competitive price.",
  },
];

const SCRIPT = SCENES.map((s) => s.paragraph).join("\n\n");

async function main() {
  const jobId = randomUUID();
  console.log("\n=== TECH FOOTAGE SMOKE TEST ===");
  console.log(`Job ID: ${jobId}`);
  console.log("Topic: MacBook Air M3 vs Dell XPS 15\n");

  const sql = postgres(DB_URL);
  const db = drizzle(sql);

  await db.insert(contentJobs).values({
    id: jobId,
    channel_id: CHANNEL_ID,
    template_id: TEMPLATE_ID,
    format: "TECH_COMPARISON",
    status: "TECH_FOOTAGE_COLLECTING",
    status_updated_at: new Date(),
    production_version: "V2",
    language: "en",
    title: "MacBook Air M3 vs Dell XPS 15 — Which Laptop Wins?",
    description: "Smoke test for footage collection pipeline",
    script: SCRIPT,
    metadata: {
      comparison: {
        products: [
          {
            slot: "A",
            name: "MacBook Air M3",
            price_usd: 1099,
            hero_asset_key: null,
          },
          {
            slot: "B",
            name: "Dell XPS 15",
            price_usd: 1299,
            hero_asset_key: null,
          },
        ],
        subformat: "TECH_HARDWARE",
      },
      skip_data_grid_audit: true,
      pipeline_config: { needs_scene_analysis: false },
    },
    assembly_manifest: {
      render_seed: 1234,
      scenes: SCENES.map((s) => ({
        ...s,
        start_frame: null,
        end_frame: null,
        duration_frames: null,
        sentence_images: [],
        visual_asset_key: null,
      })),
    },
    r2_asset_manifest: [],
    skip_image_qc: true,
    skip_final_qc: true,
  } as any);
  await sql.end();
  console.log("[inject] Job inserted to DB at TECH_FOOTAGE_COLLECTING");

  const queue = new Queue("queue-tech-footage-collection", {
    connection: { host: REDIS_HOST, port: REDIS_PORT },
  });
  await queue.add(
    "tech-footage-collection",
    { job_id: jobId },
    { priority: 1, attempts: 2 },
  );
  await queue.close();

  console.log(`\n✅ Dispatched to queue-tech-footage-collection`);
  console.log(`Monitor: pm2 logs worker-orchestrator --lines 50`);
  console.log(
    `Job in DB: SELECT status FROM content_jobs WHERE id = '${jobId}';`,
  );
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
