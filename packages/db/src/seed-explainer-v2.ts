#!/usr/bin/env tsx
/**
 * Seed: Explainer V2 Template
 *
 * PowerPoint-style composite layout explainer using Nano Banana 2 (gemini-3.1-flash-image-preview).
 * Multiple images per scene with reference image support for consistent visual theming.
 * Pipeline: Topic → Script → Scene breakdown → TTS → Visual assets → Render
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
  console.log("[seed-explainer-v2] Loading config...");
  try { loadConfig(); } catch (e) { console.error(e); process.exit(1); }

  const { DATABASE_URL } = getConfig();
  const sql = postgres(DATABASE_URL);
  const db = drizzle(sql);

  const templateName = "Explainer V2";

  // Fetch the FLAT_ILLUSTRATION archetype (used for illustration-style explainers)
  const [flatIllustrationArchetype] = await db
    .select()
    .from(archetypes)
    .where(eq(archetypes.name, "FLAT_ILLUSTRATION"))
    .limit(1);

  if (!flatIllustrationArchetype) {
    console.error("[seed-explainer-v2] ERROR: FLAT_ILLUSTRATION archetype not found — run seed:archetypes first");
    await sql.end();
    process.exit(1);
  }

  console.log(`[seed-explainer-v2] Found FLAT_ILLUSTRATION archetype: ${flatIllustrationArchetype.id}`);

  // Check if already exists
  const [existing] = await db
    .select({ id: contentTemplates.id })
    .from(contentTemplates)
    .where(eq(contentTemplates.name, templateName))
    .limit(1);

  const templateData = {
    name: templateName,
    description: "PowerPoint-style composite layout explainer with multiple images per scene. Uses Nano Banana 2 for fast, consistent illustration generation. Supports reference images for visual theme consistency. Ideal for side-by-side comparisons, multi-element explanations, and visually rich educational content.",
    format: "EXPLAINER" as const,

    pipeline_stages: [
      "SCRIPTING",
      "ASSET_COLLECTION",
      "QMS_VALIDATING",
      "ROUTING_RENDER",
      "RENDERING_FFMPEG",
      "AWAITING_QC",
      "AWAITING_UPLOADER",
    ],

    prompts: {
      script_generation: `You are an expert educational content writer creating explainer video scripts optimized for composite visual layouts.

Topic: \${topic}
Complexity Level: \${complexity_level}
Target Duration: \${target_duration_seconds} seconds

Guidelines:
- Write a clear, engaging script that explains the topic from first principles
- Use simple language and concrete examples
- Structure: Hook (15 sec) → Main content → Summary (15 sec)
- Include natural pauses for visual transitions
- Aim for conversational tone, not academic
- Each paragraph should be 2-4 sentences (visual scene boundary)
- Total word count: ~\${word_count} words (based on target duration)
- Suggest 2-3 visual elements per scene for composite layout (e.g., "comparison image + example diagram")

Output the script as plain text paragraphs. Each paragraph = one composite visual scene.`,

      scene_description: `You are an expert at breaking down educational scripts into PowerPoint-style composite visual scenes.

Script paragraph: \${paragraph}

Generate a structured visual layout description for composite AI image generation:
- Describe 2-3 distinct visual elements to be arranged on a single canvas
- Use simple literal descriptions (avoid metaphors)
- Focus on what can be visually shown together
- Include relevant context (objects, people, settings as applicable)
- Suggest layout arrangement (left/right split, grid, stacked, etc.)
- Keep each element description under 50 chars
- Total description under 400 characters

Output as JSON:
{
  "layout": "grid|split|stacked",
  "elements": [
    { "position": "top-left|top-right|center|etc", "description": "element 1" },
    { "position": "...", "description": "element 2" }
  ],
  "background": "plain white|subtle grid|minimal texture"
}`,

      visual_search_query: `Extract 2-4 keyword search terms from this visual description for finding reference images:

Description: \${visual_description}

Output format: keyword1, keyword2, keyword3`,
    },

    render_config: {
      engine: "FFMPEG" as const,
      settings: {
        fps: 30,
        width: 1920,
        height: 1080,
        video_codec: "libx264",
        audio_codec: "aac",
        crf: 23,
        preset: "medium",
        ken_burns_enabled: true,
        ken_burns_intensity: 0.8,
        image_style: "illustration",
        image_model_override: {
          id: "gemini-3.1-flash-image-preview",
          resolution: "1K",
        },
        qc_image_review_required: false,
        captions_enabled: true,
        hook_duration_seconds: 10,
        hook_scene_seconds: 1.5,
      },
    },

    required_assets: [
      "audio/tts",
      "image/composite",
      "layout_reference/reference-design",
      "document/script",
      "subtitle/ass",
    ],

    metadata: {
      production_version: "V3",
      archetype_id: flatIllustrationArchetype.id,
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
        name: "Explainer Composite",
        prompt_prefix: "Educational flat-design illustration, Casually Explained style,",
        prompt_suffix: "clean off-white background, hand-drawn feel, no photorealism, multiple elements on canvas, 16:9 aspect ratio, high quality illustration",
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
    console.log(`[seed-explainer-v2] ✓ Updated existing template: ${existing.id}`);
  } else {
    const [inserted] = await db
      .insert(contentTemplates)
      .values(templateData)
      .returning({ id: contentTemplates.id });
    console.log(`[seed-explainer-v2] ✓ Inserted new template: ${inserted!.id}`);
  }

  console.log("[seed-explainer-v2] Done.");
  await sql.end();
  process.exit(0);
}

seedTemplate().catch((err) => {
  console.error("[seed-explainer-v2] Fatal:", err);
  process.exit(1);
});
