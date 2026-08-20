#!/usr/bin/env tsx
/**
 * Seed: Casually Explained Template
 *
 * Inserts (or upserts) the CASUALLY_EXPLAINED content template.
 *
 * ARCHITECTURE:
 *
 * Scene Decomposition:
 *   Uses per-paragraph analysis with built-in buildIllustrationSceneSystemPrompt.
 *   Script is split into paragraphs (one scene per paragraph), then each
 *   paragraph is analyzed independently via Claude API in parallel (max 4 concurrent).
 *   No template-defined scene_analysis prompt is used.
 *
 * Asset Requirements (QMS-validated before render):
 *   - image/thumbnail: Video thumbnail
 *   - video/raw-va-footage: HeyGen avatar video (uploaded by Production VA)
 *   - image/broll: Sentence-level illustration-style images (AI-generated via nanob2 model)
 *
 * Image Model Routing:
 *   render_config.image_model: "nanob2" → AI33 Gemini Flash Image Preview (1K resolution)
 *   Illustration style optimized for flat, simple art like "Casually Explained" YouTube channel.
 *
 * Pipeline config flags (stored in template.metadata.pipeline_config):
 *   needs_scene_analysis: true      → asset-collection dispatches scene-analysis before image gen
 *   no_tts: true                    → HeyGen video is the audio source, skip TTS generation
 *   scene_count: 10                 → not used by paragraph-based analysis (legacy field)
 *   awaiting_va_after_automated: true → after scene images + thumbnail, wait for VA HeyGen upload
 *
 * render_config flags (custom, read as `any`):
 *   image_model: "nanob2"           → routes AI33 image generation to Nano Banana 2
 *   image_style: "illustration"     → routes prompt enrichment to illustration path (skips camera specs)
 *   force_layout: "AVATAR_PIP"      → all scenes locked to AVATAR_PIP bottom-right layout
 *
 * Usage:
 *   pnpm --filter @repo/db seed:casually-explained
 *   OR
 *   tsx packages/db/src/seed-casually-explained-template.ts
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { contentTemplates } from "./schema/content-templates.js";
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
  console.log("[seed-template] Loading config...");
  try {
    loadConfig();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  const { DATABASE_URL } = getConfig();
  const sql = postgres(DATABASE_URL);
  const db = drizzle(sql);

  const templateName = "Casually Explained";

  // Check if already exists
  const [existing] = await db
    .select({ id: contentTemplates.id })
    .from(contentTemplates)
    .where(eq(contentTemplates.name, templateName))
    .limit(1);

  const templateData = {
    name: templateName,
    description:
      "Dry-humor explanatory commentary with stick-figure illustration art and HeyGen avatar in bottom-right corner. Style inspired by the Casually Explained YouTube channel.",
    format: "CASUALLY_EXPLAINED" as const,

    pipeline_stages: [
      "SCRIPTING",
      "ASSET_COLLECTION",
      "AWAITING_PRODUCTION_VA",
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
- Structure: Hook (intriguing or absurd opening observation) → Concept breakdown (explain the core idea with dry wit) → Examples (concrete, slightly ridiculous real-world examples) → Deeper analysis (where it gets more interesting) → Conclusion (a slightly unexpected or self-deprecating wrap-up)
- No bullet points or headers — continuous prose suitable for spoken delivery
- Each paragraph should be 2-4 sentences forming a natural visual scene
- The humor comes from understatement and precise observation, not jokes — treat the topic as if analyzing it scientifically even when the subject is absurd
- Include specific facts or analogies where they make the point more amusingly accurate
- Tone: think a slightly too-analytical person explaining why human behavior makes no sense

Output the script text only. No stage directions, no [brackets], no metadata.`,
      // Note: scene_analysis prompt not needed - this template uses built-in
      // per-paragraph analysis (buildIllustrationSceneSystemPrompt)
    },

    render_config: {
      engine: "FFMPEG" as const,
      settings: {
        fps: 30,
        width: 1920,
        height: 1080,
      },
      captions_enabled: true,
      // Custom flags read by workers (stored as JSONB, accessed via `as any`)
      image_model: "nanob2",
      image_style: "illustration",
      force_layout: "AVATAR_PIP",
    },

    required_assets: ["image/thumbnail", "video/raw-va-footage", "image/broll"],

    metadata: {
      archetype_id: "bc1827c2-b274-4400-bdfb-d1c6eb092339", // CASUALLY_EXPLAINED archetype (has style guide reference images)
      pipeline_config: {
        needs_scene_analysis: true,
        no_tts: true,
        scene_count: 10,
        awaiting_va_after_automated: true,
        avatar_overlay: {
          enabled: true,
          position: "bottom-right",
          height_percent: 28,
          border_radius: 12,
        },
      },
      // NOTE: prompt_prefix/suffix intentionally do NOT say "no photorealism" or
      // force a white background — CASUALLY_EXPLAINED's scene-analysis system
      // prompt (buildIllustrationSceneSystemPrompt, STYLE BLEND section) instructs
      // Claude to write hybrid scenes (stick figure + photorealistic/richly
      // detailed background) and PHOTO:-prefixed fully-photorealistic scenes for
      // named real-world objects. A blanket "no photorealism" suffix here would
      // contradict those raw descriptions in every single prompt. Character
      // rendering is still constrained to line art via buildIllustrationImagePrompt's
      // hybridStyle flag (apps/worker-orchestrator/src/processors/scene-analysis.ts).
      style_preset: {
        name: "Casually Explained Hybrid",
        prompt_prefix:
          "Stick-figure character rendered in simple hand-drawn black line art, thick outlines, minimal detail,",
        prompt_suffix:
          "background follows the scene description exactly (plain white background for simple scenes, photorealistic or richly-detailed background when the scene calls for a hybrid look), no text, no labels, no writing, no watermarks baked into the image",
      },
    },

    is_active: true,
  };

  if (existing) {
    await db
      .update(contentTemplates)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(templateData as any)
      .where(eq(contentTemplates.id, existing.id));
    console.log(`[seed-template] Updated existing template: ${existing.id}`);
  } else {
    const [inserted] = await db
      .insert(contentTemplates)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values(templateData as any)
      .returning({ id: contentTemplates.id });
    console.log(`[seed-template] Inserted new template: ${inserted.id}`);
  }

  console.log("[seed-template] Done.");
  await sql.end();
  process.exit(0);
}

seedTemplate().catch((err) => {
  console.error("[seed-template] Fatal:", err);
  process.exit(1);
});
