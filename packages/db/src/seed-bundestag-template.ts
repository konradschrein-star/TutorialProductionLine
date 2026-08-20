#!/usr/bin/env tsx
/**
 * Bundestag Template Seed Script
 *
 * Creates a template for Bundestag format videos.
 *
 * Usage:
 *   tsx packages/db/src/seed-bundestag-template.ts
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { contentTemplates } from "./schema/content-templates.js";
import { eq, and } from "drizzle-orm";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from monorepo root
const envPath = resolve(__dirname, "../../../.env");
config({ path: envPath });

console.log(`[seed-bundestag] Loading .env from: ${envPath}`);

// Load environment
import { loadConfig, getConfig } from "@repo/config";

async function seedBundestagTemplate() {
  console.log("[seed-bundestag] Starting Bundestag template seed...");

  // Load and validate config
  try {
    loadConfig();
  } catch (error) {
    console.error("[seed-bundestag] Failed to load config:", error);
    process.exit(1);
  }

  const envConfig = getConfig();
  const { DATABASE_URL } = envConfig;

  // Connect to database
  const sql = postgres(DATABASE_URL);
  const db = drizzle(sql);

  console.log("[seed-bundestag] Connected to database");

  // Template specification
  const templateSpec = {
    name: "Bundestag Video (Default)",
    format: "BUNDESTAG" as const,
    description:
      "Procedural German parliamentary speech video automation with intelligent clip selection and composition",
    is_active: true,

    // Pipeline stages for Bundestag video processing
    pipeline_stages: [
      "clip-analysis",
      "playbook-generation",
      "render",
    ] as string[],

    // No AI prompts needed (uses plugin-defined logic)
    prompts: {} as Record<string, string>,

    // Render configuration (FFmpeg-based)
    render_config: {
      engine: "FFMPEG" as const,
      settings: {
        resolution: "1920x1080",
        fps: 30,
        audio_codec: "aac",
        video_codec: "libx264",
      },
    },

    // Required assets
    required_assets: [
      "video/clips", // Source parliamentary footage clips
      "text/transcript", // Official speech transcript (optional)
    ] as string[],

    // Template metadata
    metadata: {
      requires_clips: true,
      requires_official_transcript: false,
      supports_speech_id: true,
      default_pacing: "medium",
      subtitle_language: "de",
    } as Record<string, unknown>,
  };

  // Check if template already exists
  const existing = await db
    .select()
    .from(contentTemplates)
    .where(
      and(
        eq(contentTemplates.format, templateSpec.format),
        eq(contentTemplates.name, templateSpec.name),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    console.log(
      `[seed-bundestag] Template "${templateSpec.name}" already exists (ID: ${existing[0].id})`,
    );
    console.log("[seed-bundestag] Updating existing template...");

    // Update existing template
    await db
      .update(contentTemplates)
      .set({
        description: templateSpec.description,
        is_active: templateSpec.is_active,
        pipeline_stages: templateSpec.pipeline_stages,
        prompts: templateSpec.prompts,
        render_config: templateSpec.render_config,
        required_assets: templateSpec.required_assets,
        metadata: templateSpec.metadata,
      })
      .where(eq(contentTemplates.id, existing[0].id));

    console.log(`[seed-bundestag] Template updated successfully!`);
  } else {
    console.log(`[seed-bundestag] Creating new template: ${templateSpec.name}`);

    // Insert new template
    const [inserted] = await db
      .insert(contentTemplates)
      .values(templateSpec)
      .returning();

    console.log(
      `[seed-bundestag] Template created successfully! ID: ${inserted.id}`,
    );
  }

  console.log("[seed-bundestag] Seed completed!");

  // Close connection
  await sql.end();
  process.exit(0);
}

// Run seed
seedBundestagTemplate().catch((error) => {
  console.error("[seed-bundestag] Fatal error:", error);
  process.exit(1);
});
