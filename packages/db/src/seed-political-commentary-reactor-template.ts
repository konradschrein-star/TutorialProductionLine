#!/usr/bin/env tsx
/**
 * Seed: Political Commentary Reactor Template
 *
 * Inserts (or upserts) the POLITICAL_COMMENTARY_REACTOR content template.
 *
 * Pipeline:
 *   REACTOR_DOWNLOADING → REACTOR_TRANSCRIBING → REACTOR_SCRIPTING
 *   → REACTOR_TTS_GENERATING → REACTOR_ASSEMBLING
 *   → ROUTING_RENDER → RENDERING_REMOTION → AWAITING_QC
 *
 * Usage:
 *   tsx packages/db/src/seed-political-commentary-reactor-template.ts
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
config({ path: resolve(__dirname, "../../../.env") });

import { loadConfig, getConfig } from "@repo/config";

async function seedTemplate() {
  try {
    loadConfig();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  const { DATABASE_URL } = getConfig();
  const sql = postgres(DATABASE_URL);
  const db = drizzle(sql);

  const templateName = "Political Commentary Reactor";

  const [existing] = await db
    .select({ id: contentTemplates.id })
    .from(contentTemplates)
    .where(eq(contentTemplates.name, templateName))
    .limit(1);

  const templateData = {
    name: templateName,
    description:
      "Reactor commentary format: downloads a YouTube video, auto-transcribes with FasterWhisper, generates skeptical German commentary via Claude, TTS + animated avatar overlay rendered with Remotion.",
    format: "POLITICAL_COMMENTARY_REACTOR" as const,

    pipeline_stages: [
      "REACTOR_DOWNLOADING",
      "REACTOR_TRANSCRIBING",
      "REACTOR_SCRIPTING",
      "REACTOR_TTS_GENERATING",
      "REACTOR_ASSEMBLING",
      "ROUTING_RENDER",
      "RENDERING_REMOTION",
      "AWAITING_QC",
    ],

    prompts: {},

    render_config: {
      engine: "REMOTION" as const,
      workflow: "political-commentary-reactor",
      settings: {
        fps: 30,
        width: 1920,
        height: 1080,
      },
      captions_enabled: false,
    },

    required_assets: [],

    metadata: {
      pipeline_config: {
        reactor_format: true,
        no_tts: false,
      },
      default_tts_provider: "elevenlabs",
      avatar_animation: {
        intensity: 0.6,
        max_scale_delta: 0.05,
      },
      overlay: {
        saturation_boost: 5,
        source_attribution: "",
      },
    },

    is_active: true,
  };

  if (existing) {
    await db
      .update(contentTemplates)
      .set({ ...templateData, updated_at: new Date() })
      .where(eq(contentTemplates.id, existing.id));
    console.log(`[seed] Updated existing template: ${existing.id}`);
  } else {
    const [inserted] = await db
      .insert(contentTemplates)
      .values(templateData)
      .returning({ id: contentTemplates.id });
    console.log(`[seed] Inserted new template: ${inserted?.id}`);
  }

  console.log("[seed] Political Commentary Reactor template done.");
  await sql.end();
  process.exit(0);
}

seedTemplate().catch((err) => {
  console.error("[seed] Fatal:", err);
  process.exit(1);
});
