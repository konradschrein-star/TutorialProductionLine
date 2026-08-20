#!/usr/bin/env node
/**
 * Upload Casually Explained Reference Assets v2
 *
 * Copies reference images to media/style-assets/ and inserts records into style_assets table.
 */

import postgres from "postgres";
import { copyFileSync } from "fs";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database connection
const DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/content_forge";
const sql = postgres(DATABASE_URL);

// Paths
const sourceDir = resolve(__dirname, "../../../media/reference-images/casually-explained");
const targetDir = resolve(__dirname, "../../../media/style-assets");

const assets = [
  {
    name: "Casually Explained Visual Style",
    asset_type: "style_guide",
    description: "Simple stick figures with large circular heads, big round eyes, thick black outlines. Clean off-white background (#FAFAFA). Minimalist composition. Hand-drawn aesthetic. No gradients, no photorealistic elements on characters.",
    source_filename: "style-guide.png",
  },
  {
    name: "Stick Figure Character Sheet",
    asset_type: "persona",
    description: "Stick figure character master sheet showing different emotions and poses. Large circular head, big round eyes, thick black outlines. Consistent design across all variations for AI reference.",
    source_filename: "narrator 1.png",
  },
  {
    name: "Layout Reference (Automated)",
    asset_type: "background",
    description: "Subtle grid lines for AI-generated photo positioning. Clean composition guidelines for automated template. Shows proper spacing and element placement patterns.",
    source_filename: "layout-automated.png",
  },
  {
    name: "Layout Reference (Editorial)",
    asset_type: "background",
    description: "Prominent colored placeholder boxes for VA-sourced photography. Red (#FF5555), blue (#5555FF), green (#55FF55), yellow (#FFFF55) placeholders for editorial template workflow.",
    source_filename: "layout-editorial.png",
  },
];

async function main() {
  console.log("[upload] Starting Casually Explained asset upload v2...\n");

  for (const asset of assets) {
    const sourcePath = resolve(sourceDir, asset.source_filename);
    const targetFilename = `casually-explained-${asset.asset_type}-${Date.now()}.png`;
    const targetPath = resolve(targetDir, targetFilename);

    console.log(`[upload] Processing: ${asset.name}`);
    console.log(`[upload]   Source: ${asset.source_filename}`);

    // Copy file
    try {
      copyFileSync(sourcePath, targetPath);
      console.log(`[upload]   Copied to: ${targetPath}`);
    } catch (error) {
      console.error(`[upload]   ERROR: Failed to copy file: ${error.message}`);
      continue;
    }

    // Insert into database
    try {
      const result = await sql`
        INSERT INTO style_assets (
          name,
          description,
          asset_type,
          format,
          channel_id,
          file_path,
          file_name,
          created_at,
          updated_at
        ) VALUES (
          ${asset.name},
          ${asset.description},
          ${asset.asset_type},
          'CASUALLY_EXPLAINED',
          NULL,
          ${targetPath},
          ${targetFilename},
          NOW(),
          NOW()
        )
        ON CONFLICT DO NOTHING
        RETURNING id, name;
      `;

      if (result.length > 0) {
        console.log(`[upload]   ✓ Inserted: ${result[0].name} (ID: ${result[0].id})`);
      } else {
        console.log(`[upload]   ⚠ Already exists, skipped`);
      }
    } catch (error) {
      console.error(`[upload]   ERROR: Database insert failed: ${error.message}`);
    }

    console.log();
  }

  console.log("[upload] Upload complete!\n");
  console.log("Next steps:");
  console.log("1. Refresh the Style Library page in the Hub UI");
  console.log("2. Verify the 4 assets appear in their respective tabs");
  console.log("3. Create a test job using the Casually Explained template");

  await sql.end();
  process.exit(0);
}

main().catch((error) => {
  console.error("[upload] Fatal error:", error);
  process.exit(1);
});
