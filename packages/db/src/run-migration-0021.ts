#!/usr/bin/env tsx
/**
 * One-shot runner for migration 0021: asset collections.
 * Usage: pnpm --filter @repo/db exec tsx src/run-migration-0021.ts
 * Delete this file after migration is applied.
 */

import postgres from "postgres";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, "../../../.env");
config({ path: envPath });

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL) throw new Error("DATABASE_URL not set");

const sql = postgres(DATABASE_URL, { max: 1 });

const migrationSql = readFileSync(
  resolve(__dirname, "migrations/0021_asset_collections.sql"),
  "utf-8"
);

// Split on statement-breakpoint and execute each statement
const statements = migrationSql
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !s.startsWith("--"));

console.log(`[migration-0021] Applying ${statements.length} statement(s)...`);

for (const stmt of statements) {
  console.log(`  → ${stmt.replace(/\s+/g, " ").slice(0, 80)}`);
  await sql.unsafe(stmt);
  console.log("    OK");
}

console.log("[migration-0021] Done.");
await sql.end();
process.exit(0);
