#!/usr/bin/env tsx
/**
 * Seed: Casually Explained (Editorial) Template
 *
 * Hybrid stick figure + colored placeholder box composition style.
 * Uses Nano Banana 2 to generate stick figures with colored placeholder boxes
 * that Production VAs replace with licensed stock photos in post-production.
 *
 * Pipeline: Topic → Script → Scene breakdown → TTS → Visual assets → Render → QC (HUMAN GATE) → Upload
 * Includes AWAITING_IMAGE_QC blocking stage for human photo replacement
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
  console.log("[seed-casually-explained-editorial] Loading config...");
  try {
    loadConfig();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  const { DATABASE_URL } = getConfig();
  const sql = postgres(DATABASE_URL);
  const db = drizzle(sql);

  const templateName = "Casually Explained (Editorial)";

  // Fetch the CASUALLY_EXPLAINED archetype
  const [explainerArchetype] = await db
    .select({ id: archetypes.id })
    .from(archetypes)
    .where(eq(archetypes.name, "CASUALLY_EXPLAINED"))
    .limit(1);

  if (!explainerArchetype) {
    console.error(
      "[seed-casually-explained-editorial] ERROR: CASUALLY_EXPLAINED archetype not found. Run seed:archetypes first.",
    );
    await sql.end();
    process.exit(1);
  }

  console.log(
    `[seed-casually-explained-editorial] Found CASUALLY_EXPLAINED archetype: ${explainerArchetype.id}`,
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
      "Casually Explained style with placeholder-based editorial workflow. AI generates stick figures with colored placeholder boxes that Production VAs replace with licensed stock photos. Includes human QC gate for premium content quality and editorial oversight.",
    format: "EXPLAINER" as const,

    pipeline_stages: [
      "SCRIPTING",
      "ASSET_COLLECTION",
      "AWAITING_IMAGE_QC",
      "QMS_VALIDATING",
      "ROUTING_RENDER",
      "RENDERING_FFMPEG",
      "AWAITING_QC",
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
- Suggest 2-3 visual elements per scene for hybrid composition

Output the script as plain text paragraphs. Each paragraph = one hybrid visual scene.`,

      scene_description: `You are an expert at creating hybrid composition descriptions combining stick figures AND placeholder boxes in Casually Explained style.

Script paragraph: \${paragraph}

Generate a structured visual layout description with placeholders for human photo replacement:

Layout options: 2x2 grid, 3-panel split, center-focus-with-sides, stacked-layers

For each element specify:
- Type: stick_figure OR placeholder
- Description: what to generate OR what photo should go here (for Production VA)
- Color (placeholders only): red, blue, green, yellow

Guidelines for stick figures:
- Simple stick figures with large circular heads
- Big round eyes, thick black outlines
- Hand-drawn, minimal detail feel
- Various poses: confused, pointing, thinking, excited, etc.

Guidelines for placeholders:
- Flat solid color boxes: #FF5555 (red), #5555FF (blue), #55FF55 (green), #FFFF55 (yellow)
- Thick black borders (5px)
- Centered text labels in Arial describing what photo goes here
- Clear instructions for Production VA

Output as JSON:
{
  "layout": "2x2_grid|3_panel|center_focus|stacked",
  "elements": [
    {
      "type": "stick_figure|placeholder",
      "position": "top-left|top-right|bottom-left|bottom-right|center|left|right",
      "description": "For stick_figure: visual description. For placeholder: PHOTO instruction label",
      "color": "red|blue|green|yellow (placeholders only)"
    }
  ],
  "background": "clean off-white #FAFAFA"
}

Example output:
{
  "layout": "2x2_grid",
  "elements": [
    { "type": "stick_figure", "position": "top-left", "description": "Confused stick figure scratching head with large eyes" },
    { "type": "placeholder", "position": "top-right", "description": "PHOTO: Bar chart showing exponential growth", "color": "red" },
    { "type": "stick_figure", "position": "bottom-left", "description": "Same stick figure now pointing excitedly upward" },
    { "type": "placeholder", "position": "bottom-right", "description": "PHOTO: Stack of money on desk", "color": "blue" }
  ],
  "background": "clean off-white #FAFAFA"
}`,

      visual_search_query: `Extract 2-4 keyword search terms from this placeholder description for Production VA photo sourcing:

Description: \${visual_description}

Focus on the placeholder PHOTO labels only (ignore stick figures).

Output format: keyword1, keyword2, keyword3`,
    },

    render_config: {
      engine: "FFMPEG" as const,
      image_style: "illustration",
      image_model_override: {
        id: "gemini-3.1-flash-image-preview",
        resolution: "1K",
      },
      qc_image_review_required: true,
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
      "image/composite",
      "layout_reference/reference-design",
      "document/script",
      "subtitle/ass",
    ],

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
        name: "Casually Explained Hybrid (Editorial)",
        prompt_prefix:
          "Hybrid composition combining simple stick figures AND colored placeholder boxes,",
        prompt_suffix:
          "stick figures: thick black outlines, large circular heads, big round eyes, hand-drawn minimal feel; placeholders: flat solid colors (#FF5555 red, #5555FF blue, #55FF55 green, #FFFF55 yellow), thick black borders, centered Arial text labels 'PHOTO:', no photos in placeholders; clean off-white background #FAFAFA, 16:9 aspect ratio, high quality",
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
      `[seed-casually-explained-editorial] ✓ Updated existing template: ${existing.id}`,
    );
  } else {
    const [inserted] = await db
      .insert(contentTemplates)
      .values(templateData)
      .returning({ id: contentTemplates.id });
    console.log(
      `[seed-casually-explained-editorial] ✓ Inserted new template: ${inserted!.id}`,
    );
  }

  console.log("[seed-casually-explained-editorial] Done.");
  await sql.end();
  process.exit(0);
}

seedTemplate().catch((err) => {
  console.error("[seed-casually-explained-editorial] Fatal:", err);
  process.exit(1);
});
