/**
 * Force-render one variant of every V2 layout kind on a single raw clip, with
 * the hitbox overlay turned on. Used to eyeball all four templates on the
 * same source before committing the layout decider's defaults.
 *
 * Crops are derived from the source's existing detection so each forced
 * layout looks like it would on a real source where the decider picked it.
 *
 * Usage: node run-cf-v2-test-all-layouts.mjs <raw_clip_id>
 */
import { createCfFinishingRenderQueue, createRedisConnection } from "@repo/queue";
import {
  createDrizzleClient,
  cfFinishingVariants,
  cfRawClips,
  cfSources,
  eq,
} from "@repo/db";
import { getConfig, loadConfig } from "@repo/config";
import { computeOverlayBoxes } from "./dist/processors/clip-forge/compute-overlay-boxes.js";

loadConfig();
const cfg = getConfig();
const db = createDrizzleClient(cfg.DATABASE_URL);
const conn = createRedisConnection({ url: cfg.REDIS_URL, mode: "queue" });
const queue = createCfFinishingRenderQueue(conn);

const rawClipId = process.argv[2];
if (!rawClipId) {
  console.error("usage: node run-cf-v2-test-all-layouts.mjs <raw_clip_id>");
  process.exit(1);
}

const [clip] = await db
  .select()
  .from(cfRawClips)
  .where(eq(cfRawClips.id, rawClipId))
  .limit(1);
if (!clip) {
  console.error(`raw clip ${rawClipId} not found`);
  process.exit(2);
}

const [src] = await db
  .select()
  .from(cfSources)
  .where(eq(cfSources.id, clip.source_id))
  .limit(1);
if (!src?.detection?.persons || src.detection.persons.length === 0) {
  console.error(
    `source ${clip.source_id} has no V2 detection — run run-cf-detect-v2.mjs first`,
  );
  process.exit(3);
}

const persons = src.detection.persons.filter(
  (p) => p.cluster_size >= 6 && p.person_box.w * p.person_box.h / (src.detection.frame_w * src.detection.frame_h) >= 0.04,
);
// Drop merged-blob false positives.
const cleaned = persons.filter((a) => {
  for (const b of persons) {
    if (b === a) continue;
    const ix1 = Math.max(a.person_box.x, b.person_box.x);
    const iy1 = Math.max(a.person_box.y, b.person_box.y);
    const ix2 = Math.min(a.person_box.x + a.person_box.w, b.person_box.x + b.person_box.w);
    const iy2 = Math.min(a.person_box.y + a.person_box.h, b.person_box.y + b.person_box.h);
    const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
    const aArea = a.person_box.w * a.person_box.h;
    const bArea = b.person_box.w * b.person_box.h;
    if (bArea < aArea && inter / aArea >= 0.55 && b.cluster_size >= a.cluster_size) {
      return false;
    }
  }
  return true;
});

cleaned.sort((a, b) => b.person_box.w * b.person_box.h - a.person_box.w * a.person_box.h);
const big = cleaned[0];
const small = cleaned[1] ?? cleaned[0];

console.log(`cleaned persons: ${cleaned.length}`);
console.log(
  `  big   = ${big.person_box.w}x${big.person_box.h}@(${big.person_box.x},${big.person_box.y})  face=${big.face_box ? "yes" : "no"}`,
);
console.log(
  `  small = ${small.person_box.w}x${small.person_box.h}@(${small.person_box.x},${small.person_box.y})  face=${small.face_box ? "yes" : "no"}`,
);

function deriveFace(p) {
  if (p.face_box) return p.face_box;
  return {
    x: Math.round(p.person_box.x + p.person_box.w * 0.32),
    y: Math.round(p.person_box.y + p.person_box.h * 0.05),
    w: Math.round(p.person_box.w * 0.36),
    h: Math.round(p.person_box.h * 0.22),
  };
}

// Crop helpers that mirror decide-layout.ts.
function clamp(b, frame) {
  const x = Math.max(0, Math.min(b.x, frame.w - 1));
  const y = Math.max(0, Math.min(b.y, frame.h - 1));
  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(Math.min(b.w, frame.w - x)),
    h: Math.round(Math.min(b.h, frame.h - y)),
  };
}
function facecamCrop(p, frame) {
  return clamp(
    {
      x: p.person_box.x - p.person_box.w * 0.08,
      y: p.person_box.y - p.person_box.h * 0.12,
      w: p.person_box.w * 1.16,
      h: p.person_box.h * 1.21,
    },
    frame,
  );
}
function fullscreenCropExcluding(big, smallFacecamRect, frame) {
  const body = big.person_box;
  let crop = { x: 0, y: 0, w: frame.w, h: frame.h };
  if (!boxesOverlap(crop, smallFacecamRect)) return crop;
  // Carve away the side that loses the least area while keeping body inside.
  const candidates = [];
  const cuts = [
    { x: smallFacecamRect.x + smallFacecamRect.w, y: 0, w: frame.w - smallFacecamRect.x - smallFacecamRect.w, h: frame.h }, // right of small
    { x: 0, y: 0, w: smallFacecamRect.x, h: frame.h }, // left of small
    { x: 0, y: smallFacecamRect.y + smallFacecamRect.h, w: frame.w, h: frame.h - smallFacecamRect.y - smallFacecamRect.h }, // below
    { x: 0, y: 0, w: frame.w, h: smallFacecamRect.y }, // above
  ];
  for (const c of cuts) {
    if (
      body.x >= c.x &&
      body.y >= c.y &&
      body.x + body.w <= c.x + c.w &&
      body.y + body.h <= c.y + c.h
    ) {
      candidates.push(c);
    }
  }
  candidates.sort((a, b) => b.w * b.h - a.w * a.h);
  return candidates[0] ?? crop;
}
function boxesOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function oppositeRect(frame, b) {
  const cands = [
    { x: 0, y: 0, w: b.x, h: frame.h },
    { x: b.x + b.w, y: 0, w: frame.w - b.x - b.w, h: frame.h },
    { x: 0, y: 0, w: frame.w, h: b.y },
    { x: 0, y: b.y + b.h, w: frame.w, h: frame.h - b.y - b.h },
  ].filter((c) => c.w > 50 && c.h > 50);
  cands.sort((a, b) => b.w * b.h - a.w * a.h);
  return cands[0];
}

const frame = { w: src.detection.frame_w, h: src.detection.frame_h };
const bigFace = deriveFace(big);
const smallFace = deriveFace(small);
const smallFacecam = facecamCrop(small, frame);
const bigFacecam = facecamCrop(big, frame);
const bigFullscreen = fullscreenCropExcluding(big, smallFacecam, frame);

function overlayFor(layoutKind, crops) {
  return computeOverlayBoxes({
    layoutKind,
    crops,
    detection: src.detection,
  });
}

const layouts = [
  {
    name: "fullscreen-single",
    options: {
      template_name: "v2-fullscreen-single",
      layoutKind: "fullscreen-single",
      decision_reason: "[test override] forced fullscreen-single",
      fullscreenCrop: bigFullscreen,
      fullscreenFaceBox: bigFace,
      overlay_boxes: overlayFor("fullscreen-single", {
        fullscreenCrop: bigFullscreen,
      }),
    },
  },
  {
    name: "top-fullscreen-bottom-facecam",
    options: {
      template_name: "v2-top-fullscreen-bottom-facecam",
      layoutKind: "top-fullscreen-bottom-facecam",
      decision_reason: "[test override] forced top-fullscreen-bottom-facecam",
      fullscreenCrop: bigFullscreen,
      fullscreenFaceBox: bigFace,
      facecamCrop: smallFacecam,
      facecamFaceBox: smallFace,
      overlay_boxes: overlayFor("top-fullscreen-bottom-facecam", {
        fullscreenCrop: bigFullscreen,
        facecamCrop: smallFacecam,
      }),
    },
  },
  {
    name: "stacked-facecams",
    options: {
      template_name: "v2-stacked-facecams",
      layoutKind: "stacked-facecams",
      decision_reason: "[test override] forced stacked-facecams",
      topFacecamCrop: bigFacecam,
      topFacecamFaceBox: bigFace,
      bottomFacecamCrop: smallFacecam,
      bottomFacecamFaceBox: smallFace,
      overlay_boxes: overlayFor("stacked-facecams", {
        topFacecamCrop: bigFacecam,
        bottomFacecamCrop: smallFacecam,
      }),
    },
  },
  {
    name: "facecam-top-screen-bottom",
    options: (() => {
      const screen = oppositeRect(frame, smallFacecam);
      return {
        template_name: "v2-facecam-top-screen-bottom",
        layoutKind: "facecam-top-screen-bottom",
        decision_reason: "[test override] forced facecam-top-screen-bottom",
        facecamCrop: smallFacecam,
        facecamFaceBox: smallFace,
        screenCrop: screen,
        overlay_boxes: overlayFor("facecam-top-screen-bottom", {
          facecamCrop: smallFacecam,
          screenCrop: screen,
        }),
      };
    })(),
  },
];

// Delete existing variants on this clip and their MP4 files.
const existing = await db
  .select()
  .from(cfFinishingVariants)
  .where(eq(cfFinishingVariants.raw_clip_id, rawClipId));
console.log(`\nDropping ${existing.length} existing variant rows`);
await db
  .delete(cfFinishingVariants)
  .where(eq(cfFinishingVariants.raw_clip_id, rawClipId));

let seed = 1;
for (const L of layouts) {
  const [row] = await db
    .insert(cfFinishingVariants)
    .values({
      raw_clip_id: rawClipId,
      platform: "tiktok",
      variant_seed: seed++,
      layout_preset: "fullscreen", // sentinel — v2 path ignores
      subtitle_style_id: "impact-white",
      caption_style_id: "white-pill-black",
      layout_options: L.options,
      caption_text: clip.suggested_caption ?? null,
      subtitle_style: {},
    })
    .returning();
  await queue.add("cf-finishing-render", { variant_id: row.id });
  console.log(`  enqueued ${L.name} -> variant ${row.id} (seed ${row.variant_seed})`);
}

await queue.close();
await conn.quit();
console.log("\nAll 4 layouts queued. Will render at concurrency 1 (~28 min total).");
process.exit(0);
