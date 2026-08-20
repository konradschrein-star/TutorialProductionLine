#!/usr/bin/env tsx
/**
 * One-shot runner for migration 0005.
 * Usage: pnpm --filter @repo/db exec tsx src/run-migration-0005.ts
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
  // Renamed 2026-07-30 from 0005_… to 0005b_… to disambiguate the duplicate
  // 0005 prefix. See packages/db/src/migrations/README.md.
  resolve(__dirname, "migrations/0005b_professional_caption_presets.sql"),
  "utf-8",
);

// Strip comment lines and split on semicolons
const statements = migrationSql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

console.log(`[migration-0005] Applying ${statements.length} statement(s)...`);

for (const stmt of statements) {
  console.log(`  → ${stmt.replace(/\s+/g, " ").slice(0, 80)}`);
  await sql.unsafe(stmt);
  console.log("    OK");
}

console.log("[migration-0005] Done.");
await sql.end();
process.exit(0);
