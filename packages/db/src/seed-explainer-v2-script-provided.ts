#!/usr/bin/env tsx
/**
 * Seed: Explainer V2 (Script Provided) Template
 *
 * Educational explainer format for users who provide their own scripts.
 * Skips script generation phase and goes straight to asset collection.
 * Pipeline: User provides script → Scene breakdown → TTS → Visual assets → Render
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
  console.log("[seed-explainer-v2-script-provided] Loading config...");
  try { loadConfig(); } catch (e) { console.error(e); process.exit(1); }

  const { DATABASE_URL } = getConfig();
  const sql = postgres(DATABASE_URL);
  const db = drizzle(sql);

  const templateName = "Explainer V2 (Script Provided)";

  // Check if already exists
  const [existing] = await db
    .select({ id: contentTemplates.id })
    .from(contentTemplates)
    .where(eq(contentTemplates.name, templateName))
    .limit(1);

  const templateData = {
    name: templateName,
    description: "PowerPoint-style composite layout explainer for pre-written scripts. User provides the script, system generates images with Ken Burns effects, TTS narration, and word-aligned captions. Faster workflow for creators who prefer to write their own content.",
    format: "EXPLAINER" as const,

    pipeline_stages: [
      "ASSET_COLLECTION",  // Starts here - script already provided
      "QMS_VALIDATING",
      "ROUTING_RENDER",
      "RENDERING_FFMPEG",
      "AWAITING_QC",
      "AWAITING_UPLOADER",
    ],

    prompts: {
      // Note: No script_generation prompt - user provides script

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
      "document/script",     // User must provide this
      "audio/tts",
      "image/broll",
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
        script_provided_by_user: true,  // Key flag
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
    console.log(`[seed-explainer-v2-script-provided] Updated existing template: ${existing.id}`);
  } else {
    const [inserted] = await db
      .insert(contentTemplates)
      .values(templateData)
      .returning({ id: contentTemplates.id });
    console.log(`[seed-explainer-v2-script-provided] Inserted new template: ${inserted.id}`);
  }

  console.log("[seed-explainer-v2-script-provided] Done.");
  await sql.end();
  process.exit(0);
}

seedTemplate().catch((err) => {
  console.error("[seed-explainer-v2-script-provided] Fatal:", err);
  process.exit(1);
});
