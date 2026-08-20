#!/usr/bin/env tsx
/**
 * One-shot runner for migration 0016 — Knowledge LMS tables.
 * Usage: pnpm --filter @repo/db exec tsx src/run-migration-0016.ts
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
  resolve(__dirname, "migrations/0016_knowledge_lms.sql"),
  "utf-8"
);

// Strip comment lines and split on semicolons
const statements = migrationSql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

console.log(`[migration-0016] Applying ${statements.length} statement(s)...`);

for (const stmt of statements) {
  console.log(`  → ${stmt.replace(/\s+/g, " ").slice(0, 80)}`);
  await sql.unsafe(stmt);
  console.log("    OK");
}

console.log("[migration-0016] Done. Knowledge LMS tables created.");
await sql.end();
process.exit(0);
