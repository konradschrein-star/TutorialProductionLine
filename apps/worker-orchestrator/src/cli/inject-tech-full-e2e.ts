#!/usr/bin/env tsx
/**
 * inject-tech-full-e2e.ts
 *
 * Injects a TECH_COMPARISON job through the full pipeline starting at IDEA_GENERATION.
 * Provides pre-seeded research data (MacBook Air M3 vs Dell XPS 15) so the job
 * goes SCRIPTING → TECH_FOOTAGE_COLLECTING → ASSET_COLLECTION → TTS → QMS → RENDERING.
 *
 * Run from /opt/content-forge:
 *   ./node_modules/.bin/tsx apps/worker-orchestrator/src/cli/inject-tech-full-e2e.ts
 */

import { writeFile, mkdir } from "node:fs/promises";
import { statSync } from "node:fs";
import { join } from "node:path";
import { Queue } from "bullmq";

const REDIS_HOST = "127.0.0.1";
const REDIS_PORT = 6379;
const CHANNEL_ID = "82df56a3-3f7d-4886-ab9f-c9fb3ee70e74";
const TEMPLATE_ID = "40b01354-75d7-4bb2-86b1-0e437373ac28";
const LOCAL_MEDIA_ROOT =
  process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";

const RESEARCH_CONTENT = `# MacBook Air M3 vs Dell XPS 15 — Research Notes

## Overview
This comparison pits Apple's ultra-thin MacBook Air M3 against Dell's premium Windows ultrabook, the XPS 15. One prioritises efficiency and portability; the other raw power and display excellence.

## MacBook Air M3 (2024)

### Key Specs
- Chip: Apple M3 (3nm, 8-core CPU, up to 10-core GPU)
- RAM: 8 GB unified memory (base), 16 GB or 24 GB options
- Storage: 256 GB SSD (base), up to 2 TB
- Display: 13.6-inch Liquid Retina, 2560×1664, 224 ppi, 500 nits (P3 wide colour)
- Battery: 52.6 Wh; Apple claims up to 18 hours video playback
- Weight: 1.24 kg (2.7 lbs)
- Ports: 2× USB-C / Thunderbolt 3, 3.5 mm headphone jack, MagSafe 3
- Price (base): USD 1,099 (8 GB / 256 GB)
- Price (16 GB / 512 GB): USD 1,299

### Performance (Geekbench 6)
- Single-core: ~3,000
- Multi-core: ~11,800
- GPU compute: ~35,000
- Cinebench R23 multi: ~8,900

### Battery Life (Real-World)
- Web browsing: ~15–16 hours
- Video playback: ~18 hours (Apple claim, widely reproduced)
- Light creative work: ~12 hours

### Thermals
- Fanless design; sustained multi-core throttles slightly under extended loads
- Stays cool for everyday tasks; creative professionals may notice thermal limits

### Display Quality
- Excellent colour accuracy (DCI-P3)
- No ProMotion (60 Hz only)
- No OLED — LCD-based

### Verdict Strengths
- Best-in-class battery life in its category
- Silent operation
- Competitive performance per watt
- Lightweight and thin

---

## Dell XPS 15 9530 (2023/2024)

### Key Specs
- Processor: Intel Core i7-13700H or i9-13900H (13th Gen, hybrid architecture)
- GPU: NVIDIA GeForce RTX 4060 (8 GB GDDR6) — some configs with RTX 4070
- RAM: 16 GB DDR5 (base), up to 64 GB
- Storage: 512 GB NVMe SSD (base), up to 4 TB
- Display options:
  - 15.6-inch FHD+ IPS (1920×1200, 60 Hz, 500 nits)
  - 15.6-inch OLED (3456×2160, 120 Hz, 400 nits, InfinityEdge)
  - 15.6-inch 4K IPS Touch (3840×2400)
- Battery: 86 Wh
- Weight: 1.86 kg (4.1 lbs)
- Ports: 2× Thunderbolt 4 / USB-C, 1× USB-C 3.2, SD card reader, 3.5 mm jack
- Price (i7, RTX 4060, 16 GB, 512 GB): USD 1,699–1,799
- Price (i9, RTX 4070, 32 GB, 1 TB OLED): USD 2,499+

### Performance (Geekbench 6, i7-13700H)
- Single-core: ~2,800
- Multi-core: ~14,500 (more cores, higher sustained ceiling than M3 Air)
- GPU compute (RTX 4060): ~110,000 — far ahead for GPU-heavy workloads

### Battery Life (Real-World)
- Web browsing: ~6–8 hours
- Video streaming: ~5–7 hours (OLED model drains faster)
- Heavy gaming / GPU work: ~2 hours

### Thermals
- Active cooling (two fans); can run hot under sustained load (~95°C on CPU)
- Fan noise audible during rendering / gaming

### Display Quality
- OLED variant: deep blacks, 120 Hz ProMotion, stunning colour reproduction
- OLED burn-in risk over time; brightness below MacBook in sunlight
- IPS variant competitive but less impressive

### Verdict Strengths
- Discrete GPU for gaming, ML, and rendering
- Larger, higher-resolution display options (OLED)
- More RAM ceiling (64 GB)
- Better for heavy multitasking under load

---

## Head-to-Head Comparisons

### Battery Life
Winner: MacBook Air M3 by a wide margin (15–18 hrs vs 6–8 hrs). This is the single biggest differentiator for most users.

### Performance — CPU
MacBook Air M3 wins on efficiency and single-core; XPS 15 wins on sustained multi-core (especially with the i9 config). For most everyday tasks the M3 Air feels faster day-to-day.

### Performance — GPU
Winner: Dell XPS 15 with RTX 4060/4070. The discrete NVIDIA GPU is 3× faster on GPU compute than the M3's integrated GPU. Essential for gaming, ML training, video encoding with CUDA.

### Display
Winner: Dell XPS 15 OLED. 120 Hz, OLED contrast, 3456×2160 resolution is stunning. The MacBook Air's 60 Hz LCD Retina is excellent but can't match OLED blacks or refresh rate.

### Portability
Winner: MacBook Air M3. 0.62 kg lighter, thinner, and completely silent.

### Value
MacBook Air M3 at USD 1,099 delivers more performance per dollar for everyday tasks. XPS 15 at USD 1,699+ is premium but justified for GPU workloads.

### Software Ecosystem
- MacBook: macOS, tight hardware-software integration, Final Cut Pro, Logic Pro
- XPS 15: Windows 11, full gaming library, broader peripheral support, WSL2 for Linux devs

---

## Summary
- **Choose MacBook Air M3** if: battery matters, you value silence, you do light-to-medium creative work, you're in the Apple ecosystem.
- **Choose Dell XPS 15** if: you need a discrete GPU, want a larger OLED display, run GPU-heavy workloads (gaming, ML, 3D render).
`;

async function main() {
  console.log("\n=== TECH COMPARISON — FULL END-TO-END JOB ===");
  console.log("Topic: MacBook Air M3 vs Dell XPS 15\n");

  // 1. Write research file to local media root
  const researchDir = join(LOCAL_MEDIA_ROOT, "research");
  const researchPath = join(researchDir, "macbook-air-m3-vs-dell-xps15.md");

  await mkdir(researchDir, { recursive: true });
  await writeFile(researchPath, RESEARCH_CONTENT, "utf-8");

  const { size: researchSizeBytes } = statSync(researchPath);
  console.log(
    `[research] Written to ${researchPath} (${researchSizeBytes} bytes)`,
  );

  // 2. Dispatch ingest job with research pre-loaded
  const ingestQueue = new Queue("queue-ingest", {
    connection: { host: REDIS_HOST, port: REDIS_PORT },
  });

  const payload = {
    channel_id: CHANNEL_ID,
    template_id: TEMPLATE_ID,
    format: "TECH_COMPARISON",
    language: "en",
    production_version: "V2",
    initial_topic:
      "MacBook Air M3 vs Dell XPS 15 — Which Laptop Should You Buy?",
    skip_image_qc: true,
    skip_final_qc: true,
    metadata: {
      comparison: {
        product_a_name: "MacBook Air M3",
        product_b_name: "Dell XPS 15",
        subformat: "TECH_HARDWARE",
      },
      pipeline_config: { needs_scene_analysis: false },
    },
    pre_uploaded_assets: [
      {
        key: researchPath,
        type: "research/perplexity",
        size_bytes: researchSizeBytes,
      },
    ],
  };

  const job = await ingestQueue.add("ingest", payload, {
    priority: 1,
    attempts: 2,
  });
  await ingestQueue.close();

  console.log(`\n✅ Dispatched to queue-ingest (BullMQ job: ${job.id})`);
  console.log(`\nThe job will flow through:`);
  console.log(`  IDEA_GENERATION → SCRIPTING (Claude script from research)`);
  console.log(`  → TECH_FOOTAGE_COLLECTING (yt-dlp / Pexels)`);
  console.log(`  → ASSET_COLLECTION (images via media-gateway)`);
  console.log(`  → TTS_GENERATING (Fish Audio / ElevenLabs)`);
  console.log(`  → QMS_VALIDATING → ROUTING_RENDER → RENDERING_REMOTION`);
  console.log(`  → AWAITING_UPLOADER`);
  console.log(`\nMonitor with:`);
  console.log(`  pm2 logs worker-orchestrator --lines 100`);
  console.log(
    `  SELECT id, status, status_updated_at FROM content_jobs WHERE channel_id = '${CHANNEL_ID}' ORDER BY created_at DESC LIMIT 3;`,
  );
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
