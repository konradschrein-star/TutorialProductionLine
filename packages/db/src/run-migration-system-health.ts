#!/usr/bin/env tsx
/**
 * One-shot runner for the System Health / provider-registry migrations
 * (0043 expiry+policies, 0044 compute nodes, 0045 call-sites+consumers), plus
 * the base registry migration 0038 in case it was never applied in prod (it
 * was NOT, as of 2026-07-28 — which is exactly why /system-health showed the
 * "Registry not initialised" banner).
 *
 * Hand-written migrations (drizzle journal is stale at 0012, so
 * `drizzle-kit migrate` will not apply them). Idempotent — every table uses
 * CREATE TABLE IF NOT EXISTS and every index IF NOT EXISTS, so re-running is
 * safe.
 *
 * Usage (on the server, against the REAL Content Forge DB — docker pg :5432
 * per /opt/content-forge/.env, NOT the AI-OS pg on :5434):
 *   pnpm --filter @repo/db exec tsx src/run-migration-system-health.ts
 *
 * Delete this file after the migrations are confirmed applied in production.
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
  "0038_provider_registry",
  "0043_provider_expiry_and_policies",
  "0044_compute_nodes",
  "0045_provider_call_sites",
];

const ALREADY_APPLIED = /already exists|duplicate|does not require/i;

let failed = false;
for (const name of MIGRATIONS) {
  const file = resolve(__dirname, `migrations/${name}.sql`);
  const migrationSql = readFileSync(file, "utf-8");
  process.stdout.write(`[migrate] ${name} ... `);
  try {
    // One simple-protocol batch so multi-statement files run intact.
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
console.log("[migrate] System Health migrations applied.");
process.exit(0);
