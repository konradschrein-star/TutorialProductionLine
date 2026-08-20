/**
 * Test DB Utilities
 *
 * NOT a test file — exports shared helpers for all DB integration tests.
 *
 * Usage:
 *   import { describeDb, getTestDb, truncateAll, closeTestDb } from "../setup/test-db.js";
 *
 * Tests are automatically skipped when DATABASE_TEST_URL is not set.
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "../../schema/index.js";

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

export const TEST_DB_URL = process.env["DATABASE_TEST_URL"];

/**
 * Drop-in replacement for `describe` that skips the entire suite when
 * DATABASE_TEST_URL is not set. Use this in every DB test file instead of
 * the raw `describe` global.
 *
 * @example
 *   describeDb("channels repository", () => { ... });
 */
export const describeDb: typeof describe = TEST_DB_URL
  ? describe
  : ((...args: Parameters<typeof describe>) =>
      describe.skip(...args)) as typeof describe;

// ---------------------------------------------------------------------------
// Connection singleton (one connection per test run)
// ---------------------------------------------------------------------------

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getTestDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!TEST_DB_URL) {
    throw new Error(
      "DATABASE_TEST_URL is not set — cannot create test DB connection"
    );
  }
  if (!_db) {
    _client = postgres(TEST_DB_URL, { max: 1 });
    _db = drizzle(_client, { schema });
  }
  return _db;
}

export async function closeTestDb(): Promise<void> {
  if (_client) {
    await _client.end();
    _client = null;
    _db = null;
  }
}

// ---------------------------------------------------------------------------
// Truncation helper
// ---------------------------------------------------------------------------

/**
 * Truncates all application tables in reverse-dependency order so that
 * foreign-key constraints are never violated.
 *
 * Order rationale:
 *   1. Leaf tables that reference content_jobs (cascade-deleted by PG anyway,
 *      but explicit is safer):
 *        scene_frame_sequences → content_jobs + assets
 *        video_timelines       → content_jobs
 *        system_events         → content_jobs
 *   2. content_jobs → channels, content_templates, users
 *   3. environments → archetypes, channels, assets (RESTRICT on background_asset_id)
 *   4. assets       → archetypes, channels, characters
 *   5. characters   → archetypes, channels
 *   6. system_settings → users
 *   7. style_assets → channels
 *   8. Root tables (no outbound FKs to other app tables):
 *        archetypes, character_state_types, channels, content_templates, users
 *
 * CASCADE is specified to let PostgreSQL handle any remaining FK chains
 * automatically in case the schema evolves.
 */
export async function truncateAll(): Promise<void> {
  const db = getTestDb();
  await db.execute(sql`
    TRUNCATE TABLE
      scene_frame_sequences,
      video_timelines,
      system_events,
      content_jobs,
      environments,
      assets,
      characters,
      system_settings,
      style_assets,
      archetypes,
      character_state_types,
      channels,
      content_templates,
      users
    RESTART IDENTITY CASCADE
  `);
}
