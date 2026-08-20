import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DrizzleClient } from "@repo/db";
import { cfSources, eq } from "@repo/db";
import { detectFacecamLayout } from "./detect-facecam.js";
import { detectPortraitCrops } from "./detect-portrait-crops.js";
import { detectAllHitboxes } from "./detect-all-hitboxes.js";

/**
 * Run facecam + portrait-crop detection (V1) AND full-frame hitbox detection
 * (V2) on a source, persisting to cf_sources.facecam_layout +
 * cf_sources.portrait_crops + cf_sources.detection.
 *
 * V1 and V2 are independent detectors with independent idempotency checks —
 * a source can have one populated without the other (e.g. after V2 shipped,
 * older sources only have V1 until reprocessed). Both run unless already
 * populated and `force` is false.
 *
 * Failure-tolerant: any error inside detection is logged + thrown to the
 * caller. Inline callers (clip-detection.ts, raw-render.ts) catch and
 * continue so a detection failure never poisons the upstream pipeline
 * stage.
 */
export async function runSourceDetection(
  db: DrizzleClient,
  args: {
    sourceId: string;
    sourcePath: string;
    durationSec: number;
    force?: boolean;
    log?: (line: object) => void;
  },
): Promise<{
  skipped: boolean;
  mode?: string;
  confidence?: number;
  v2Persons?: number;
}> {
  const log = args.log ?? ((line) => console.log(JSON.stringify(line)));

  const [existing] = await db
    .select({
      facecam: cfSources.facecam_layout,
      portrait: cfSources.portrait_crops,
      detection: cfSources.detection,
    })
    .from(cfSources)
    .where(eq(cfSources.id, args.sourceId))
    .limit(1);

  const needsV1 = args.force || !existing?.facecam || !existing?.portrait;
  const needsV2 = args.force || !existing?.detection;

  if (!needsV1 && !needsV2) {
    log({
      level: "info",
      msg: "[detect] already populated, skipping",
      source_id: args.sourceId,
    });
    return { skipped: true };
  }

  const workDir = await mkdtemp(join(tmpdir(), "cf-detect-"));
  try {
    let mode: string | undefined;
    let confidence: number | undefined;

    if (needsV1) {
      log({
        level: "info",
        msg: "[detect] starting facecam layout",
        source_id: args.sourceId,
      });
      const layout = await detectFacecamLayout({
        sourcePath: args.sourcePath,
        durationSec: args.durationSec,
        workDir,
        log,
      });
      await db
        .update(cfSources)
        .set({ facecam_layout: layout })
        .where(eq(cfSources.id, args.sourceId));

      log({
        level: "info",
        msg: "[detect] starting portrait crops",
        source_id: args.sourceId,
        mode: layout.mode,
      });
      const crops = await detectPortraitCrops({
        sourcePath: args.sourcePath,
        durationSec: args.durationSec,
        frameW: layout.frame_w,
        frameH: layout.frame_h,
        mode: layout.mode,
        boxes: layout.boxes,
        workDir,
        log,
      });
      await db
        .update(cfSources)
        .set({ portrait_crops: crops })
        .where(eq(cfSources.id, args.sourceId));

      mode = layout.mode;
      confidence = layout.confidence;
      log({
        level: "info",
        msg: "[detect] V1 complete",
        source_id: args.sourceId,
        mode: layout.mode,
        confidence: layout.confidence,
        has_main_hitbox: !!crops.main_hitbox,
        has_facecam_hitbox: !!crops.facecam_hitbox,
        has_fullscreen_hitbox: !!crops.fullscreen_hitbox,
      });
    }

    let v2Persons: number | undefined;
    if (needsV2) {
      log({
        level: "info",
        msg: "[detect] starting V2 full-frame hitboxes",
        source_id: args.sourceId,
      });
      const detection = await detectAllHitboxes({
        sourcePath: args.sourcePath,
        durationSec: args.durationSec,
        workDir,
        log,
      });
      await db
        .update(cfSources)
        .set({ detection })
        .where(eq(cfSources.id, args.sourceId));
      v2Persons = detection.persons.length;
      log({
        level: "info",
        msg: "[detect] V2 complete",
        source_id: args.sourceId,
        persons: v2Persons,
      });
    }

    return { skipped: false, mode, confidence, v2Persons };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
