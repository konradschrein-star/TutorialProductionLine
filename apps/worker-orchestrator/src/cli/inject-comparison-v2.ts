#!/usr/bin/env tsx
/**
 * inject-comparison-v2.ts
 *
 * Creates a TECH_COMPARISON job "VS Code vs Cursor" at ROUTING_RENDER.
 * Uses Edge TTS (port 5051) to generate audio for Remotion render testing.
 *
 * NOTE: Edge TTS is used here ONLY for Remotion renderer validation.
 * Replace with AI33 ElevenLabs for production content.
 *
 * Run (from /opt/content-forge):
 *   ./node_modules/.bin/tsx apps/worker-orchestrator/src/cli/inject-comparison-v2.ts
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
const CHANNEL_ID = "82df56a3-3f7d-4886-ab9f-c9fb3ee70e74";
const TEMPLATE_ID = "40b01354-75d7-4bb2-86b1-0e437373ac28";
const USER_ID = "7aaee4ad-e2d9-4b72-8c1b-972974b9cd5c";

// Edge TTS config (local service)
const EDGE_TTS_URL = process.env["EDGE_TTS_API_URL"] ?? "http://127.0.0.1:5051";
const EDGE_TTS_KEY =
  process.env["EDGE_TTS_API_KEY"] ??
  "xamDJAl05/tJUiSLt4lfSlS2IgPzazCfeh0ev2KffWg=";

// ── Scenes ────────────────────────────────────────────────────────────────────
const SCENES = [
  {
    scene_index: 0,
    comparison_block_type: "HOOK",
    comparison_product_slot: null,
    comparison_dimension: null,
    paragraph:
      "VS Code or Cursor — which AI code editor should you use in 2026? We tested both so you don't have to.",
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
      "Cursor is VS Code with a brain transplant. It adds Claude and GPT-4 directly into your workflow, reads your entire codebase, and writes full functions across multiple files simultaneously.",
  },
  {
    scene_index: 3,
    comparison_block_type: "FEATURE_HIGHLIGHT",
    comparison_product_slot: null,
    comparison_dimension: "AI Features",
    paragraph:
      "On AI features, Cursor is in a completely different league. Tab completion predicts multi-line edits before you finish typing. VS Code's Copilot is solid but limited by comparison.",
  },
  {
    scene_index: 4,
    comparison_block_type: "DATA_COMPARISON",
    comparison_product_slot: null,
    comparison_dimension: null,
    paragraph:
      "Looking at the scores: VS Code wins on price, extensions, and privacy. Cursor wins decisively on AI features, which is the entire point of the product.",
  },
  {
    scene_index: 5,
    comparison_block_type: "PRICE_COMPARISON",
    comparison_product_slot: null,
    comparison_dimension: "Price",
    paragraph:
      "VS Code is completely free. Cursor costs nineteen dollars per month. For developers writing code eight hours a day, the productivity gains typically justify the cost within the first week.",
  },
  {
    scene_index: 6,
    comparison_block_type: "FEATURE_HIGHLIGHT",
    comparison_product_slot: null,
    comparison_dimension: "Privacy",
    paragraph:
      "Privacy is where things get complicated. VS Code sends zero code to external servers by default. Cursor indexes your codebase for AI context, which raises real concerns for proprietary projects.",
  },
  {
    scene_index: 7,
    comparison_block_type: "VERDICT",
    comparison_product_slot: null,
    comparison_dimension: null,
    paragraph:
      "Our verdict: Cursor wins for professional developers who want maximum AI productivity. VS Code wins for cost-sensitive developers and anyone working with sensitive codebases.",
  },
  {
    scene_index: 8,
    comparison_block_type: "CTA",
    comparison_product_slot: null,
    comparison_dimension: null,
    paragraph:
      "Subscribe for more developer tool comparisons every week. We cover the tools that actually matter.",
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
    dimensions: ["AI Features", "Extensions", "Privacy", "Price"],
    scores: {
      A: { "AI Features": 65, Extensions: 100, Privacy: 95, Price: 100 },
      B: { "AI Features": 97, Extensions: 75, Privacy: 55, Price: 45 },
    },
    raw_specs: {
      A: {
        "AI Features": "Copilot add-on ($10/mo)",
        Extensions: "40,000+ marketplace",
        Privacy: "No code sent by default",
        Price: "Free",
      },
      B: {
        "AI Features": "Claude + GPT-4 built-in",
        Extensions: "VS Code compatible",
        Privacy: "Codebase indexed for AI",
        Price: "$19/month",
      },
    },
  },
  subformat: "TECH_SOFTWARE",
};

// ── Edge TTS ──────────────────────────────────────────────────────────────────
async function generateEdgeTTS(text: string): Promise<Buffer> {
  console.log("[tts] Generating audio via Edge TTS (localhost:5051)...");

  const res = await fetch(`${EDGE_TTS_URL}/v1/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${EDGE_TTS_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      input: text,
      voice: "echo", // Deep male voice, clear narration style
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Edge TTS failed (${res.status}): ${body}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const jobId = randomUUID();
  const wordCount = SCRIPT_TEXT.split(/\s+/).length;
  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║  COMPARISON JOB INJECT v2: VS Code vs Cursor         ║`);
  console.log(`╠══════════════════════════════════════════════════════╣`);
  console.log(`║  Job ID: ${jobId}  ║`);
  console.log(
    `║  Scenes: ${SCENES.length}  Words: ${wordCount}  TTS: Edge TTS         ║`,
  );
  console.log(`╚══════════════════════════════════════════════════════╝\n`);

  // 1. Generate TTS
  const audioBuffer = await generateEdgeTTS(SCRIPT_TEXT);
  console.log(`[inject] Audio: ${(audioBuffer.length / 1024).toFixed(1)} KB`);

  // 2. Save TTS
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
    // skip_product_images removed — images are now auto-fetched via Pexels in asset-collection
  };

  // 4. Insert in DB
  console.log(`[inject] Inserting job ${jobId}...`);
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
    title: "VS Code vs Cursor — Which AI Editor Wins in 2026?",
    description:
      "Side-by-side comparison of VS Code and Cursor AI code editors",
    script: SCRIPT_TEXT,
    metadata: jobMetadata as any,
    assembly_manifest: assemblyManifest as any,
    r2_asset_manifest: r2AssetManifest,
    skip_image_qc: true,
    skip_final_qc: true,
  } as any);

  await sql.end();
  console.log(`[inject] ✅ Job inserted`);

  // 5. Dispatch to asset-collection queue (will auto-fetch images, then route to render)
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
  console.log(`\nMonitor:`);
  console.log(`  pm2 logs worker-render --lines 200`);
  console.log(`\nOutput:`);
  console.log(`  ${jobMediaDir}/`);
}

main().catch((e) => {
  console.error("❌ FAILED:", e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
