#!/usr/bin/env tsx
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { contentTemplates } from "./schema/content-templates.js";
import { eq } from "drizzle-orm";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../../../.env") });

import { loadConfig, getConfig } from "@repo/config";

async function seedTemplate() {
  console.log("[seed-drama-template] Loading config...");
  try {
    loadConfig();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  const { DATABASE_URL } = getConfig();
  const sql = postgres(DATABASE_URL);
  const db = drizzle(sql);

  const templateName = "Extra Long Form Drama Story";

  const [existing] = await db
    .select({ id: contentTemplates.id })
    .from(contentTemplates)
    .where(eq(contentTemplates.name, templateName))
    .limit(1);

  const templateData = {
    name: templateName,
    description:
      "Ultra-realistic relationship drama story (45–90 min). Photorealistic AI-generated imagery, dramatic first-person storytelling. Script is always user-provided.",
    format: "LONG_FORM_DRAMA" as const,

    pipeline_stages: [
      "DRAMA_TTS_GENERATING",
      "DRAMA_TRANSCRIBING",
      "DRAMA_PROMPT_GENERATING",
      "DRAMA_IMAGE_GENERATING",
      "DRAMA_ASSEMBLING",
      "DRAMA_QC",
      "AWAITING_QC",
    ],

    prompts: {},

    render_config: {
      engine: "FFMPEG" as const,
      settings: {
        fps: 30,
        width: 1920,
        height: 1080,
      },
      captions_enabled: true,
    },

    required_assets: [],

    metadata: {
      pipeline_config: {
        script_provided: true,
        voice_id: "R23cI2hqxAhT17IXmY7O",
        tts_speed: 1.1,
        music_enabled: false,
        music_volume_db: -30,
      },
    },

    is_active: true,
  };

  if (existing) {
    await db
      .update(contentTemplates)
      .set(templateData as any)
      .where(eq(contentTemplates.id, existing.id));
    console.log(`[seed-drama-template] Updated: ${existing.id}`);
  } else {
    const [inserted] = await db
      .insert(contentTemplates)
      .values(templateData as any)
      .returning({ id: contentTemplates.id });
    console.log(`[seed-drama-template] Inserted: ${inserted!.id}`);
  }

  console.log("[seed-drama-template] Done.");
  await sql.end();
  process.exit(0);
}

seedTemplate().catch((err) => {
  console.error("[seed-drama-template] Fatal:", err);
  process.exit(1);
});
