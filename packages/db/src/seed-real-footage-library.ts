#!/usr/bin/env tsx
/**
 * Seed: Real-Footage clip library
 *
 * Creates a generic library for stock photography / real-world clips
 * (no franchise constraint) so the image ingestion pipeline can be tested
 * end-to-end against Pexels API and arbitrary uploads.
 *
 * Tag vocabulary tuned for general-purpose real-world media — characters
 * (people roles), moods, locations, actions, all common enough that
 * Gemini's vocabulary-constrained labeling has plenty to work with.
 *
 * Usage:
 *   pnpm --filter @repo/db exec tsx src/seed-real-footage-library.ts
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../../../.env") });

import { loadConfig, getConfig } from "@repo/config";
import { clipLibraries } from "./schema/index.js";

const REAL_FOOTAGE_SLUG = "real-footage";

async function seed() {
  console.log("[seed-real-footage-library] Loading config…");
  try {
    loadConfig();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  const { DATABASE_URL } = getConfig();
  const sqlClient = postgres(DATABASE_URL);
  const db = drizzle(sqlClient);

  const tagVocabulary = {
    characters: [
      "man",
      "woman",
      "child",
      "elderly_person",
      "group",
      "crowd",
      "couple",
      "family",
      "worker",
      "professional",
      "athlete",
      "musician",
      "doctor",
      "soldier",
      "tourist",
    ],
    moods: [
      "joyful",
      "tense",
      "calm",
      "melancholic",
      "energetic",
      "mysterious",
      "intimate",
      "epic",
      "nostalgic",
      "hopeful",
      "menacing",
      "lonely",
    ],
    locations: [
      "city_street",
      "office",
      "home_interior",
      "kitchen",
      "forest",
      "beach",
      "mountain",
      "desert",
      "ocean",
      "highway",
      "subway",
      "airport",
      "park",
      "factory",
      "stadium",
      "concert_venue",
      "hospital",
      "school",
      "rural_field",
      "skyline",
    ],
    actions: [
      "walking",
      "running",
      "working",
      "celebrating",
      "fighting",
      "embracing",
      "dancing",
      "driving",
      "talking",
      "eating",
      "playing",
      "watching",
      "building",
      "destroying",
      "performing",
      "protesting",
      "exercising",
      "studying",
    ],
  };

  try {
    const [existing] = await db
      .select({ id: clipLibraries.id, slug: clipLibraries.slug })
      .from(clipLibraries)
      .where(eq(clipLibraries.slug, REAL_FOOTAGE_SLUG))
      .limit(1);

    if (existing) {
      console.log(
        `[seed-real-footage-library] library '${REAL_FOOTAGE_SLUG}' already exists (id=${existing.id}). Updating tag_vocabulary…`,
      );
      await db
        .update(clipLibraries)
        .set({
          tag_vocabulary: tagVocabulary,
          updated_at: new Date(),
        })
        .where(eq(clipLibraries.id, existing.id));
    } else {
      const [inserted] = await db
        .insert(clipLibraries)
        .values({
          name: "Real Footage (Vidrush-style)",
          slug: REAL_FOOTAGE_SLUG,
          description:
            "Generic real-world stock library: photos and clips with no franchise constraint. Tag vocabulary tuned for everyday real-world media.",
          tag_vocabulary: tagVocabulary,
          clip_storage_strategy: "inline" as const,
          is_active: true,
          // Drama-specific fields stay at their defaults; they don't apply here.
          character_block: "",
          script_prompt: "",
          music_mode: "generate",
          music_volume_db: -28,
          use_reference_scripts: false,
          // Global library settings (from Phase 1 migration)
          storage_backend: "local" as const,
          labeling_concurrency: 4,
        })
        .returning({ id: clipLibraries.id });

      console.log(
        `[seed-real-footage-library] created library id=${inserted!.id}`,
      );
    }
  } finally {
    await sqlClient.end();
  }

  console.log("[seed-real-footage-library] done.");
}

seed().catch((err) => {
  console.error("[seed-real-footage-library] FAILED:", err);
  process.exit(1);
});
