#!/usr/bin/env tsx
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env"), override: false });
const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const here = dirname(fileURLToPath(import.meta.url));
const client = postgres(databaseUrl, { max: 1 });
try {
  const migrations = [
    "0069_tutorial_uploads_tracking.sql",
    "0064_channel_is_primary.sql",
    "0076_tutorial_channel_network.sql",
    "0077_thumbnail_generation_mode.sql",
    "0079_tutorial_uploader_lifecycle.sql",
    "0080_user_presence.sql",
    "0081_thumbnail_library_assets.sql",
    "0082_thumbnail_rotation_settings.sql",
    "0083_uploader_settings.sql",
    "0084_tutorial_thumbnail_copy.sql",
    "0085_tutorial_uploader_exchange.sql",
    "0086_channel_uploader_mapping.sql",
    "0087_tutorial_uploader_verified_projection.sql",
    "0088_office_thumbnail_backgrounds.sql",
    "0089_tutorial_thumbnail_drafts.sql",
    "0090_tutorial_dispatch_pause.sql",
    "0091_tutorial_publication_approval.sql",
    "0092_tutorial_localization_revision.sql",
    "0093_tutorial_job_events.sql",
    "0094_tutorial_observation_idempotency.sql",
    "0095_tutorial_scheduled_delivery.sql",
    "0096_tutorial_keyword_outbox.sql",
    "0097_storage_artifact_versions.sql",
    "0098_tutorial_legacy_archive.sql",
    "0099_storage_versions_append_only.sql",
    "0100_thumbnail_workspace.sql",
    "0101_tutorial_thumbnail_fanout.sql",
    "0102_tutorial_thumbnail_ai_batches.sql",
    "0103_tutorial_thumbnail_retry_audit.sql",
    "0104_user_tutorial_preferences.sql",
  ];
  // Existing installations can apply only their audited pending suffix. Replaying
  // old data backfills is not equivalent to applying a new schema migration.
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--from" || !migrations.includes(args[1]!))) {
    throw new Error("Usage: apply-tutorial-ship-migrations.ts [--from exact-migration-filename.sql]");
  }
  const pending = args.length ? migrations.slice(migrations.indexOf(args[1]!)) : migrations;
  for (const name of pending) {
    const sql = await readFile(resolve(here, "migrations", name), "utf8");
    await client.begin(async (transaction) => { await transaction.unsafe(sql); });
    console.log(`Applied ${name}`);
  }
} finally {
  await client.end();
}
