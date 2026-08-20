#!/usr/bin/env tsx
/**
 * Seed: Casually Explained Clip-Based Template + Clip Library Config
 *
 * Creates a CASUALLY_EXPLAINED variant that uses real video clips from a
 * clip library instead of AI-generated B-roll images.
 *
 * Pipeline:
 *   SCRIPTING → ASSET_COLLECTION → CLIP_SELECTION → [AWAITING_CLIP_REVIEW] →
 *   QMS_VALIDATING → ROUTING_RENDER → RENDERING_FFMPEG → AWAITING_QC
 *
 * Asset Requirements:
 *   - audio/tts: TTS narration (AI33 TTS, replaces HeyGen)
 *   Clips come from the clip library (not tracked in r2_asset_manifest).
 *
 * Render workflow: "clip-ffmpeg"
 *   Reads the approved edit list, extracts clip segments from local source
 *   videos, concatenates, mixes TTS audio, burns ASS captions.
 *
 * Usage:
 *   pnpm --filter @repo/db seed:casually-explained-clip
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { contentTemplates } from "./schema/content-templates.js";
import { clipLibraries, clipLibraryConfigs } from "./schema/index.js";
import { eq } from "drizzle-orm";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../../../.env") });

import { loadConfig, getConfig } from "@repo/config";

async function seed() {
  loadConfig();
  const { DATABASE_URL } = getConfig();
  const sql = postgres(DATABASE_URL);
  const db = drizzle(sql);

  // ── 1. Template ────────────────────────────────────────────────────────────
  const templateName = "Casually Explained (Clip-Based)";

  const templateData = {
    name: templateName,
    description:
      "Clip-based Casually Explained variant. Uses TTS narration over real video clips from the clip library instead of AI-generated images.",
    format: "CASUALLY_EXPLAINED" as const,

    pipeline_stages: [
      "SCRIPTING",
      "ASSET_COLLECTION",
      "CLIP_SELECTION",
      "QMS_VALIDATING",
      "ROUTING_RENDER",
      "RENDERING_FFMPEG",
      "AWAITING_QC",
    ],

    prompts: {
      script: `You are a scriptwriter for a dry-humor explainer channel in the style of "Casually Explained".

Write a compelling, subtly humorous explainer script on the following topic: \${topic}

Requirements:
- 600-900 words (approximately 4-6 minutes of speaking time)
- Tone: casual, deadpan, slightly self-aware — smart observations delivered with deliberate understatement
- Structure: Hook → Concept breakdown → Examples → Deeper analysis → Conclusion
- No bullet points or headers — continuous prose suitable for spoken delivery
- Each paragraph should be 2-4 sentences forming a natural visual scene
- The humor comes from understatement and precise observation, not jokes

Output the script text only. No stage directions, no [brackets], no metadata.`,
    },

    render_config: {
      engine: "FFMPEG" as const,
      workflow: "clip-ffmpeg",
      settings: {
        fps: 30,
        width: 1920,
        height: 1080,
      },
      captions_enabled: true,
    },

    required_assets: ["audio/tts"],

    metadata: {
      pipeline_config: {
        // TTS is required (no HeyGen)
        no_tts: false,
        needs_scene_analysis: false,
        // No VA approval step — clip selection handles visual content
        awaiting_va_after_automated: false,
      },
    },

    is_active: true,
  };

  const [existingTemplate] = await db
    .select({ id: contentTemplates.id })
    .from(contentTemplates)
    .where(eq(contentTemplates.name, templateName))
    .limit(1);

  let templateId: string;

  if (existingTemplate) {
    await db
      .update(contentTemplates)
      .set(templateData as any)
      .where(eq(contentTemplates.id, existingTemplate.id));
    templateId = existingTemplate.id;
    console.log(`[seed] Updated template: ${templateName} (${templateId})`);
  } else {
    const [inserted] = await db
      .insert(contentTemplates)
      .values(templateData as any)
      .returning({ id: contentTemplates.id });
    templateId = inserted!.id;
    console.log(`[seed] Created template: ${templateName} (${templateId})`);
  }

  // ── 2. Clip Library (upsert by name) ──────────────────────────────────────
  const libraryName = "Casually Explained Stock Clips";

  const libraryData = {
    name: libraryName,
    description:
      "Stock clip library for Casually Explained format. Add source videos via /clip-library.",
    storage_strategy: "inline" as const,
    tag_vocabulary: {
      mood: [
        "funny",
        "serious",
        "absurd",
        "deadpan",
        "educational",
        "dramatic",
      ],
      location: ["office", "outdoors", "street", "home", "lab", "generic"],
      action: [
        "talking",
        "working",
        "walking",
        "reacting",
        "presenting",
        "idle",
      ],
      custom: ["b-roll", "interview", "cutaway", "montage"],
    },
  };

  const [existingLibrary] = await db
    .select({ id: clipLibraries.id })
    .from(clipLibraries)
    .where(eq(clipLibraries.name, libraryName))
    .limit(1);

  let libraryId: string;

  if (existingLibrary) {
    await db
      .update(clipLibraries)
      .set(libraryData as any)
      .where(eq(clipLibraries.id, existingLibrary.id));
    libraryId = existingLibrary.id;
    console.log(`[seed] Updated clip library: ${libraryName} (${libraryId})`);
  } else {
    const [inserted] = await db
      .insert(clipLibraries)
      .values(libraryData as any)
      .returning({ id: clipLibraries.id });
    libraryId = inserted!.id;
    console.log(`[seed] Created clip library: ${libraryName} (${libraryId})`);
  }

  // ── 3. Clip Library Config (format-level, channel-agnostic) ───────────────
  // Upsert by format (channel_id = null means all channels for this format)
  const [existingConfig] = await db
    .select({ id: clipLibraryConfigs.id })
    .from(clipLibraryConfigs)
    .where(eq(clipLibraryConfigs.format, "CASUALLY_EXPLAINED"))
    .limit(1);

  const configData = {
    format: "CASUALLY_EXPLAINED" as const,
    channel_id: null,
    clip_library_id: libraryId,
    clip_selection_enabled: true,
    hitl_clip_review: true,
    clips_per_sentence: 1,
    min_gap_before_repeat: 5,
    character_continuity: "off" as const,
    broll_fallback_enabled: true,
    broll_fallback_model: "nanob2",
    playbook: {
      format: "CASUALLY_EXPLAINED",
      tone: "dry_humor_explainer",
      visual_style: "factual_b_roll",
      shot_scale_preferences: ["medium", "close", "wide"],
      pacing: "sentence_aligned",
      avoid_audio_classes: ["music_only", "silence"],
      character_continuity: "off",
      description:
        "Select factual B-roll clips that match the spoken sentence. Prefer medium and close shots for dialogue-driven content. Avoid music-only or silent clips.",
    },
  };

  if (existingConfig) {
    await db
      .update(clipLibraryConfigs)
      .set(configData as any)
      .where(eq(clipLibraryConfigs.id, existingConfig.id));
    console.log(
      `[seed] Updated clip library config for CASUALLY_EXPLAINED (${existingConfig.id})`,
    );
  } else {
    const [inserted] = await db
      .insert(clipLibraryConfigs)
      .values(configData as any)
      .returning({ id: clipLibraryConfigs.id });
    console.log(
      `[seed] Created clip library config for CASUALLY_EXPLAINED (${inserted!.id})`,
    );
  }

  await sql.end();
  console.log("\n[seed] Done.");
  console.log(
    "\nTo use: create a job with the 'Casually Explained (Clip-Based)' template.",
  );
  console.log(
    "Add source videos via /clip-library before running clip selection.",
  );
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
