#!/usr/bin/env node
/**
 * Character Library import CLI.
 *
 * Takes a directory of photos of one person, normalises each into an i2i
 * reference image under the media root, and registers the character + its
 * images + its channel binding.
 *
 * Usage:
 *   pnpm --filter @repo/worker-orchestrator character:import -- \
 *     --name "General Guy" \
 *     --description "Clean-shaven man in his 30s, short dark hair, navy shirt" \
 *     --dir /opt/content-forge/media/characters/_inbox/general-guy \
 *     --channel 7908448d-d67b-4bfd-a1cd-ebdd72e0c30f \
 *     [--role host] [--dry-run]
 *
 * Idempotent: re-running with the same --name updates the character and
 * upserts each image by path rather than duplicating them.
 *
 * NO SYNTHETIC FALLBACKS: an unreadable or unmeasurable source image aborts the
 * whole import. A character library with a silently-missing pose is worse than
 * one that failed to import, because the cycle would then land on nothing.
 */
import { config } from "dotenv";
import { resolve, dirname, join, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readdir } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../../../../.env") });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "@repo/db";
import { characters } from "@repo/db";
import {
  addCharacterImage,
  createCharacter,
  setCharacterChannels,
  updateCharacter,
} from "@repo/db/repositories";
import {
  normaliseCharacterReference,
  parsePoseFromFilename,
} from "@repo/media-core/images";

const CHARACTER_MEDIA_DIR =
  process.env["CHARACTER_MEDIA_DIR"] ?? "/opt/content-forge/media/characters";

interface Opts {
  name: string;
  description: string;
  dir: string;
  channelIds: string[];
  role: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Opts {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const name = get("--name");
  const description = get("--description");
  const dir = get("--dir");
  const channel = get("--channel");
  if (!name || !description || !dir) {
    throw new Error(
      "Usage: --name <name> --description <desc> --dir <folder> " +
        "[--channel <uuid[,uuid]>] [--role host|cast] [--dry-run]",
    );
  }
  return {
    name,
    description,
    dir,
    channelIds: (channel ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    role: get("--role") ?? "host",
    dryRun: argv.includes("--dry-run"),
  };
}

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const files = (await readdir(opts.dir))
    .filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()))
    .sort();
  if (files.length === 0) {
    throw new Error(`No images found in ${opts.dir}`);
  }
  console.log(`[character:import] ${opts.name}: ${files.length} source images`);

  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 2 });
  const db = drizzle(sql, { schema });

  try {
    const [existing] = await db
      .select()
      .from(characters)
      .where(eq(characters.name, opts.name))
      .limit(1);

    const character = existing
      ? ((await updateCharacter(db, existing.id, {
          description: opts.description,
          role: opts.role,
          is_active: true,
        })) ?? existing)
      : await createCharacter(db, {
          name: opts.name,
          description: opts.description,
          role: opts.role,
        });
    console.log(
      `[character:import] character ${character.id} ` +
        `(${existing ? "updated" : "created"})`,
    );

    // The originals stay where they were handed to us (--dir), and each row's
    // `original_path` points at them, so a reference can be re-derived at a
    // different spec later without re-generating the character. Only the
    // normalised references are written under the media root.
    const outDir = join(CHARACTER_MEDIA_DIR, character.id);
    await mkdir(outDir, { recursive: true });

    let index = 0;
    for (const file of files) {
      const src = join(opts.dir, file);
      const stem = basename(file, extname(file))
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);
      const refPath = join(
        outDir,
        `${String(index).padStart(2, "0")}-${stem}.jpg`,
      );
      const { pose, expression } = parsePoseFromFilename(file);

      const norm = await normaliseCharacterReference(src, refPath);
      console.log(
        `  [${index}] ${file} -> ${basename(refPath)} ` +
          `${norm.width}x${norm.height} ${norm.byteSize}B q=${norm.quality} ` +
          `pose=${pose ?? "-"} expr=${expression ?? "-"}`,
      );

      if (!opts.dryRun) {
        await addCharacterImage(db, {
          character_id: character.id,
          image_path: refPath,
          original_path: src,
          pose,
          expression,
          source_filename: file,
          width: norm.width,
          height: norm.height,
          byte_size: norm.byteSize,
          sort_order: index,
          is_active: true,
        });
      }
      index += 1;
    }

    if (!opts.dryRun && opts.channelIds.length > 0) {
      await setCharacterChannels(
        db,
        character.id,
        opts.channelIds.map((channel_id, i) => ({
          channel_id,
          role: opts.role,
          // Exactly one primary binding; a partial unique index in the DB
          // enforces one primary host per channel, so a clash fails loudly.
          is_primary: i === 0 ? true : opts.role !== "host",
        })),
      );
      console.log(
        `[character:import] bound to ${opts.channelIds.length} channel(s) as ${opts.role}`,
      );
    }

    console.log(`[character:import] done: ${index} images`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(`[character:import] FAILED: ${err.message}`);
  process.exit(1);
});
