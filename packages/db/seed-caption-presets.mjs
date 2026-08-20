import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from root .env
dotenv.config({ path: join(__dirname, "../../.env") });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const defaultPresets = [
  {
    name: "Default",
    is_default: true,
    config: {
      position: "bottom-center",
      vertical_offset_percent: 10,
      font_family: "Arial",
      font_size: 72,
      primary_color: "#FFFFFF",
      highlight_color: "#FFFF00",
      all_caps: false,
      show_punctuation: true,
      window_size: 6,
      outline_width: 2,
      shadow_offset: 1,
    },
  },
  {
    name: "Large Bold",
    is_default: false,
    config: {
      position: "bottom-center",
      vertical_offset_percent: 12,
      font_family: "Impact",
      font_size: 96,
      primary_color: "#FFFFFF",
      highlight_color: "#FF6B6B",
      all_caps: true,
      show_punctuation: false,
      window_size: 4,
      outline_width: 4,
      shadow_offset: 2,
    },
  },
  {
    name: "Minimal",
    is_default: false,
    config: {
      position: "top-center",
      vertical_offset_percent: 10,
      font_family: "Helvetica",
      font_size: 48,
      primary_color: "#FFFFFF",
      highlight_color: "#00FF00",
      all_caps: false,
      show_punctuation: true,
      window_size: 8,
      outline_width: 0,
      shadow_offset: 0,
    },
  },
  {
    name: "Yellow Highlight",
    is_default: false,
    config: {
      position: "bottom-center",
      vertical_offset_percent: 10,
      font_family: "Arial",
      font_size: 72,
      primary_color: "#FFFF00",
      highlight_color: "#00FF00",
      all_caps: false,
      show_punctuation: true,
      window_size: 6,
      outline_width: 2,
      shadow_offset: 1,
    },
  },
  {
    name: "Tutorial Style",
    is_default: false,
    config: {
      position: "bottom-center",
      vertical_offset_percent: 8,
      font_family: "Roboto",
      font_size: 64,
      primary_color: "#F0F0F0",
      highlight_color: "#4A90E2",
      all_caps: false,
      show_punctuation: true,
      window_size: 7,
      outline_width: 2,
      shadow_offset: 1,
    },
  },
  {
    name: "Gaming Style",
    is_default: false,
    config: {
      position: "top-left",
      vertical_offset_percent: 5,
      font_family: "Consolas",
      font_size: 56,
      primary_color: "#00FF00",
      highlight_color: "#FF00FF",
      all_caps: true,
      show_punctuation: false,
      window_size: 5,
      outline_width: 3,
      shadow_offset: 2,
    },
  },
  {
    name: "Accessibility",
    is_default: false,
    config: {
      position: "bottom-center",
      vertical_offset_percent: 15,
      font_family: "Arial",
      font_size: 84,
      primary_color: "#FFFFFF",
      highlight_color: "#FFFF00",
      all_caps: false,
      show_punctuation: true,
      window_size: 6,
      outline_width: 4,
      shadow_offset: 2,
    },
  },
  {
    name: "Karaoke",
    is_default: false,
    config: {
      position: "center",
      vertical_offset_percent: 0,
      font_family: "Times New Roman",
      font_size: 80,
      primary_color: "#FFFFFF",
      highlight_color: "#FF69B4",
      all_caps: false,
      show_punctuation: true,
      window_size: 3,
      outline_width: 3,
      shadow_offset: 1,
    },
  },
];

async function seedCaptionPresets() {
  try {
    console.log("Creating caption_presets table...");

    // Create table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS caption_presets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(100) NOT NULL,
        is_default boolean NOT NULL DEFAULT false,
        config jsonb NOT NULL,
        created_at timestamp with time zone NOT NULL DEFAULT now(),
        updated_at timestamp with time zone NOT NULL DEFAULT now()
      )
    `);

    // Create indexes
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_caption_presets_name ON caption_presets(name)`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_caption_presets_default ON caption_presets(is_default)`,
    );

    console.log("Seeding caption presets...");

    // Check if presets already exist
    const existing = await db.execute(
      sql`SELECT COUNT(*) FROM caption_presets`,
    );
    const count = Number(existing.rows[0].count);

    if (count > 0) {
      console.log(`${count} caption presets already exist, skipping seed`);
      await pool.end();
      return;
    }

    // Insert presets
    for (const preset of defaultPresets) {
      await db.execute(sql`
        INSERT INTO caption_presets (name, is_default, config)
        VALUES (${preset.name}, ${preset.is_default}, ${JSON.stringify(preset.config)}::jsonb)
      `);
      console.log(`  ✓ ${preset.name}`);
    }

    console.log(`\n✅ Successfully seeded ${defaultPresets.length} caption presets`);
  } catch (error) {
    console.error("❌ Seed failed:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

seedCaptionPresets();
