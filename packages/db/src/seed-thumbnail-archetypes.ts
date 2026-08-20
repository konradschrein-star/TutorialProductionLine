#!/usr/bin/env tsx
/**
 * Seed: Thumbnail Archetypes
 *
 * Ports the real reference-thumbnail images + metadata from the previous
 * "Thumbnail Creator V2" tool into the global thumbnail engine. For each
 * vendored image (packages/db/seed-assets/thumbnail-archetypes/), this:
 *   1. Copies the file to THUMBNAIL_MEDIA_DIR/archetypes/<file> so the
 *      worker can read it as an i2i reference at generation time.
 *   2. Inserts a thumbnail_archetypes row pointing at that destination path.
 *
 * Idempotent by `name` — re-running skips archetypes that already exist.
 *
 * Usage:
 *   pnpm --filter @repo/db seed:thumbnail-archetypes
 *   OR
 *   tsx packages/db/src/seed-thumbnail-archetypes.ts
 */

import { copyFile, mkdir } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, "../../../.env");
config({ path: envPath });

import { loadConfig, getConfig } from "@repo/config";
import { createDrizzleClient } from "./client.js";
import { thumbnailArchetypes } from "./schema/thumbnails.js";
import { createThumbnailArchetype } from "./repositories/thumbnail-repository.js";

// Ported from the old Thumbnail Creator V2's lib/emergency-data.ts
// (EMERGENCY_ARCHETYPES) — the only source of truth for these images' real
// names/prompts. Neither `category` nor `featuresLogo` existed on that
// model, so both default per the task spec (General / false).
const ARCHETYPES: Array<{
  file: string;
  name: string;
  layoutInstructions: string;
  basePrompt: string;
}> = [
  {
    file: "archetype2.jpg",
    name: "Striking Warning Style",
    layoutInstructions:
      "Bold warning colors with strong visual impact for attention-grabbing content",
    basePrompt:
      "Give the image a striking, attention-grabbing vibe with bold, intense lighting. It should feel urgent and high-energy.",
  },
  {
    file: "archetype3.jpeg",
    name: "Modern Productivity Style",
    layoutInstructions:
      "Clean, modern aesthetic focused on productivity and workspace content",
    basePrompt:
      "Maintain a clean, modern, and professional aesthetic. The vibe should be productive, minimalist, and highly polished.",
  },
  {
    file: "archetype4.jpeg",
    name: "Dramatic Bold Style",
    layoutInstructions:
      "Edgy, rebellious design with strong contrast for opinion/controversial content",
    basePrompt:
      "Create an edgy, dramatic atmosphere with deep contrast and a slightly rebellious or intense vibe.",
  },
  {
    file: "archetype5.jpeg",
    name: "Educational Friendly Style",
    layoutInstructions:
      "Approachable, beginner-friendly design for step-by-step tutorials",
    basePrompt:
      "Keep the atmosphere approachable, friendly, and educational. The tone should feel helpful, clear, and inviting for beginners.",
  },
  {
    file: "archetype6.jpeg",
    name: "Energetic Tech Style",
    layoutInstructions:
      "Dynamic, tech-focused layout with movement and energy for quick tips",
    basePrompt:
      "Infuse the image with dynamic movement and energy. It should feel highly focused on technology and fast-paced learning.",
  },
  {
    file: "archetype7.jpeg",
    name: "Comparison Battle Style",
    layoutInstructions:
      "Split-screen comparison design with dramatic versus styling",
    basePrompt:
      "Enhance a dramatic split-screen or versus vibe. It should feel highly competitive and comparative.",
  },
  {
    file: "Archetype.png",
    name: "Premium Titan Style",
    layoutInstructions:
      "Highly curated, exclusive premium layout for top-tier content",
    basePrompt:
      "Ensure an extremely premium, high-end visual aesthetic. It should look highly curated, flawless, and exclusive.",
  },
];

const FORMATS = [
  "TUTORIAL_STUDIO",
  "TECH_COMPARISON",
  "EXPLAINER",
  "CASUALLY_EXPLAINED",
];

async function seed() {
  console.log("[seed-thumbnail-archetypes] Loading config...");
  try {
    loadConfig();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  const { DATABASE_URL } = getConfig();
  const db = createDrizzleClient(DATABASE_URL);

  const mediaDir =
    process.env.THUMBNAIL_MEDIA_DIR ?? "/opt/content-forge/media/thumbnails";
  const destDir = join(mediaDir, "archetypes");
  await mkdir(destDir, { recursive: true });

  const sourceDir = resolve(__dirname, "../seed-assets/thumbnail-archetypes");

  let created = 0;
  let skipped = 0;

  for (const arch of ARCHETYPES) {
    const [existing] = await db
      .select({ id: thumbnailArchetypes.id })
      .from(thumbnailArchetypes)
      .where(eq(thumbnailArchetypes.name, arch.name))
      .limit(1);

    if (existing) {
      console.log(
        `[seed-thumbnail-archetypes] Skipped (already exists): ${arch.name}`,
      );
      skipped++;
      continue;
    }

    const sourcePath = join(sourceDir, arch.file);
    const destPath = join(destDir, arch.file);
    await copyFile(sourcePath, destPath);

    const row = await createThumbnailArchetype(db, {
      name: arch.name,
      reference_image_path: destPath,
      layout_instructions: arch.layoutInstructions,
      base_prompt: arch.basePrompt,
      features_logo: false,
      category: "General",
      formats: FORMATS,
    });

    console.log(
      `[seed-thumbnail-archetypes] Created: ${arch.name} (${row.id}) → ${destPath}`,
    );
    created++;
  }

  console.log("\n[seed-thumbnail-archetypes] Summary");
  console.log(`  Created: ${created}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Total:   ${ARCHETYPES.length}`);
  console.log("[seed-thumbnail-archetypes] Done.");

  process.exit(0);
}

seed().catch((err) => {
  console.error("[seed-thumbnail-archetypes] Fatal:", err);
  process.exit(1);
});
