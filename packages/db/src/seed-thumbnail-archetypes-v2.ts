#!/usr/bin/env tsx
/**
 * Seed: Thumbnail Archetypes v2 — full import from the old standalone tool.
 *
 * Imports all 44 archetypes exported from the LIVE "Thumbnail Creator V2"
 * database (`thumbnail_generator` on the VPS, pm2 `thumbnail-tool`,
 * https://thumbnails.schreinercontentsystems.com) into Content Forge's global
 * thumbnail system.
 *
 * Every archetype is imported with `channel_id = NULL` (GLOBAL) and
 * `formats = []` (NO format restriction), per the operator's explicit request:
 * "all of the presets from the old tool I also want them without assigning
 * them to any special channel".
 *
 * For each archetype this:
 *   1. Copies the vendored reference image from
 *      packages/db/seed-assets/thumbnail-archetypes-v2/ to
 *      THUMBNAIL_MEDIA_DIR/archetypes/ so the worker can read it as an i2i
 *      reference at generation time.
 *   2. Upserts a thumbnail_archetypes row keyed on `source_key`
 *      ("thumbnail-tool:<original cuid>").
 *
 * Idempotent by `source_key`. Re-running UPDATES the reference image path and
 * any still-default metadata but never duplicates rows. Rows the operator has
 * since renamed keep their name (we only ever restore the image path), so
 * hand-edits are not clobbered — pass --force-metadata to overwrite.
 *
 * Requires migration 0037 (adds channel_id / source_key / aspect_ratio /
 * resolution to thumbnail_archetypes).
 *
 * Usage:
 *   pnpm --filter @repo/db seed:thumbnail-archetypes-v2
 *   tsx packages/db/src/seed-thumbnail-archetypes-v2.ts [--force-metadata]
 */

import { copyFile, mkdir, readFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../../../.env") });

import { loadConfig, getConfig } from "@repo/config";
import { createDrizzleClient } from "./client.js";
import { thumbnailArchetypes } from "./schema/thumbnails.js";

interface SeedArchetype {
  source_key: string;
  name: string;
  file: string;
  description: string | null;
  layout_instructions: string | null;
  base_prompt: string | null;
  features_logo: boolean;
  category: string;
  /** Was admin-only in the old tool. Content Forge has no such tier — kept as provenance. */
  admin_only: boolean;
}

const FORCE_METADATA = process.argv.includes("--force-metadata");

async function seed(): Promise<void> {
  const tag = "[seed-thumbnail-archetypes-v2]";

  try {
    loadConfig();
  } catch (e) {
    console.error(`${tag} Config error:`, e);
    process.exit(1);
  }

  const { DATABASE_URL } = getConfig();
  const db = createDrizzleClient(DATABASE_URL);

  const dataPath = resolve(
    __dirname,
    "./seed-data/thumbnail-archetypes-v2.json",
  );
  const rows: SeedArchetype[] = JSON.parse(await readFile(dataPath, "utf8"));
  console.log(`${tag} Loaded ${rows.length} archetypes from ${dataPath}`);

  const mediaDir =
    process.env["THUMBNAIL_MEDIA_DIR"] ?? "/opt/content-forge/media/thumbnails";
  const destDir = join(mediaDir, "archetypes");
  await mkdir(destDir, { recursive: true });

  const sourceDir = resolve(
    __dirname,
    "../seed-assets/thumbnail-archetypes-v2",
  );

  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const [i, arch] of rows.entries()) {
    try {
      const sourcePath = join(sourceDir, arch.file);
      const destPath = join(destDir, arch.file);
      await copyFile(sourcePath, destPath);

      const [existing] = await db
        .select({ id: thumbnailArchetypes.id, name: thumbnailArchetypes.name })
        .from(thumbnailArchetypes)
        .where(eq(thumbnailArchetypes.source_key, arch.source_key))
        .limit(1);

      const metadata = {
        name: arch.name,
        description: arch.description,
        layout_instructions: arch.layout_instructions,
        base_prompt: arch.base_prompt,
        features_logo: arch.features_logo,
        category: arch.category,
      };

      if (existing) {
        await db
          .update(thumbnailArchetypes)
          .set({
            // Always restore the image path — the file may have moved.
            reference_image_path: destPath,
            sort_order: i,
            updated_at: new Date(),
            ...(FORCE_METADATA ? metadata : {}),
          })
          .where(eq(thumbnailArchetypes.id, existing.id));
        console.log(`${tag} updated  ${arch.name} (${existing.id})`);
        updated++;
        continue;
      }

      const [row] = await db
        .insert(thumbnailArchetypes)
        .values({
          ...metadata,
          source_key: arch.source_key,
          reference_image_path: destPath,
          // GLOBAL — deliberately not bound to any channel.
          channel_id: null,
          // No format restriction — usable by every format.
          formats: [],
          aspect_ratio: "16:9",
          resolution: "1k",
          sort_order: i,
          is_active: true,
        })
        .returning({ id: thumbnailArchetypes.id });
      console.log(`${tag} created  ${arch.name} (${row?.id}) -> ${destPath}`);
      created++;
    } catch (err) {
      failed++;
      console.error(
        `${tag} FAILED   ${arch.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(`\n${tag} Summary`);
  console.log(`  Created: ${created}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Total:   ${rows.length}`);

  if (failed > 0) {
    console.error(`${tag} Completed WITH FAILURES.`);
    process.exit(1);
  }
  console.log(`${tag} Done.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("[seed-thumbnail-archetypes-v2] Fatal:", err);
  process.exit(1);
});
