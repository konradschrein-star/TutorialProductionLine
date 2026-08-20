#!/usr/bin/env tsx
/**
 * inject-comparison-job.ts
 *
 * Creates a complete TECH_COMPARISON job for "VS Code vs Cursor" and injects
 * it at the ROUTING_RENDER stage, bypassing research/script/TTS pipeline.
 *
 * Run (from /opt/content-forge):
 *   ./node_modules/.bin/tsx apps/worker-orchestrator/src/cli/inject-comparison-job.ts
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { contentJobs } from "@repo/db";
import { Queue } from "bullmq";

// ── Config ────────────────────────────────────────────────────────────────────
const DB_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://postgres:content_forge_prod@127.0.0.1:5432/content_forge";
const REDIS_HOST = "127.0.0.1";
const REDIS_PORT = 6379;
const LOCAL_MEDIA_ROOT =
  process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";
const CHANNEL_ID = "82df56a3-3f7d-4886-ab9f-c9fb3ee70e74"; // Content Forge Main
const TEMPLATE_ID = "40b01354-75d7-4bb2-86b1-0e437373ac28"; // Comparison X vs Y — Software
const USER_ID = "7aaee4ad-e2d9-4b72-8c1b-972974b9cd5c";
const AI33_KEY = process.env["AI33_API_KEY"] ?? "";
const VOICE_ID =
  process.env["DEFAULT_VOICE_EN"] ?? "ecc78f25-09a0-432e-b554-2f4de3ff41ec"; // Fish — Alok (Standard)
const AI33_BASE = "https://api.ai33.pro";

// ── VS Code vs Cursor Comparison Scenes ──────────────────────────────────────
const SCENES = [
  {
    scene_index: 0,
    comparison_block_type: "HOOK",
    comparison_product_slot: null,
    comparison_dimension: null,
    paragraph:
      "VS Code or Cursor — which AI code editor should you actually be using in 2026? We tested both so you don't have to.",
  },
  {
    scene_index: 1,
    comparison_block_type: "PRODUCT_INTRO",
    comparison_product_slot: "A",
    comparison_dimension: null,
    paragraph:
      "VS Code is Microsoft's free, open-source editor and the default choice for developers worldwide. Zero cost, forty thousand extensions, and rock-solid stability built over a decade.",
  },
  {
    scene_index: 2,
    comparison_block_type: "PRODUCT_INTRO",
    comparison_product_slot: "B",
    comparison_dimension: null,
    paragraph:
      "Cursor is VS Code with a brain transplant. It forks VS Code's foundation and adds Claude and GPT-4 directly into your workflow. It reads your entire codebase, writes full functions, and fixes bugs across multiple files simultaneously.",
  },
  {
    scene_index: 3,
    comparison_block_type: "FEATURE_HIGHLIGHT",
    comparison_product_slot: null,
    comparison_dimension: "AI Features",
    paragraph:
      "On AI features, Cursor is in a completely different league. Tab completion predicts multi-line edits before you finish typing. The chat window understands your entire project context. VS Code's Copilot is solid but feels limited by comparison.",
  },
  {
    scene_index: 4,
    comparison_block_type: "FEATURE_HIGHLIGHT",
    comparison_product_slot: null,
    comparison_dimension: "Extensions",
    paragraph:
      "VS Code's extension marketplace is unmatched with forty thousand options covering every language and framework. Cursor supports most VS Code extensions, but you occasionally hit compatibility issues with niche dev tools.",
  },
  {
    scene_index: 5,
    comparison_block_type: "DATA_COMPARISON",
    comparison_product_slot: null,
    comparison_dimension: null,
    paragraph:
      "Looking at the scores side by side: VS Code wins on price, extensions, and privacy. Cursor wins decisively on AI features, which is really the entire value proposition of the product.",
  },
  {
    scene_index: 6,
    comparison_block_type: "PRICE_COMPARISON",
    comparison_product_slot: null,
    comparison_dimension: "Price",
    paragraph:
      "VS Code is completely free. Cursor costs nineteen dollars per month after a limited free tier. For developers writing code eight hours a day, the productivity gains typically justify that cost within the first week.",
  },
  {
    scene_index: 7,
    comparison_block_type: "FEATURE_HIGHLIGHT",
    comparison_product_slot: null,
    comparison_dimension: "Privacy",
    paragraph:
      "Privacy is where things get complicated. VS Code sends zero code to external servers by default. Cursor indexes your codebase for AI context, which creates real concerns for proprietary or regulated projects.",
  },
  {
    scene_index: 8,
    comparison_block_type: "VERDICT",
    comparison_product_slot: null,
    comparison_dimension: null,
    paragraph:
      "Our verdict: Cursor wins for professional developers who want maximum AI productivity and can accept the privacy trade-off. VS Code wins for cost-sensitive developers, students, and anyone working with sensitive codebases.",
  },
  {
    scene_index: 9,
    comparison_block_type: "CTA",
    comparison_product_slot: null,
    comparison_dimension: null,
    paragraph:
      "If this comparison helped you decide, subscribe for more developer tool breakdowns every week.",
  },
];

const SCRIPT_TEXT = SCENES.map((s) => s.paragraph).join("\n\n");

// ── Comparison Metadata ───────────────────────────────────────────────────────
const COMPARISON_METADATA = {
  products: [
    { slot: "A", name: "VS Code", price_usd: 0, hero_asset_key: null },
    { slot: "B", name: "Cursor", price_usd: 19, hero_asset_key: null },
  ],
  data_grid: {
    dimensions: ["AI Features", "Extensions", "Privacy", "Price", "Speed"],
    scores: {
      A: {
        "AI Features": 65,
        Extensions: 100,
        Privacy: 95,
        Price: 100,
        Speed: 92,
      },
      B: {
        "AI Features": 97,
        Extensions: 75,
        Privacy: 55,
        Price: 45,
        Speed: 88,
      },
    },
    raw_specs: {
      A: {
        "AI Features": "Copilot add-on ($10/mo)",
        Extensions: "40,000+ marketplace",
        Privacy: "No code sent by default",
        Price: "Free",
        Speed: "Lightning fast startup",
      },
      B: {
        "AI Features": "Claude + GPT-4 built-in",
        Extensions: "VS Code compatible",
        Privacy: "Codebase indexed for AI",
        Price: "$19/month",
        Speed: "Fast, slight AI overhead",
      },
    },
  },
  subformat: "TECH_SOFTWARE",
};

// ── AI33 TTS ──────────────────────────────────────────────────────────────────
async function generateTTS(text: string): Promise<Buffer> {
  console.log("[tts] Submitting TTS request to AI33 ElevenLabs...");

  const submitRes = await fetch(
    `${AI33_BASE}/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": AI33_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        with_transcript: false,
      }),
    },
  );

  if (!submitRes.ok) {
    const body = await submitRes.text();
    throw new Error(`AI33 TTS submit failed (${submitRes.status}): ${body}`);
  }

  const submitData = (await submitRes.json()) as {
    success: boolean;
    task_id?: string;
    message?: string;
  };

  if (!submitData.success || !submitData.task_id) {
    throw new Error(`AI33 TTS submit error: ${JSON.stringify(submitData)}`);
  }

  const taskId = submitData.task_id;
  console.log(`[tts] Task submitted: ${taskId}. Polling for completion...`);

  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));

    const pollRes = await fetch(`${AI33_BASE}/v1/task/${taskId}`, {
      headers: { "xi-api-key": AI33_KEY },
    });

    if (!pollRes.ok) {
      console.warn(`[tts] Poll ${attempt + 1}: HTTP ${pollRes.status}`);
      continue;
    }

    const pollData = (await pollRes.json()) as {
      status: string;
      progress?: number;
      metadata?: { audio_url?: string };
    };

    const { status, progress } = pollData;
    console.log(
      `[tts] Poll ${attempt + 1}: status=${status} progress=${progress ?? 0}%`,
    );

    if (status === "done" || status === "completed") {
      const audioUrl = pollData.metadata?.audio_url;
      if (!audioUrl) throw new Error("TTS done but no audio_url in response");

      console.log(`[tts] Done! Downloading audio...`);
      const audioRes = await fetch(audioUrl);
      if (!audioRes.ok)
        throw new Error(`Audio download failed: ${audioRes.status}`);
      return Buffer.from(await audioRes.arrayBuffer());
    }

    if (status === "failed" || status === "error") {
      throw new Error(`TTS task failed: ${JSON.stringify(pollData)}`);
    }
  }

  throw new Error("TTS polling timed out after 10 minutes");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const jobId = randomUUID();
  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║  COMPARISON JOB INJECT: VS Code vs Cursor            ║`);
  console.log(`╠══════════════════════════════════════════════════════╣`);
  console.log(`║  Job ID: ${jobId.substring(0, 36)}  ║`);
  console.log(
    `║  Scenes: ${SCENES.length} scenes, ${SCRIPT_TEXT.split(" ").length} words                       ║`,
  );
  console.log(`╚══════════════════════════════════════════════════════╝\n`);

  // 1. Generate TTS audio
  const audioBuffer = await generateTTS(SCRIPT_TEXT);
  console.log(
    `[inject] TTS audio generated: ${(audioBuffer.length / 1024).toFixed(1)} KB`,
  );

  // 2. Save TTS to media directory
  const jobMediaDir = join(LOCAL_MEDIA_ROOT, CHANNEL_ID, jobId);
  await mkdir(jobMediaDir, { recursive: true });
  const ttsPath = join(jobMediaDir, "tts.mp3");
  await writeFile(ttsPath, audioBuffer);
  console.log(`[inject] TTS saved: ${ttsPath}`);

  // 3. Build job fields
  const assemblyManifest = {
    render_seed: 42,
    scenes: SCENES.map((s) => ({
      ...s,
      start_frame: null,
      end_frame: null,
      duration_frames: null,
      sentence_images: [],
      visual_asset_key: null,
    })),
  };

  const r2AssetManifest = [
    {
      key: ttsPath,
      type: "audio/tts",
      size_bytes: audioBuffer.length,
    },
  ];

  const jobMetadata = {
    comparison: COMPARISON_METADATA,
    skip_data_grid_audit: true,
    skip_product_images: true,
  };

  // 4. Insert job in DB
  console.log(`[inject] Inserting job ${jobId} into database...`);
  const sql = postgres(DB_URL);
  const db = drizzle(sql);

  await db.insert(contentJobs).values({
    id: jobId,
    channel_id: CHANNEL_ID,
    template_id: TEMPLATE_ID,
    format: "TECH_COMPARISON",
    status: "ROUTING_RENDER",
    production_version: "V2",
    language: "en",
    script: SCRIPT_TEXT,
    metadata: jobMetadata as any,
    assembly_manifest: assemblyManifest as any,
    r2_asset_manifest: r2AssetManifest,
    skip_image_qc: true,
    skip_final_qc: true,
  } as any);

  await sql.end();
  console.log(`[inject] ✅ Job inserted in DB`);

  // 5. Dispatch to render-heavy queue
  console.log(`[inject] Dispatching to queue-render-heavy...`);
  const queue = new Queue("queue-render-heavy", {
    connection: { host: REDIS_HOST, port: REDIS_PORT },
  });

  await queue.add(
    "render-comparison",
    { job_id: jobId },
    { priority: 1, attempts: 2 },
  );
  await queue.close();

  console.log(`\n✅ Job ${jobId} dispatched!`);
  console.log(`\nMonitor render:`);
  console.log(`  pm2 logs worker-render --lines 200`);
  console.log(`\nCheck status:`);
  console.log(
    `  psql $DATABASE_URL -c "SELECT id, status, progress FROM content_jobs WHERE id='${jobId}';"`,
  );
  console.log(`\nOutput will be in:`);
  console.log(`  ${jobMediaDir}/`);
}

main().catch((e) => {
  console.error("\n❌ INJECT FAILED:", e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
