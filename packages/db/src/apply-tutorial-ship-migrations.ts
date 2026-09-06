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
  for (const name of [
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
  ]) {
    const sql = await readFile(resolve(here, "migrations", name), "utf8");
    await client.unsafe(sql);
    console.log(`Applied ${name}`);
  }
} finally {
  await client.end();
}
