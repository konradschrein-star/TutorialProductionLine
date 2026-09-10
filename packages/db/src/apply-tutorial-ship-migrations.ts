#!/usr/bin/env tsx
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { resolveTutorialShipMigrationPlan } from "./tutorial-ship-migration-plan.js";

config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env"), override: false });
const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const here = dirname(fileURLToPath(import.meta.url));
const client = postgres(databaseUrl, { max: 1 });
try {
  // Existing installations can apply only their audited pending suffix. Replaying
  // old data backfills is not equivalent to applying a new schema migration.
  const args = process.argv.slice(2);
  const pending = resolveTutorialShipMigrationPlan(args);
  for (const name of pending) {
    const sql = await readFile(resolve(here, "migrations", name), "utf8");
    await client.begin(async (transaction) => { await transaction.unsafe(sql); });
    console.log(`Applied ${name}`);
  }
} finally {
  await client.end();
}
