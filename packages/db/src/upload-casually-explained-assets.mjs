#!/usr/bin/env node
/**
 * Upload Casually Explained Reference Assets
 *
 * Directly inserts the 4 reference images into the database as style assets
 * for the Casually Explained format.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database connection
const DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/content_forge";
const sql = postgres(DATABASE_URL);
const db = drizzle(sql);

// Reference image paths (relative to monorepo root)
const mediaRoot = resolve(__dirname, "../../../media/reference-images/casually-explained");

const assets = [
  {
    name: "Casually Explained Visual Style",
    type: "style_guide",
    description: "Simple stick figures with large circular heads, big round eyes, thick black outlines. Clean off-white background (#FAFAFA). Minimalist composition. Hand-drawn aesthetic. No gradients, no photorealistic elements on characters.",
    filename: "style-guide.png",
    scope_archetype: "FLAT_ILLUSTRATION",
    scope_format: "EXPLAINER",
  },
  {
    name: "Stick Figure Character Sheet",
    type: "character",
    description: "Stick figure character master sheet showing different emotions and poses. Large circular head, big round eyes, thick black outlines. Consistent design across all variations for AI reference.",
    filename: "narrator 1.png",
    scope_archetype: "FLAT_ILLUSTRATION",
    scope_format: "EXPLAINER",
  },
  {
    name: "Layout Reference (Automated)",
    type: "layout_reference",
    description: "Subtle grid lines for AI-generated photo positioning. Clean composition guidelines for automated template. Shows proper spacing and element placement patterns.",
    filename: "layout-automated.png",
    scope_archetype: "FLAT_ILLUSTRATION",
    scope_format: "EXPLAINER",
    tags: ["automated"],
  },
  {
    name: "Layout Reference (Editorial)",
    type: "layout_reference",
    description: "Prominent colored placeholder boxes for VA-sourced photography. Red (#FF5555), blue (#5555FF), green (#55FF55), yellow (#FFFF55) placeholders for editorial template workflow.",
    filename: "layout-editorial.png",
    scope_archetype: "FLAT_ILLUSTRATION",
    scope_format: "EXPLAINER",
    tags: ["editorial"],
  },
];

async function main() {
  console.log("[upload] Starting Casually Explained asset upload...");

  for (const asset of assets) {
    const filePath = resolve(mediaRoot, asset.filename);

    console.log(`\n[upload] Processing: ${asset.name}`);
    console.log(`[upload] File: ${filePath}`);

    // Read file as buffer
    let fileBuffer;
    try {
      fileBuffer = readFileSync(filePath);
    } catch (error) {
      console.error(`[upload] ERROR: Failed to read file: ${error.message}`);
      continue;
    }

    console.log(`[upload] File size: ${(fileBuffer.length / 1024).toFixed(2)} KB`);

    // Insert into database
    try {
      const result = await sql`
        INSERT INTO style_assets (
          name,
          type,
          description,
          file_data,
          file_size_bytes,
          mime_type,
          scope_archetype,
          scope_format,
          scope_channel_id,
          tags,
          is_active,
          created_at,
          updated_at
        ) VALUES (
          ${asset.name},
          ${asset.type},
          ${asset.description},
          ${fileBuffer},
          ${fileBuffer.length},
          'image/png',
          ${asset.scope_archetype},
          ${asset.scope_format},
          NULL,
          ${asset.tags || []},
          true,
          NOW(),
          NOW()
        )
        ON CONFLICT (name, scope_archetype, scope_format, COALESCE(scope_channel_id, 0))
        DO UPDATE SET
          description = EXCLUDED.description,
          file_data = EXCLUDED.file_data,
          file_size_bytes = EXCLUDED.file_size_bytes,
          tags = EXCLUDED.tags,
          updated_at = NOW()
        RETURNING id, name;
      `;

      console.log(`[upload] ✓ Uploaded: ${result[0].name} (ID: ${result[0].id})`);
    } catch (error) {
      console.error(`[upload] ERROR: Database insert failed: ${error.message}`);
    }
  }

  console.log("\n[upload] All assets uploaded successfully!");
  console.log("\n[upload] Summary:");
  console.log("  - Style Guide: Casually Explained Visual Style");
  console.log("  - Character: Stick Figure Character Sheet");
  console.log("  - Layout: Automated template grid reference");
  console.log("  - Layout: Editorial template placeholder reference");

  await sql.end();
  process.exit(0);
}

main().catch((error) => {
  console.error("[upload] Fatal error:", error);
  process.exit(1);
});
