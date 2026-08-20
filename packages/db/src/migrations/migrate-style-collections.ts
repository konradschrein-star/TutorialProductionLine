/**
 * One-time migration: copy style_collections → format_style_libraries,
 * update content_templates.default_style_library_id, then drop old tables.
 *
 * Run once: pnpm --filter @repo/db tsx src/migrations/migrate-style-collections.ts
 * Do NOT run this until all application-layer consumers have been updated (SS-4 through SS-9).
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function migrate() {
  console.log("Starting style_collections → format_style_libraries migration");

  await db.transaction(async (tx) => {
    // 1. Copy style_collections rows → format_style_libraries
    // Mapping: drop archetype_id (not in target), drop channel_id (not in target), format is required (default to 'CASUALLY_EXPLAINED' for nulls)
    await tx.execute(sql`
      INSERT INTO format_style_libraries (id, name, description, format, text_guidelines, metadata, is_active, created_at, updated_at)
      SELECT
        id,
        name,
        COALESCE(description, ''),
        COALESCE(format, 'CASUALLY_EXPLAINED'),
        text_guidelines,
        metadata,
        is_active,
        created_at,
        updated_at
      FROM style_collections
      ON CONFLICT (id) DO NOTHING
    `);
    console.log("Copied style_collections rows");

    // 2. Copy join table rows
    // style_collection_assets: style_collection_id, asset_id, ref_type, display_order
    // format_style_library_assets: library_id, asset_id, ref_type, display_order
    await tx.execute(sql`
      INSERT INTO format_style_library_assets (id, library_id, asset_id, ref_type, display_order)
      SELECT
        gen_random_uuid(),
        style_collection_id,
        asset_id,
        ref_type,
        display_order
      FROM style_collection_assets
      ON CONFLICT DO NOTHING
    `);
    console.log("Copied style_collection_assets rows");

    // 3. Drop old tables (style_collection_assets first due to FK)
    await tx.execute(sql`DROP TABLE IF EXISTS style_collection_assets CASCADE`);
    await tx.execute(sql`DROP TABLE IF EXISTS style_collections CASCADE`);
    console.log("Dropped old tables");
  });

  console.log("Migration complete");
  await pool.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
