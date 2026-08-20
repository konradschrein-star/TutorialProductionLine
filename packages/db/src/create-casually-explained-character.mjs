#!/usr/bin/env node
/**
 * Create Casually Explained Character
 *
 * Sets up the canonical Casually Explained stick figure character with reference sheet.
 *
 * Steps:
 * 1. Get FLAT_ILLUSTRATION archetype ID
 * 2. Create asset entry for character sheet (narrator 1.png)
 * 3. Create character entry linked to the asset
 *
 * Usage:
 *   node packages/db/src/create-casually-explained-character.mjs
 */

import postgres from "postgres";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, statSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, "../../../.env");
config({ path: envPath });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[create-casually-explained-character] ERROR: DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(DATABASE_URL);

async function createCharacter() {
  console.log("[create-casually-explained-character] Starting setup...");

  // 1. Get FLAT_ILLUSTRATION archetype ID
  const [archetype] = await sql`
    SELECT id FROM archetypes WHERE image_style = 'illustration' LIMIT 1
  `;

  if (!archetype) {
    console.error("[create-casually-explained-character] ERROR: FLAT_ILLUSTRATION archetype not found. Run seed:archetypes first.");
    await sql.end();
    process.exit(1);
  }

  console.log(`[create-casually-explained-character] Found FLAT_ILLUSTRATION archetype: ${archetype.id}`);

  // 2. Verify character sheet exists
  const characterSheetPath = resolve(__dirname, "../../../media/reference-images/casually-explained/narrator 1.png");

  if (!existsSync(characterSheetPath)) {
    console.error(`[create-casually-explained-character] ERROR: Character sheet not found at ${characterSheetPath}`);
    await sql.end();
    process.exit(1);
  }

  const stats = statSync(characterSheetPath);
  console.log(`[create-casually-explained-character] Found character sheet: ${characterSheetPath} (${Math.round(stats.size / 1024)}KB)`);

  // 3. Create or update asset entry for character sheet
  const [existingAsset] = await sql`
    SELECT id FROM assets
    WHERE file_path = ${characterSheetPath}
    LIMIT 1
  `;

  let assetId;
  if (existingAsset) {
    assetId = existingAsset.id;
    console.log(`[create-casually-explained-character] Asset already exists: ${assetId}`);
  } else {
    const [asset] = await sql`
      INSERT INTO assets (
        name,
        description,
        asset_type,
        file_path,
        file_name,
        file_format,
        origin,
        tags,
        created_at,
        updated_at
      ) VALUES (
        'Casually Explained Character Sheet',
        'Reference sheet for the Casually Explained stick figure character showing multiple angles and poses. Simple stick figure with large circular head, big round eyes, thick black outlines. Hand-drawn minimalist aesthetic.',
        'character',
        ${characterSheetPath},
        'narrator-1.png',
        'png',
        'real',
        ARRAY['#casually-explained', '#reference-sheet'],
        NOW(),
        NOW()
      ) RETURNING id
    `;
    assetId = asset.id;
    console.log(`[create-casually-explained-character] ✓ Created asset: ${assetId}`);
  }

  // 4. Create or update character entry
  const characterName = 'Casually Explained Stick Figure';
  const [existingCharacter] = await sql`
    SELECT id FROM characters WHERE name = ${characterName} LIMIT 1
  `;

  if (existingCharacter) {
    await sql`
      UPDATE characters SET
        description = 'Simple stick figure character with large circular head, big round eyes, thick black outlines. Hand-drawn minimalist aesthetic. Shows multiple emotions and poses for consistent AI generation.',
        archetype_id = ${archetype.id},
        reference_sheet_asset_id = ${assetId},
        is_active = true,
        updated_at = NOW()
      WHERE id = ${existingCharacter.id}
    `;
    console.log(`[create-casually-explained-character] ✓ Updated character: ${characterName} (${existingCharacter.id})`);
  } else {
    const [character] = await sql`
      INSERT INTO characters (
        name,
        description,
        archetype_id,
        reference_sheet_asset_id,
        is_active,
        created_at,
        updated_at
      ) VALUES (
        ${characterName},
        'Simple stick figure character with large circular head, big round eyes, thick black outlines. Hand-drawn minimalist aesthetic. Shows multiple emotions and poses for consistent AI generation.',
        ${archetype.id},
        ${assetId},
        true,
        NOW(),
        NOW()
      ) RETURNING id, name
    `;
    console.log(`[create-casually-explained-character] ✓ Created character: ${character.name} (${character.id})`);
  }

  // 5. Verify
  const [verification] = await sql`
    SELECT c.id, c.name, c.reference_sheet_asset_id, a.id as archetype_id, a.name as archetype_name
    FROM characters c
    LEFT JOIN archetypes a ON c.archetype_id = a.id
    WHERE c.name = ${characterName}
  `;

  console.log("[create-casually-explained-character] Done. Character configured:");
  console.log(`  - ID: ${verification.id}`);
  console.log(`  - Name: ${verification.name}`);
  console.log(`  - Archetype: ${verification.archetype_name} (${verification.archetype_id})`);
  console.log(`  - Reference Sheet Asset ID: ${verification.reference_sheet_asset_id}`);

  await sql.end();
  process.exit(0);
}

createCharacter().catch((err) => {
  console.error("[create-casually-explained-character] Fatal:", err);
  process.exit(1);
});
