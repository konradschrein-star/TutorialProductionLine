#!/usr/bin/env tsx
/**
 * Seed: Explainer V1 Template
 *
 * Educational explainer format using FFmpeg V3 rendering.
 * Avatar-optional: TTS narration with images and Ken Burns effects.
 * Pipeline: Topic → Script → Scene breakdown → TTS → Visual assets → Render
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
  console.log("[seed-explainer-v1] Loading config...");
  try { loadConfig(); } catch (e) { console.error(e); process.exit(1); }

  const { DATABASE_URL } = getConfig();
  const sql = postgres(DATABASE_URL);
  const db = drizzle(sql);

  const templateName = "Explainer V1";

  // Check if already exists
  const [existing] = await db
    .select({ id: contentTemplates.id })
    .from(contentTemplates)
    .where(eq(contentTemplates.name, templateName))
    .limit(1);

  const templateData = {
    name: templateName,
    description: "Educational explainer using images with Ken Burns effects, TTS narration, and word-aligned captions. Avatar-optional. Ideal for concept breakdowns, how-to guides, and educational content.",
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
      script_generation: `You are an expert educational content writer creating explainer video scripts.

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

Output the script as plain text paragraphs. Each paragraph = one visual scene.`,

      scene_description: `You are an expert at breaking down educational scripts into visual scenes.

Script paragraph: \${paragraph}

Generate a concise visual description for an AI image generator:
- Describe the core concept or object being explained
- Keep it simple and literal (avoid metaphors unless clearly stated in script)
- Focus on what can be visually shown
- Include relevant context (setting, objects, people if applicable)
- Maximum 200 characters

Output only the image prompt, no explanation.`,

      visual_search_query: `Extract 2-4 keyword search terms from this visual description for finding stock images:

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
        ken_burns_intensity: 1.2,
      },
      captions_enabled: true,
    },

    required_assets: [
      "audio/tts",
      "image/broll",
      "document/script",
      "subtitle/ass",
    ],

    metadata: {
      production_version: "V3",
      production_config: {
        supports_avatar: false,
        requires_avatar: false,
        typical_duration_range: [60, 600],
        typical_scene_count_range: [5, 30],
        needs_scene_analysis: true,
        scene_pacing_strategy: "word-aligned",
      },
      style_preset: {
        name: "Explainer Default",
        prompt_prefix: "Educational, clear visual explanation,",
        prompt_suffix: "professional educational aesthetic, 16:9 aspect ratio, high quality stock photo style",
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
    console.log(`[seed-explainer-v1] Updated existing template: ${existing.id}`);
  } else {
    const [inserted] = await db
      .insert(contentTemplates)
      .values(templateData)
      .returning({ id: contentTemplates.id });
    console.log(`[seed-explainer-v1] Inserted new template: ${inserted.id}`);
  }

  console.log("[seed-explainer-v1] Done.");
  await sql.end();
  process.exit(0);
}

seedTemplate().catch((err) => {
  console.error("[seed-explainer-v1] Fatal:", err);
  process.exit(1);
});
