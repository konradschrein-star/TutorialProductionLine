#!/usr/bin/env tsx
/**
 * D5 — quarantine the 5 phantom job directories.
 *
 * Konrad (decision D5): "I do not have a clue. I definitely do not want a lying
 * index. Delete the 5 jobs." The interview scoped this precisely as a FILESYSTEM
 * op: ~1.6 GB of orphaned job directories that hold a real final_video.mp4 but
 * have NO content_jobs row. It is NOT a deletion of 5 database rows — an
 * executing agent must not "helpfully" delete 5 content_jobs rows instead.
 *
 * This script is deliberately conservative:
 *   - dry-run by default (prints a manifest, moves nothing);
 *   - --apply MOVES each dir into a quarantine folder (mv, never rm -rf), so it
 *     stays reversible for the retention window;
 *   - it re-verifies against content_jobs that each target id has no row before
 *     touching anything — if any id gained a row, it aborts;
 *   - permanent deletion is a later, separate, explicitly-confirmed step.
 *
 * The five ids are VERIFIED against prod on 2026-07-28 (plan §4.1). #4 and #5
 * also have a ~1 MB stub sibling at the media root — swept in the same op but
 * listed separately.
 *
 * Usage (on the VPS):
 *   pnpm --filter @repo/db exec tsx src/scripts/quarantine-phantom-jobs.ts
 *   pnpm --filter @repo/db exec tsx src/scripts/quarantine-phantom-jobs.ts --apply
 *
 * Previews (1-frame JPEG + 5s clip) are NOT produced by this script — do that
 * with ffmpeg before --apply if you want the extra insurance (plan §4.2):
 *   ffmpeg -y -ss 3 -i <dir>/final_video.mp4 -frames:v 1 <preview>/<id>.jpg
 *   ffmpeg -y -i <dir>/final_video.mp4 -t 5 -c copy <preview>/<id>-5s.mp4
 */

import postgres from "postgres";
import {
  existsSync,
  statSync,
  readdirSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../../../../.env") });

const APPLY = process.argv.includes("--apply");
const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL) throw new Error("DATABASE_URL not set");
const MEDIA_ROOT = (
  process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media"
)
  .replace(/\\/g, "/")
  .replace(/\/+$/, "");
const CHANNEL = "82df56a3-3f7d-4886-ab9f-c9fb3ee70e74"; // Content Forge Main
const QUARANTINE = "/root/backups/2026-07-28-phantom-jobs/quarantine";

// The 5 job dirs (under the channel dir), VERIFIED 2026-07-28.
const PHANTOM_IDS = [
  "ff9c33c1-ac2f-473d-80e8-1e8c1e2c275b",
  "85677168-314b-4865-abf3-17778df10704",
  "5d86b8d8-b1cb-44b6-880d-cca913166008",
  "f30f7481-b3f6-40dd-9503-07d7daa2a104",
  "7378b162-bee2-4706-9377-14c8d9ff6da9",
];
// ~1 MB stub siblings at the media root (swept, listed separately).
const STUB_IDS = [
  "f30f7481-b3f6-40dd-9503-07d7daa2a104",
  "ff9c33c1-ac2f-473d-80e8-1e8c1e2c275b",
];

function dirSize(dir: string): number {
  let total = 0;
  const walk = (d: string) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else {
        try {
          total += statSync(full).size;
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(dir);
  return total;
}

const sql = postgres(DATABASE_URL, { max: 1 });

async function main() {
  console.log(`[quarantine] mode=${APPLY ? "APPLY (move)" : "dry-run"}`);

  // Safety: none of these ids may have a content_jobs row.
  const rows = (await sql`
    SELECT id FROM content_jobs WHERE id = ANY(${[...PHANTOM_IDS, ...STUB_IDS]})
  `) as unknown as Array<{ id: string }>;
  if (rows.length > 0) {
    console.error(
      "[quarantine] ABORT — these ids now HAVE a content_jobs row and are no longer orphans:",
      rows.map((r) => r.id),
    );
    process.exit(2);
  }

  const targets: Array<{
    id: string;
    path: string;
    kind: string;
    bytes: number;
  }> = [];
  for (const id of PHANTOM_IDS) {
    const p = join(MEDIA_ROOT, CHANNEL, id);
    if (existsSync(p))
      targets.push({ id, path: p, kind: "phantom-dir", bytes: dirSize(p) });
    else console.warn(`[quarantine] (already gone) ${p}`);
  }
  for (const id of STUB_IDS) {
    const p = join(MEDIA_ROOT, id);
    if (existsSync(p))
      targets.push({ id, path: p, kind: "root-stub", bytes: dirSize(p) });
  }

  const total = targets.reduce((s, t) => s + t.bytes, 0);
  console.table(
    targets.map((t) => ({
      id: t.id,
      kind: t.kind,
      MB: (t.bytes / 1e6).toFixed(1),
      path: t.path,
    })),
  );
  console.log(
    `[quarantine] total: ${(total / 1e6).toFixed(1)} MB across ${targets.length} dirs`,
  );

  if (!APPLY) {
    console.log(
      "[quarantine] dry-run. Re-run with --apply to MOVE (not delete) into " +
        QUARANTINE,
    );
    await sql.end();
    return;
  }

  mkdirSync(QUARANTINE, { recursive: true });
  for (const t of targets) {
    const dest = join(QUARANTINE, `${t.kind}-${t.id}`);
    renameSync(t.path, dest);
    console.log(`[quarantine] moved ${t.path} -> ${dest}`);
  }
  console.log(
    `[quarantine] done. Freed ~${(total / 1e6).toFixed(1)} MB from the media root. ` +
      "Nothing deleted — permanent removal is a separate confirmed step.",
  );
  await sql.end();
}

main().catch((err) => {
  console.error("[quarantine] fatal:", err);
  process.exit(1);
});
