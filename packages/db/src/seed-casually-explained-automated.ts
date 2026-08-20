#!/usr/bin/env tsx
/**
 * Seed: Casually Explained (Automated) Template
 *
 * Hybrid stick figure + AI-generated photorealistic composition style.
 * Uses Nano Banana 2 to generate complete scenes with both illustrated characters
 * and AI-generated realistic photos/charts/diagrams in a single composition.
 *
 * Pipeline: Topic → Script → Scene breakdown → TTS → Visual assets → Render → Upload
 * No human QC gate - fully automated 24/7 production
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { contentTemplates, archetypes } from "./schema/index.js";
import { eq } from "drizzle-orm";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, "../../../.env");
config({ path: envPath });

import { loadConfig, getConfig } from "@repo/config";

async function seedTemplate() {
  console.log("[seed-casually-explained-automated] Loading config...");
  try {
    loadConfig();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  const { DATABASE_URL } = getConfig();
  const sql = postgres(DATABASE_URL);
  const db = drizzle(sql);

  const templateName = "Casually Explained (Automated)";

  // Fetch the CASUALLY_EXPLAINED archetype
  const [explainerArchetype] = await db
    .select({ id: archetypes.id })
    .from(archetypes)
    .where(eq(archetypes.name, "CASUALLY_EXPLAINED"))
    .limit(1);

  if (!explainerArchetype) {
    console.error(
      "[seed-casually-explained-automated] ERROR: CASUALLY_EXPLAINED archetype not found. Run seed:archetypes first.",
    );
    await sql.end();
    process.exit(1);
  }

  console.log(
    `[seed-casually-explained-automated] Found CASUALLY_EXPLAINED archetype: ${explainerArchetype.id}`,
  );

  // Check if already exists
  const [existing] = await db
    .select({ id: contentTemplates.id })
    .from(contentTemplates)
    .where(eq(contentTemplates.name, templateName))
    .limit(1);

  const templateData = {
    name: templateName,
    description:
      "Casually Explained style with fully AI-generated hybrid compositions combining stick figures and photorealistic elements. Uses Nano Banana 2 for fast generation. No human QC required - optimized for high-volume automated production with 'good enough' quality expectations.",
    format: "EXPLAINER" as const,

    pipeline_stages: [
      "SCRIPTING",
      "ASSET_COLLECTION",
      "QMS_VALIDATING",
      "ROUTING_RENDER",
      "RENDERING_FFMPEG",
      "AWAITING_UPLOADER",
    ],

    prompts: {
      script_generation: `You are an expert comedy educational content writer creating Casually Explained-style video scripts.

Topic: \${topic}
Complexity Level: \${complexity_level}
Target Duration: \${target_duration_seconds} seconds

Tone Guidelines:
- Dry, deadpan humor with self-aware narrator
- Ironic observations and unexpected comparisons
- Relatable modern life references
- Understatement and casual language
- Occasional absurdist tangents that circle back to the point

Structure:
- Hook: Relatable observation or ironic statement (10-15 sec)
- Main content: Educational explanation with humor mixed in
- Running gags or callback jokes throughout
- Summary: Dry conclusion with final punchline (10-15 sec)

Guidelines:
- Each paragraph should be 2-4 sentences (visual scene boundary)
- Total word count: ~\${word_count} words (based on target duration)
- Natural pauses for visual transitions

Output the script as plain text paragraphs.`,
      // NOTE: EXPLAINER format uses built-in illustration prompts (buildIllustrationImagePrompt)
      // based on image_style="illustration" in render_config. Do NOT add scene_description here.
    },

    render_config: {
      workflow: "v3-ffmpeg" as const,
      engine: "FFMPEG" as const,
      image_style: "illustration",
      image_model: "nanob2", // Routes to Gemini Nano Banana 2 (gemini-3.1-flash-image-preview, 1K resolution)
      force_layout: "IMAGE_FULLSCREEN", // Fullscreen B-roll (no avatar overlay) - avoids deprecated composition function
      qc_image_review_required: false,
      settings: {
        fps: 30,
        width: 1920,
        height: 1080,
        video_codec: "libx264",
        audio_codec: "aac",
        crf: 23,
        preset: "medium",
        ken_burns_enabled: true,
        ken_burns_intensity: 0.6,
      },
      captions_enabled: true,
    },

    required_assets: [
      "audio/tts",
      "script", // Script stored in DB column, not R2
    ],
    // Note: image/broll assets are validated separately in V2 production_version check
    // Subtitles are optional and generated during render, not required before QMS

    metadata: {
      production_version: "V1",
      archetype_id: explainerArchetype.id,
      production_config: {
        supports_avatar: false,
        requires_avatar: false,
        typical_duration_range: [60, 600],
        typical_scene_count_range: [5, 30],
        needs_scene_analysis: true,
        scene_pacing_strategy: "word-aligned",
        supports_composite_layouts: true,
        supports_reference_images: true,
      },
      style_preset: {
        name: "Casually Explained Hybrid (Automated)",
        prompt_prefix:
          "Hybrid composition combining simple stick figures AND photorealistic elements,",
        prompt_suffix:
          "stick figures: thick black outlines, large circular heads, big round eyes, hand-drawn minimal feel; photorealistic elements: professional quality photography, proper lighting, realistic textures; clean off-white background #FAFAFA, 16:9 aspect ratio, high quality",
        caption_style: {
          backgroundColor: "rgba(0, 0, 0, 0.7)",
          textColor: "#FFFFFF",
          accentColor: "#4A90E2",
          position: "bottom-center",
        },
      },
    },

    is_active: true,
  };

  if (existing) {
    await db
      .update(contentTemplates)
      .set({ ...templateData, updated_at: new Date() })
      .where(eq(contentTemplates.id, existing.id));
    console.log(
      `[seed-casually-explained-automated] ✓ Updated existing template: ${existing.id}`,
    );
  } else {
    const [inserted] = await db
      .insert(contentTemplates)
      .values(templateData)
      .returning({ id: contentTemplates.id });
    console.log(
      `[seed-casually-explained-automated] ✓ Inserted new template: ${inserted!.id}`,
    );
  }

  console.log("[seed-casually-explained-automated] Done.");
  await sql.end();
  process.exit(0);
}

seedTemplate().catch((err) => {
  console.error("[seed-casually-explained-automated] Fatal:", err);
  process.exit(1);
});
