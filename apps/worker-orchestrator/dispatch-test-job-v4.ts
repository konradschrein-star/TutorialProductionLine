/**
 * Test script for Bundestag pipeline with cut-snapping fix
 *
 * Tests:
 * - Word-level timestamps sent to LLM
 * - Cut-snapping to speech pauses (>200ms)
 * - No mid-word cuts
 */

import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullmqAdapter";
import { Queue } from "bullmq";
import Redis from "ioredis";

// ──────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// ──────────────────────────────────────────────────────────────
// Create Queue Connection
// ──────────────────────────────────────────────────────────────

const queueConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

// ──────────────────────────────────────────────────────────────
// Create Ingest Queue
// ──────────────────────────────────────────────────────────────

const ingestQueue = new Queue("queue-ingest", {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: false,
    removeOnFail: false,
  },
});

// ──────────────────────────────────────────────────────────────
// Dispatch Test Job
// ──────────────────────────────────────────────────────────────

async function dispatchTestJob() {
  console.log("🚀 Dispatching Bundestag test job (v4 - cut-snapping fix)...");

  const payload = {
    channel_id: "97c2eb9e-0bb9-4878-bbb6-d26d4e51c19f",
    format: "BUNDESTAG",
    template_id: "154304ff-814a-4efc-b558-824fdb8f4253", // Use existing template UUID
    production_version: "V3",
    initial_topic: "Test: Word-level timestamps + cut-snapping",
    bundestag_clip_paths: [
      "/opt/content-forge/media/bundestag/staging/clip-1-wide.mp4",
      "/opt/content-forge/media/bundestag/staging/clip-2-closeup.mp4",
    ],
    skip_image_qc: true,
    skip_final_qc: true,
    language: "de",
  };

  const job = await ingestQueue.add("ingest", payload, {
    jobId: `bundestag-test-v4-${Date.now()}`,
    removeOnComplete: false,
    removeOnFail: false,
  });

  console.log("✅ Job dispatched successfully");
  console.log(`   Job ID: ${job.id}`);
  console.log(`   Format: BUNDESTAG`);
  console.log(`   Clips: 2`);
  console.log(`   Test: Word-level timestamps + cut-snapping to pauses`);
  console.log("");
  console.log("Expected improvements:");
  console.log("  ✅ No mid-word cuts");
  console.log("  ✅ Cuts only at speech pauses (>200ms)");
  console.log("  ✅ Word timestamps visible in playbook generation logs");
  console.log("");
  console.log("Monitor progress:");
  console.log(
    `  pm2 logs worker-orchestrator | grep ${job.id!.substring(0, 10)}`,
  );

  process.exit(0);
}

// ──────────────────────────────────────────────────────────────
// Run
// ──────────────────────────────────────────────────────────────

dispatchTestJob().catch((error) => {
  console.error("❌ Error dispatching test job:", error);
  process.exit(1);
});
