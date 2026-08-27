/**
 * Run V2 full-frame hitbox detection on a source and persist to
 * cf_sources.detection. The V2 detector returns ALL person + face boxes (not
 * just the biggest) so the layout decider can tell apart fullscreen vs
 * facecam speakers.
 *
 * Usage: node run-cf-detect-v2.mjs <source_id>
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectAllHitboxes } from "./dist/processors/clip-forge/detect-all-hitboxes.js";
import { createDrizzleClient, cfSources, eq } from "@repo/db";
import { getConfig, loadConfig } from "@repo/config";

loadConfig();

const sourceId = process.argv[2];
if (!sourceId) {
  console.error("usage: node run-cf-detect-v2.mjs <source_id>");
  process.exit(1);
}

const cfg = getConfig();
const db = createDrizzleClient(cfg.DATABASE_URL);

const [src] = await db
  .select()
  .from(cfSources)
  .where(eq(cfSources.id, sourceId))
  .limit(1);
if (!src) {
  console.error(`source ${sourceId} not found`);
  process.exit(2);
}

const sourcePath = join(
  cfg.LOCAL_MEDIA_ROOT,
  "cf",
  src.persona_id,
  src.id,
  "source.mp4",
);
console.log(`source: ${sourcePath}  duration=${src.duration_sec}s`);

const workDir = await mkdtemp(join(tmpdir(), "cf-detect-v2-"));
try {
  const detection = await detectAllHitboxes({
    sourcePath,
    durationSec: src.duration_sec,
    workDir,
  });
  await db
    .update(cfSources)
    .set({ detection })
    .where(eq(cfSources.id, sourceId));

  console.log("\nDETECTION V2:");
  console.log(`  frame:    ${detection.frame_w}x${detection.frame_h}`);
  console.log(`  samples:  ${detection.samples}`);
  console.log(`  persons:  ${detection.persons.length}`);
  for (const p of detection.persons) {
    const a = p.person_box.w * p.person_box.h;
    const frac = (a / (detection.frame_w * detection.frame_h)) * 100;
    console.log(
      `    body @ (${p.person_box.x},${p.person_box.y}) ${p.person_box.w}x${p.person_box.h}` +
        `  area=${frac.toFixed(1)}%  face=${p.face_box ? `(${p.face_box.x},${p.face_box.y}) ${p.face_box.w}x${p.face_box.h}` : "none"}` +
        `  cluster=${p.cluster_size}`,
    );
  }
  console.log("\nDONE — cf_sources.detection written");
} catch (err) {
  console.error("FAILED:", err instanceof Error ? err.stack : String(err));
  process.exit(3);
} finally {
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
}
process.exit(0);
