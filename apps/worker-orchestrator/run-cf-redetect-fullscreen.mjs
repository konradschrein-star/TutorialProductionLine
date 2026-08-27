/**
 * Force portrait detection in "fullscreen" mode on a source, regardless of
 * what detectFacecamLayout originally classified.
 *
 * Use this when the facecam-layout step misclassified a true PIP-over-
 * fullscreen source as split (e.g. Marck × Olli — small Olli PIP over a
 * full-frame Marck feed). The fullscreen-mode portrait detector runs
 * YOLO11n + YuNet on the WHOLE frame, so the largest person across sampled
 * frames wins — which is the actual main speaker.
 *
 * Writes the new portrait_crops + an overridden facecam_layout.mode='fullscreen'
 * to cf_sources. Existing facecam_layout boxes are preserved as a comment for
 * future reference (and the inspector will keep showing them so you can compare
 * the broken-detection regions with the corrected hitboxes).
 *
 * Usage: node run-cf-redetect-fullscreen.mjs <source_id>
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectPortraitCrops } from "./dist/processors/clip-forge/detect-portrait-crops.js";
import { createDrizzleClient, cfSources, eq } from "@repo/db";
import { getConfig, loadConfig } from "@repo/config";

loadConfig();

const sourceId = process.argv[2];
if (!sourceId) {
  console.error("usage: node run-cf-redetect-fullscreen.mjs <source_id>");
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

const oldLayout = src.facecam_layout ?? null;
const frameW = oldLayout?.frame_w ?? 1920;
const frameH = oldLayout?.frame_h ?? 1080;
console.log(
  `frame: ${frameW}x${frameH}  old mode: ${oldLayout?.mode ?? "(none)"}`,
);

const workDir = await mkdtemp(join(tmpdir(), "cf-redetect-"));
let crops;
try {
  console.log("\n[forced fullscreen] portrait detection...");
  crops = await detectPortraitCrops({
    sourcePath,
    durationSec: src.duration_sec,
    frameW,
    frameH,
    mode: "fullscreen",
    boxes: [],
    workDir,
  });

  // Write new facecam_layout with mode=fullscreen but keep frame_w/h.
  // We stash the old layout as a debug breadcrumb so the inspector can
  // optionally show the broken regions for comparison.
  const newLayout = {
    mode: "fullscreen",
    frame_w: frameW,
    frame_h: frameH,
    boxes: [],
    samples: oldLayout?.samples ?? 0,
    confidence: 1.0,
    detected_at: new Date().toISOString(),
    override: {
      reason:
        "fullscreen-forced — original detector misclassified PIP-over-fullscreen as split",
      original_layout: oldLayout,
    },
  };

  await db
    .update(cfSources)
    .set({ facecam_layout: newLayout, portrait_crops: crops })
    .where(eq(cfSources.id, sourceId));

  console.log("\nResult:");
  console.log(
    `  fullscreen_hitbox.person_box: ${JSON.stringify(crops.fullscreen_hitbox?.person_box ?? null)}`,
  );
  console.log(
    `  fullscreen_hitbox.face_box:   ${JSON.stringify(crops.fullscreen_hitbox?.face_box ?? null)}`,
  );
  console.log(
    `  fullscreen_portrait:          ${JSON.stringify(crops.fullscreen_portrait ?? null)}`,
  );
  console.log(
    `  fullscreen_headshot:          ${JSON.stringify(crops.fullscreen_headshot ?? null)}`,
  );
  console.log(`  confidence:                   ${crops.confidence}`);
} catch (err) {
  console.error("\nDETECTION FAILED:");
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(3);
} finally {
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
}
process.exit(0);
