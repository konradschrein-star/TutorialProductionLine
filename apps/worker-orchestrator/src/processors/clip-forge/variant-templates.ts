import type { DrizzleClient } from "@repo/db";
import { cfFinishingVariants, cfRawClips, cfSources, eq } from "@repo/db";
import { max } from "drizzle-orm";
import type { Queue } from "bullmq";
import type { HitboxV2Result } from "./detect-all-hitboxes.js";
import { decideLayout } from "./decide-layout.js";
import { computeOverlayBoxes } from "./compute-overlay-boxes.js";
import { artifactPresent } from "./artifact-fs.js";

/**
 * Procedural finishing-variant generator.
 *
 * For one raw clip, look at the source's detection data and emit a finishing
 * variant per applicable template. Templates map onto the two underlying
 * ClipForgeShortComposition presets ("fullscreen", "zones") with different
 * recipe parameters that produce visually distinct output.
 *
 * Trigger: called from raw-render.ts after a clip flips to status='ready'.
 * Failure-tolerant: any error is caught at the caller; the raw clip stays
 * ready and the user can manually trigger variant generation via the
 * inspector "+ new fullscreen variant" / "+ new zones variant" buttons.
 *
 * Three templates, per the user's spec:
 *
 *   1. split-stack          — top facecam, bottom main. Maps to "zones"
 *      preset. Applicable only when facecam_layout.mode === "split" AND
 *      both main + facecam hitboxes exist.
 *
 *   2. fullscreen-headshot  — talking head fills the canvas, face on the
 *      golden line, caption pill in the top blur area, subtitle below
 *      the chin. Maps to "fullscreen" preset with fullscreenFit:
 *      "contain-center" and a HEADSHOT crop (head + shoulders). Caption
 *      only visible for the first ~2.5s of the clip (the "hook" window).
 *
 *   3. fullscreen-with-pill — same as fullscreen-headshot but the caption
 *      pill stays visible for the FULL clip duration so the headline is
 *      always on screen. Different feel: more newsy / persistent context.
 *
 * For Marck-style split-screen sources every clip gets all three templates
 * since both speakers have headshot crops. For single-speaker / fullscreen
 * sources, only the two fullscreen templates apply.
 */

type LayoutPreset = "fullscreen" | "zones";

interface VariantSpec {
  templateName: string;
  layoutPreset: LayoutPreset;
  subtitleStyleId: string;
  captionStyleId: string;
  layoutOptions: Record<string, unknown>;
}

interface Hitbox {
  person_box?: { x: number; y: number; w: number; h: number } | null;
  face_box?: { x: number; y: number; w: number; h: number } | null;
}

interface PortraitCropsShape {
  main_hitbox?: Hitbox | null;
  facecam_hitbox?: Hitbox | null;
  fullscreen_hitbox?: Hitbox | null;
  main_headshot?: object | null;
  facecam_headshot?: object | null;
  fullscreen_headshot?: object | null;
}

interface FacecamLayoutShape {
  mode?: string;
  boxes?: Array<{ role?: string }>;
}

/**
 * Pick the templates applicable to this raw clip given the source's
 * detection. Returns one VariantSpec per template that should be rendered.
 */
export function chooseTemplates(
  portraitCrops: PortraitCropsShape | null,
  facecamLayout: FacecamLayoutShape | null,
): VariantSpec[] {
  const out: VariantSpec[] = [];

  const isSplit =
    facecamLayout?.mode === "split" &&
    (facecamLayout.boxes?.some((b) => b.role === "main") ?? false) &&
    (facecamLayout.boxes?.some((b) => b.role === "facecam") ?? false);

  const hasMainHitbox = !!portraitCrops?.main_hitbox;
  const hasFacecamHitbox = !!portraitCrops?.facecam_hitbox;
  const hasAnyHeadshot =
    !!portraitCrops?.fullscreen_headshot ||
    !!portraitCrops?.main_headshot ||
    !!portraitCrops?.facecam_headshot;

  if (isSplit && hasMainHitbox && hasFacecamHitbox) {
    out.push({
      templateName: "split-stack",
      layoutPreset: "zones",
      subtitleStyleId: "impact-white",
      captionStyleId: "white-pill-black",
      layoutOptions: {
        showFrames: false,
        captionStartSec: 0,
        captionEndSec: 2.5,
      },
    });
  }

  if (hasAnyHeadshot) {
    out.push({
      templateName: "fullscreen-headshot",
      layoutPreset: "fullscreen",
      subtitleStyleId: "impact-white",
      captionStyleId: "white-pill-black",
      layoutOptions: {
        fullscreenFit: "contain-center",
        captionStartSec: 0,
        captionEndSec: 2.5,
      },
    });

    out.push({
      templateName: "fullscreen-with-pill",
      layoutPreset: "fullscreen",
      subtitleStyleId: "impact-white",
      captionStyleId: "white-pill-black",
      layoutOptions: {
        fullscreenFit: "contain-center",
        // No captionEndSec → pill stays visible for the whole clip.
      },
    });
  }

  return out;
}

/**
 * V2 variant generator — driven by detection_v2 + decideLayout().
 *
 * If the source has a V2 detection (`cf_sources.detection`), build ONE variant
 * with the layout the decider picked. Falls back to the legacy V1 templates
 * when no V2 detection exists (so older sources keep working).
 */
export async function autoGenerateVariantsV2(
  db: DrizzleClient,
  rawClipId: string,
  queue: Queue,
): Promise<{ generated: number; skipped: boolean; reason?: string }> {
  const [clip] = await db
    .select()
    .from(cfRawClips)
    .where(eq(cfRawClips.id, rawClipId))
    .limit(1);
  if (!clip) return { generated: 0, skipped: true, reason: "clip not found" };

  const [source] = await db
    .select()
    .from(cfSources)
    .where(eq(cfSources.id, clip.source_id))
    .limit(1);
  if (!source)
    return { generated: 0, skipped: true, reason: "source not found" };

  const detectionV2 = (
    source as unknown as { detection?: HitboxV2Result | null }
  ).detection;
  if (!detectionV2 || !Array.isArray(detectionV2.persons)) {
    return {
      generated: 0,
      skipped: true,
      reason: "no V2 detection on source — run detect-v2 first",
    };
  }

  const decision = decideLayout(detectionV2);

  // Don't double-up — but "a row exists" is not the same as "an MP4 exists".
  // If the row is there and its artifact is gone (media wipe, failed render),
  // re-enqueue the finishing render instead of silently reporting success and
  // leaving the clip with nothing playable.
  const existing = await db
    .select({
      id: cfFinishingVariants.id,
      opts: cfFinishingVariants.layout_options,
      key: cfFinishingVariants.rendered_mp4_key,
    })
    .from(cfFinishingVariants)
    .where(eq(cfFinishingVariants.raw_clip_id, rawClipId));
  for (const row of existing) {
    const opts = row.opts as { layoutKind?: string } | null;
    if (opts?.layoutKind !== decision.kind) continue;
    if (await artifactPresent(row.key)) {
      return {
        generated: 0,
        skipped: true,
        reason: `variant for ${decision.kind} already exists`,
      };
    }
    await queue.add("cf-finishing-render", { variant_id: row.id });
    return {
      generated: 0,
      skipped: true,
      reason: `variant for ${decision.kind} exists but its MP4 is missing — re-render enqueued`,
    };
  }

  const [seedAgg] = await db
    .select({ max_seed: max(cfFinishingVariants.variant_seed) })
    .from(cfFinishingVariants)
    .where(eq(cfFinishingVariants.raw_clip_id, rawClipId));
  const seed = (seedAgg?.max_seed ?? 0) + 1;

  // Map the decision into layout_options the runner forwards to the comp.
  const layoutOptions: Record<string, unknown> = {
    template_name: `v2-${decision.kind}`,
    // Stored as camelCase so the render runner (cf-render-variant.mjs) and
    // the comp's V2 dispatch read it directly. Snake_case here breaks the
    // dispatch silently and the comp falls through to the legacy layout.
    layoutKind: decision.kind,
    decision_reason: decision.reason,
  };
  if (decision.fullscreen) {
    layoutOptions["fullscreenCrop"] = decision.fullscreen.crop;
    layoutOptions["fullscreenFaceBox"] = decision.fullscreen.faceBox;
  }
  if (decision.facecam) {
    layoutOptions["facecamCrop"] = decision.facecam.crop;
    layoutOptions["facecamFaceBox"] = decision.facecam.faceBox;
  }
  if (decision.screen) {
    layoutOptions["screenCrop"] = decision.screen.crop;
  }
  if (decision.topFacecam) {
    layoutOptions["topFacecamCrop"] = decision.topFacecam.crop;
    layoutOptions["topFacecamFaceBox"] = decision.topFacecam.faceBox;
  }
  if (decision.bottomFacecam) {
    layoutOptions["bottomFacecamCrop"] = decision.bottomFacecam.crop;
    layoutOptions["bottomFacecamFaceBox"] = decision.bottomFacecam.faceBox;
  }

  // Pre-compute hitbox overlay coordinates in 1080x1920 output space. The UI
  // overlays these as an SVG layer on top of the rendered video — toggled in
  // the inspector + studio. Not baked into the MP4.
  layoutOptions["overlay_boxes"] = computeOverlayBoxes({
    layoutKind: decision.kind,
    crops: {
      fullscreenCrop: decision.fullscreen?.crop,
      facecamCrop: decision.facecam?.crop,
      screenCrop: decision.screen?.crop,
      topFacecamCrop: decision.topFacecam?.crop,
      bottomFacecamCrop: decision.bottomFacecam?.crop,
    },
    detection: detectionV2,
  });

  // The composition still wants a layoutPreset (it's part of the legacy prop
  // surface). For V2 we set it to a sentinel and the comp dispatches on
  // layoutKind instead.
  const [row] = await db
    .insert(cfFinishingVariants)
    .values({
      raw_clip_id: rawClipId,
      platform: "tiktok",
      variant_seed: seed,
      layout_preset: "fullscreen", // sentinel — v2 path ignores this
      subtitle_style_id: "impact-white",
      caption_style_id: "white-pill-black",
      layout_options: layoutOptions,
      caption_text: clip.suggested_caption ?? null,
      subtitle_style: {},
    })
    .returning();
  if (!row) return { generated: 0, skipped: true, reason: "insert failed" };
  await queue.add("cf-finishing-render", { variant_id: row.id });
  return { generated: 1, skipped: false };
}

/**
 * V1 variant generator (legacy). Kept for sources that still only have V1
 * detection data (portrait_crops / facecam_layout). Emits up to 3 variants per
 * the original template rules.
 */
export async function autoGenerateVariants(
  db: DrizzleClient,
  rawClipId: string,
  queue: Queue,
): Promise<{ generated: number; skipped: boolean; reason?: string }> {
  // Look up the raw clip + its source's detection data.
  const [clip] = await db
    .select()
    .from(cfRawClips)
    .where(eq(cfRawClips.id, rawClipId))
    .limit(1);
  if (!clip) return { generated: 0, skipped: true, reason: "clip not found" };

  const [source] = await db
    .select()
    .from(cfSources)
    .where(eq(cfSources.id, clip.source_id))
    .limit(1);
  if (!source)
    return { generated: 0, skipped: true, reason: "source not found" };

  const specs = chooseTemplates(
    (source.portrait_crops as PortraitCropsShape | null) ?? null,
    (source.facecam_layout as FacecamLayoutShape | null) ?? null,
  );

  if (specs.length === 0) {
    return {
      generated: 0,
      skipped: true,
      reason: "no detection data — no applicable templates",
    };
  }

  // Don't double-up: if a variant for the same template already exists for
  // this clip (e.g. raw-render retried after a variant was created), skip
  // it. We key on the layout_options.template_name field. A row whose MP4 is
  // missing does NOT count as existing — it gets a re-render instead.
  const existing = await db
    .select({
      id: cfFinishingVariants.id,
      template: cfFinishingVariants.layout_options,
      key: cfFinishingVariants.rendered_mp4_key,
    })
    .from(cfFinishingVariants)
    .where(eq(cfFinishingVariants.raw_clip_id, rawClipId));
  const existingTemplateNames = new Set<string>();
  for (const row of existing) {
    const opts = row.template as { template_name?: string } | null;
    if (!opts?.template_name) continue;
    existingTemplateNames.add(opts.template_name);
    if (!(await artifactPresent(row.key))) {
      await queue.add("cf-finishing-render", { variant_id: row.id });
    }
  }

  // Reserve sequential variant_seed numbers — race-free per clip.
  const [seedAgg] = await db
    .select({ max_seed: max(cfFinishingVariants.variant_seed) })
    .from(cfFinishingVariants)
    .where(eq(cfFinishingVariants.raw_clip_id, rawClipId));
  let nextSeed = (seedAgg?.max_seed ?? 0) + 1;

  let generated = 0;
  for (const spec of specs) {
    if (existingTemplateNames.has(spec.templateName)) continue;
    const [row] = await db
      .insert(cfFinishingVariants)
      .values({
        raw_clip_id: rawClipId,
        platform: "tiktok",
        variant_seed: nextSeed++,
        layout_preset: spec.layoutPreset,
        subtitle_style_id: spec.subtitleStyleId,
        caption_style_id: spec.captionStyleId,
        layout_options: {
          template_name: spec.templateName,
          ...spec.layoutOptions,
        },
        caption_text: clip.suggested_caption ?? null,
        subtitle_style: {},
      })
      .returning();
    if (!row) continue;
    await queue.add("cf-finishing-render", { variant_id: row.id });
    generated++;
  }
  return { generated, skipped: false };
}
