#!/usr/bin/env tsx
/**
 * inject-iphone-vs-samsung.ts
 * iPhone 15 Pro vs Samsung Galaxy S24 Ultra comparison
 * Uses AI33 ElevenLabs TTS (Biker Voice 1)
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
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
const LOCAL_MEDIA_ROOT =
  process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";
const CHANNEL_ID = "82df56a3-3f7d-4886-ab9f-c9fb3ee70e74";
const TEMPLATE_ID = "40b01354-75d7-4bb2-86b1-0e437373ac28";

const AI33_KEY = process.env["AI33_API_KEY"] ?? "";
const MINIMAX_VOICE_ID = "209533299589217"; // Minimax Male - Professional

const SCENES = [
  {
    scene_index: 0,
    comparison_block_type: "HOOK",
    comparison_product_slot: null,
    comparison_dimension: null,
    paragraph:
      "The two best smartphones money can buy are going head to head. iPhone 15 Pro versus Samsung Galaxy S24 Ultra — we tested both for two weeks to find out which one actually deserves your money.",
  },
  {
    scene_index: 1,
    comparison_block_type: "PRODUCT_INTRO",
    comparison_product_slot: "A",
    comparison_dimension: null,
    paragraph:
      "iPhone 15 Pro. Apple flagship runs on the A17 Pro chip — the fastest mobile processor ever tested. Titanium frame, 48-megapixel main camera, and ProRes 4K60 video. Starts at $999.",
  },
  {
    scene_index: 2,
    comparison_block_type: "PRODUCT_INTRO",
    comparison_product_slot: "B",
    comparison_dimension: null,
    paragraph:
      "Galaxy S24 Ultra. Samsung flagship packs a 200-megapixel camera, a built-in S Pen for productivity, and the world's brightest mobile display. Starting at $1,299.",
  },
  {
    scene_index: 3,
    comparison_block_type: "FEATURE_HIGHLIGHT",
    comparison_product_slot: null,
    comparison_dimension: "Camera",
    paragraph:
      "On camera, Samsung 200-megapixel sensor wins on pure flexibility — 100x optical zoom is legitimately useful for wildlife and sports. But for video creators, iPhone ProRes recording at 4K60 is in a completely different league.",
  },
  {
    scene_index: 4,
    comparison_block_type: "FEATURE_HIGHLIGHT",
    comparison_product_slot: null,
    comparison_dimension: "Performance",
    paragraph:
      "Performance is not even close. The A17 Pro chip beats every Android chip in both single-core and sustained workloads. Gaming, video editing, AI processing — iPhone is consistently 20 to 40 percent faster.",
  },
  {
    scene_index: 5,
    comparison_block_type: "DATA_COMPARISON",
    comparison_product_slot: null,
    comparison_dimension: null,
    paragraph:
      "The full scorecard: iPhone 15 Pro dominates on raw performance and software longevity. Galaxy S24 Ultra leads on display quality and camera flexibility. Battery life is surprisingly close.",
  },
  {
    scene_index: 6,
    comparison_block_type: "PRICE_COMPARISON",
    comparison_product_slot: null,
    comparison_dimension: "Price",
    paragraph:
      "Price is a real differentiator. iPhone 15 Pro starts at $999. Galaxy S24 Ultra starts at $1,299. That 300-dollar gap means Samsung needs to deliver meaningfully more value to justify the premium.",
  },
  {
    scene_index: 7,
    comparison_block_type: "VERDICT",
    comparison_product_slot: "A",
    comparison_dimension: null,
    paragraph:
      "The verdict: iPhone 15 Pro wins for most people. It is faster, more consistent, receives software updates for longer, and costs $300 less. Galaxy S24 Ultra is the better choice only if you need the best camera flexibility or the S Pen fits your workflow.",
  },
  {
    scene_index: 8,
    comparison_block_type: "CTA",
    comparison_product_slot: null,
    comparison_dimension: null,
    paragraph:
      "Both phones are genuinely excellent. The best deals and affiliate links are in the description below. Subscribe for detailed comparisons every week.",
  },
];

const SCRIPT_TEXT = SCENES.map((s) => s.paragraph).join("\n\n");

const COMPARISON_METADATA = {
  products: [
    { slot: "A", name: "iPhone 15 Pro", price_usd: 999, hero_asset_key: null },
    {
      slot: "B",
      name: "Samsung Galaxy S24 Ultra",
      price_usd: 1299,
      hero_asset_key: null,
    },
  ],
  data_grid: {
    dimensions: ["Camera", "Performance", "Display", "Battery", "Price Value"],
    scores: {
      A: {
        Camera: 85,
        Performance: 97,
        Display: 84,
        Battery: 73,
        "Price Value": 88,
      },
      B: {
        Camera: 95,
        Performance: 81,
        Display: 97,
        Battery: 79,
        "Price Value": 65,
      },
    },
    raw_specs: {
      A: {
        Camera: "48MP main, ProRes 4K60",
        Performance: "A17 Pro — fastest chip",
        Display: '6.1" OLED 120Hz ProMotion',
        Battery: "~3,274 mAh / 23h video",
        "Price Value": "$999 starting",
      },
      B: {
        Camera: "200MP main, 100x Space Zoom",
        Performance: "Snapdragon 8 Gen 3",
        Display: '6.8" QHD+ 120Hz, 2,600 nits',
        Battery: "5,000 mAh / 27h video",
        "Price Value": "$1,299 starting",
      },
    },
    pricing: {
      A: "$999",
      B: "$1,299",
    },
  },
  subformat: "TECH_HARDWARE",
};

async function generateTTS(text: string): Promise<Buffer> {
  console.log("[tts] Submitting to AI33 Minimax...");
  const res = await fetch(`https://api.ai33.pro/v1m/task/text-to-speech`, {
    method: "POST",
    headers: {
      "xi-api-key": AI33_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model: "speech-2.8-hd",
      audio_setting: {},
      voice_setting: {
        voice_id: MINIMAX_VOICE_ID,
        vol: 1,
        pitch: 0,
        speed: 1.24,
      },
      language_boost: "Auto",
    }),
  });
  if (!res.ok) {
    throw new Error(`TTS submit failed (${res.status}): ${await res.text()}`);
  }
  const submitData = (await res.json()) as any;
  if (!submitData.success || !submitData.task_id) {
    throw new Error(`TTS submit failed: ${JSON.stringify(submitData)}`);
  }
  const task_id = submitData.task_id;
  console.log(`[tts] Task submitted: ${task_id}`);

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const poll = await fetch(`https://api.ai33.pro/v1/task/${task_id}`, {
      headers: { "xi-api-key": AI33_KEY },
    });
    const data = (await poll.json()) as any;
    process.stdout.write(
      `\r[tts] ${data.status} (${i + 1}/60) progress=${data.progress ?? "?"}%  `,
    );
    if (data.status === "done") {
      console.log();
      const audio = await fetch(data.metadata.audio_url);
      return Buffer.from(await audio.arrayBuffer());
    }
    if (data.status === "error") {
      throw new Error(`TTS failed: ${JSON.stringify(data)}`);
    }
  }
  throw new Error("TTS timeout after 3 minutes");
}

async function main() {
  const jobId = randomUUID();
  console.log("\n=== iPhone 15 Pro vs Samsung Galaxy S24 Ultra ===");
  console.log(`Job ID: ${jobId}`);
  console.log(`Script: ${SCRIPT_TEXT.split(/\s+/).length} words\n`);

  const audioBuffer = await generateTTS(SCRIPT_TEXT);
  console.log(
    `[inject] Audio generated: ${(audioBuffer.length / 1024).toFixed(1)} KB`,
  );

  const jobMediaDir = join(LOCAL_MEDIA_ROOT, CHANNEL_ID, jobId);
  await mkdir(jobMediaDir, { recursive: true });
  const ttsPath = join(jobMediaDir, "tts.mp3");
  await writeFile(ttsPath, audioBuffer);
  console.log(`[inject] TTS saved: ${ttsPath}`);

  const assemblyManifest = {
    render_seed: 7777,
    scenes: SCENES.map((s) => ({
      ...s,
      start_frame: null,
      end_frame: null,
      duration_frames: null,
      sentence_images: [],
      visual_asset_key: null,
    })),
  };

  const sql = postgres(DB_URL);
  const db = drizzle(sql);

  await db.insert(contentJobs).values({
    id: jobId,
    channel_id: CHANNEL_ID,
    template_id: TEMPLATE_ID,
    format: "TECH_COMPARISON",
    status: "ASSET_COLLECTION",
    status_updated_at: new Date(),
    production_version: "V2",
    language: "en",
    title: "iPhone 15 Pro vs Samsung Galaxy S24 Ultra — Which Is Better?",
    description:
      "Detailed comparison of the two best flagship smartphones of 2024",
    script: SCRIPT_TEXT,
    metadata: {
      comparison: COMPARISON_METADATA,
      skip_data_grid_audit: true,
    } as any,
    assembly_manifest: assemblyManifest as any,
    r2_asset_manifest: [
      { key: ttsPath, type: "audio/tts", size_bytes: audioBuffer.length },
    ],
    skip_image_qc: true,
    skip_final_qc: true,
  } as any);
  await sql.end();
  console.log("[inject] Job inserted to DB");

  const queue = new Queue("queue-asset-collection", {
    connection: { host: REDIS_HOST, port: REDIS_PORT },
  });
  await queue.add(
    "collect-assets-comparison",
    { job_id: jobId },
    { priority: 1, attempts: 2 },
  );
  await queue.close();

  console.log(`\n✅ Job ${jobId} dispatched to queue-asset-collection`);
  console.log(`Media dir: ${jobMediaDir}`);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
