#!/usr/bin/env tsx
/**
 * One-shot runner for the Global Subtitle System migrations (0032, 0033, 0034).
 * These are hand-written (drizzle journal is stale at 0012 in this repo, so
 * `drizzle-kit migrate` won't apply them). Idempotent: re-running is safe — any
 * "already exists / duplicate" errors are logged and skipped.
 *
 * Usage (on the server):
 *   pnpm --filter @repo/db exec tsx src/run-migration-subtitles.ts
 *
 * Delete this file after the migration is confirmed applied in production.
 */

import postgres from "postgres";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../../../.env") });

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL) throw new Error("DATABASE_URL not set");

const sql = postgres(DATABASE_URL, { max: 1 });

const MIGRATIONS = [
  "0032_subtitle_system",
  "0033_subtitle_preset_constraints",
  "0034_subtitle_system_v2",
];

const ALREADY_APPLIED = /already exists|duplicate|does not require/i;

let failed = false;
for (const name of MIGRATIONS) {
  const file = resolve(__dirname, `migrations/${name}.sql`);
  const migrationSql = readFileSync(file, "utf-8");
  process.stdout.write(`[migrate] ${name} ... `);
  try {
    // Execute the whole file in one simple-protocol batch so DO $$...$$ blocks
    // and multi-statement files run intact (no naive semicolon splitting).
    await sql.unsafe(migrationSql);
    console.log("OK");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (ALREADY_APPLIED.test(msg)) {
      console.log(`already applied (skipped: ${msg.split("\n")[0]})`);
    } else {
      console.log("FAILED");
      console.error(`  → ${msg}`);
      failed = true;
      break;
    }
  }
}

await sql.end();
if (failed) {
  console.error("[migrate] Aborted — fix the error above and re-run.");
  process.exit(1);
}
console.log("[migrate] Subtitle migrations applied.");
process.exit(0);
