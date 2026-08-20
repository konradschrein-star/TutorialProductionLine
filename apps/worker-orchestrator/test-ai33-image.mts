#!/usr/bin/env node
/**
 * Quick smoke test for AI33 image generation.
 * Usage: npx tsx test-ai33-image.mts
 * Output: test-ai33-output.jpg in the same directory
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.AI33_API_KEY;
if (!API_KEY) {
  console.error("Set AI33_API_KEY env var before running this script");
  process.exit(1);
}

const { generateImage } = await import("./src/utils/ai33-client.js");

console.log("[ai33-test] Submitting image generation request...");
console.log("[ai33-test] Model: bytedance-seedream-4.5 | Aspect: 16:9 | Resolution: 2K");

const prompt =
  "A futuristic city skyline at night with glowing cyan and violet neon lights reflecting on wet streets, cinematic wide shot, 8K";

const start = Date.now();
const buffer = await generateImage(API_KEY, prompt, "16:9");
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

const outputPath = join(__dirname, "test-ai33-output.jpg");
writeFileSync(outputPath, buffer);

console.log(`[ai33-test] Done in ${elapsed}s — ${(buffer.length / 1024).toFixed(0)} KB`);
console.log(`[ai33-test] Saved to: ${outputPath}`);
