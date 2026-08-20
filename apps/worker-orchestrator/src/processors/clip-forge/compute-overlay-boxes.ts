import type { HitboxV2Result } from "./detect-all-hitboxes.js";

/**
 * Compute hitbox overlay coordinates in 1080x1920 output space, given a V2
 * layout (the crops the renderer will use) and the source detection (every
 * detected person + face in source pixels).
 *
 * Result is the array stashed on `cf_finishing_variants.layout_options.overlay_boxes`
 * and consumed by the inspector + studio UI. The UI plots each box into an SVG
 * with viewBox="0 0 1080 1920" overlaid on the rendered 9:16 video. No baked-in
 * hitboxes in the MP4 — they are pure UI overlay.
 *
 * Math mirrors `buildV2Plan` + `planPanel` + `V2HitboxOverlay` in
 * `ClipForgeShortComposition.tsx`. Keep them in sync — divergence here would
 * make the overlay drift off the video.
 */

const OUT_W = 1080;
const OUT_H = 1920;
const V2_PANEL_MIDLINE = OUT_H / 2;

export type LayoutKind =
  | "fullscreen-single"
  | "facecam-top-screen-bottom"
  | "stacked-facecams"
  | "top-fullscreen-bottom-facecam";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OverlayBox {
  kind: "person" | "face";
  /** Short index label ("P0", "F0") for visual identification across panels. */
  label: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OverlayBoxesInput {
  layoutKind: LayoutKind;
  /** Crops the renderer is using (in source coords). */
  crops: {
    fullscreenCrop?: Box;
    facecamCrop?: Box;
    screenCrop?: Box;
    topFacecamCrop?: Box;
    bottomFacecamCrop?: Box;
  };
  /** Raw V2 detection — every person + face in source coords. */
  detection: HitboxV2Result;
}

interface PanelGeo {
  crop: Box;
  rect: { x: number; y: number; w: number; h: number };
  dispW: number;
  dispH: number;
  offsetX: number;
  offsetY: number;
}

function planPanel(
  crop: Box,
  rect: { x: number; y: number; w: number; h: number },
): PanelGeo {
  const cropAspect = crop.w / crop.h;
  const rectAspect = rect.w / rect.h;
  const closeAspect = Math.abs(cropAspect - rectAspect) / rectAspect < 0.08;
  const scale = closeAspect
    ? Math.max(rect.w / crop.w, rect.h / crop.h)
    : Math.min(rect.w / crop.w, rect.h / crop.h);
  const dispW = crop.w * scale;
  const dispH = crop.h * scale;
  const offsetX = (rect.w - dispW) / 2;
  const offsetY = (rect.h - dispH) / 2;
  return { crop, rect, dispW, dispH, offsetX, offsetY };
}

function boxesOverlap(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

function buildPanels(input: OverlayBoxesInput): PanelGeo[] {
  const { layoutKind, crops } = input;
  const fullCanvas = { x: 0, y: 0, w: OUT_W, h: OUT_H };
  const topHalf = { x: 0, y: 0, w: OUT_W, h: V2_PANEL_MIDLINE };
  const bottomHalf = {
    x: 0,
    y: V2_PANEL_MIDLINE,
    w: OUT_W,
    h: OUT_H - V2_PANEL_MIDLINE,
  };

  if (layoutKind === "fullscreen-single" && crops.fullscreenCrop) {
    const panel = planPanel(crops.fullscreenCrop, fullCanvas);
    // Mirror the upward shift in `buildV2Plan` so overlay lines up exactly.
    if (panel.dispH < OUT_H) {
      const slack = OUT_H - panel.dispH;
      panel.offsetY = slack * 0.2;
    }
    return [panel];
  }
  if (
    layoutKind === "top-fullscreen-bottom-facecam" &&
    crops.fullscreenCrop &&
    crops.facecamCrop
  ) {
    return [
      planPanel(crops.fullscreenCrop, topHalf),
      planPanel(crops.facecamCrop, bottomHalf),
    ];
  }
  if (
    layoutKind === "stacked-facecams" &&
    crops.topFacecamCrop &&
    crops.bottomFacecamCrop
  ) {
    return [
      planPanel(crops.topFacecamCrop, topHalf),
      planPanel(crops.bottomFacecamCrop, bottomHalf),
    ];
  }
  if (
    layoutKind === "facecam-top-screen-bottom" &&
    crops.facecamCrop &&
    crops.screenCrop
  ) {
    return [
      planPanel(crops.facecamCrop, topHalf),
      planPanel(crops.screenCrop, bottomHalf),
    ];
  }
  return [];
}

export function computeOverlayBoxes(input: OverlayBoxesInput): OverlayBox[] {
  const panels = buildPanels(input);
  if (panels.length === 0) return [];

  const out: OverlayBox[] = [];
  for (let pi = 0; pi < panels.length; pi++) {
    const panel = panels[pi];
    const scale = panel.dispW / panel.crop.w;

    for (let i = 0; i < input.detection.persons.length; i++) {
      const person = input.detection.persons[i];
      if (!boxesOverlap(person.person_box, panel.crop)) continue;

      const map = (b: Box): { x: number; y: number; w: number; h: number } => ({
        x: panel.rect.x + panel.offsetX + (b.x - panel.crop.x) * scale,
        y: panel.rect.y + panel.offsetY + (b.y - panel.crop.y) * scale,
        w: b.w * scale,
        h: b.h * scale,
      });

      const p = map(person.person_box);
      out.push({
        kind: "person",
        label: `P${i}`,
        confidence: person.person_conf,
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
      });

      if (person.face_box) {
        const f = map(person.face_box);
        out.push({
          kind: "face",
          label: `F${i}`,
          confidence: person.face_conf,
          x: f.x,
          y: f.y,
          w: f.w,
          h: f.h,
        });
      }
    }
  }
  return out;
}
