/**
 * Format-agnostic media view for the job detail page.
 *
 * The legacy job detail tabs only understood the old pipeline shapes —
 * `assembly_manifest.scenes` (V1/V2 image scenes) and `r2_asset_manifest`
 * (local-path asset list). Newer local-render formats (RANKING, …) never write
 * those, so their Scenes/Assets tabs came up empty and no final-video player
 * ever appeared.
 *
 * This helper normalizes ANY format into one shape the client tabs consume:
 *   - `finalVideoUrl` — resolved disk-first (works for every local render),
 *     then from the legacy manifest.
 *   - `scenes`        — the visual shots (per-scene images for legacy formats,
 *     per-item hero images for RANKING).
 *   - `assets`        — every file used by the job.
 *
 * Server-only: it stat()s files under LOCAL_MEDIA_ROOT. hub-web runs on the
 * same VPS as the render output, so the paths resolve. When a file is absent
 * (e.g. local dev), it degrades to null/empty instead of throwing.
 */
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Job } from "@/lib/repositories/job-repository";
import {
  extractRanking,
  orderedPlacements,
  toMediaUrl,
} from "@/lib/ranking-blocks";

export interface JobMediaScene {
  key: string;
  label: string;
  url: string;
  caption?: string | null;
  kind: "image" | "video";
}

export interface JobMediaAsset {
  key: string;
  name: string;
  url: string;
  type: string;
  sizeBytes: number;
}

export interface JobMediaView {
  finalVideoUrl: string | null;
  scenes: JobMediaScene[];
  assets: JobMediaAsset[];
}

/** Resolve a `file://` / absolute media path to its on-disk absolute path. */
function toAbsPath(raw: string, mediaRoot: string): string | null {
  if (/^https?:\/\//i.test(raw)) return null;
  let p = raw;
  if (p.startsWith("file://")) p = p.slice("file://".length);
  const norm = p.replace(/\\/g, "/");
  if (norm.startsWith("/")) return norm;
  // Relative → resolve under the media root.
  return mediaRoot ? resolve(join(mediaRoot, norm)) : null;
}

/** Best-effort file size in bytes; 0 when it can't be determined. */
function sizeOf(raw: string, mediaRoot: string): number {
  try {
    const abs = toAbsPath(raw, mediaRoot);
    if (!abs) return 0;
    return statSync(abs).size;
  } catch {
    return 0;
  }
}

// ── Legacy scene extraction (assembly_manifest) ────────────────────────────
function legacySceneImages(assemblyManifest: unknown): Array<{
  sceneIndex: number;
  imageIndex: number;
  r2Key: string;
  prompt: string | null;
  text: string | null;
}> {
  if (!assemblyManifest || typeof assemblyManifest !== "object") return [];
  const manifest = assemblyManifest as Record<string, unknown>;
  if (!Array.isArray(manifest.scenes)) return [];

  const images: Array<{
    sceneIndex: number;
    imageIndex: number;
    r2Key: string;
    prompt: string | null;
    text: string | null;
  }> = [];

  for (const scene of manifest.scenes as Record<string, unknown>[]) {
    const sceneIndex =
      typeof scene.scene_index === "number" ? scene.scene_index : 0;

    if (Array.isArray(scene.sentence_images)) {
      (scene.sentence_images as Record<string, unknown>[]).forEach(
        (si, imgIdx) => {
          if (typeof si.r2_key === "string") {
            images.push({
              sceneIndex,
              imageIndex: imgIdx,
              r2Key: si.r2_key,
              prompt:
                typeof si.prompt === "string"
                  ? si.prompt
                  : typeof scene.image_prompt === "string"
                    ? scene.image_prompt
                    : null,
              text:
                typeof scene.paragraph === "string" ? scene.paragraph : null,
            });
          }
        },
      );
    } else if (typeof scene.visual_asset_key === "string") {
      images.push({
        sceneIndex,
        imageIndex: 0,
        r2Key: scene.visual_asset_key,
        prompt:
          typeof scene.image_prompt === "string" ? scene.image_prompt : null,
        text: typeof scene.paragraph === "string" ? scene.paragraph : null,
      });
    }
  }
  return images;
}

// ── Final video ────────────────────────────────────────────────────────────
function resolveFinalVideoUrl(job: Job, mediaRoot: string): string | null {
  // 1. On-disk local render: <root>/<channel>/<job>/final_video.mp4. Covers
  //    RANKING and any Remotion/FFmpeg format that writes to the job dir.
  if (mediaRoot && job.channel_id && job.id) {
    const abs = resolve(
      join(mediaRoot, job.channel_id, job.id, "final_video.mp4"),
    );
    if (existsSync(abs)) {
      return `/api/media/${job.channel_id}/${job.id}/final_video.mp4`;
    }
  }
  // 2. Legacy manifest final render entry.
  const manifest =
    (job.r2_asset_manifest as Array<{
      key: string;
      type: string;
      size_bytes: number;
    }> | null) ?? [];
  const finalEntry = manifest.find(
    (a) => a.type === "video/final-render" || a.key.includes("final_video"),
  );
  if (finalEntry) {
    const asMedia = mediaRoot ? toMediaUrl(finalEntry.key, mediaRoot) : null;
    if (asMedia && existsSync(toAbsPath(finalEntry.key, mediaRoot) ?? "")) {
      return asMedia;
    }
    return `/api/assets/${job.id}/${finalEntry.key}`;
  }
  return null;
}

// ── Scenes ───────────────────────────────────────────────────────────────
function buildScenes(job: Job, mediaRoot: string): JobMediaScene[] {
  // Legacy image scenes win when present (V1/V2 pipelines).
  const legacy = legacySceneImages(job.assembly_manifest);
  if (legacy.length > 0) {
    return legacy.map((img) => ({
      key: `${img.sceneIndex}-${img.imageIndex}`,
      label:
        img.imageIndex === 0
          ? `Scene ${img.sceneIndex}`
          : `Scene ${img.sceneIndex}·${img.imageIndex}`,
      url: `/api/assets/${job.id}/${img.r2Key}`,
      caption: img.prompt ?? img.text ?? null,
      kind: "image" as const,
    }));
  }

  // RANKING: one scene per item — the hero image shown on the tier board +
  // reveal (VA override > auto-fetched > operator), in reveal order.
  if (job.format === "RANKING") {
    const ranking = extractRanking(job.metadata);
    if (!ranking) return [];
    const byId = new Map(ranking.items.map((it) => [it.id, it]));
    const scenes: JobMediaScene[] = [];
    for (const p of orderedPlacements(ranking)) {
      const item = byId.get(p.itemId);
      if (!item) continue;
      const url = toMediaUrl(
        item.heroSelection?.imageUrl ?? item.heroImageUrl ?? item.imageUrl,
        mediaRoot,
      );
      if (!url) continue;
      const tier = ranking.tierConfig?.tiers?.[p.tierIndex]?.name ?? null;
      scenes.push({
        key: item.id,
        label: item.name,
        url,
        caption: tier,
        kind: "image",
      });
    }
    return scenes;
  }

  return [];
}

// ── Assets ─────────────────────────────────────────────────────────────────
function buildAssets(
  job: Job,
  mediaRoot: string,
  finalVideoUrl: string | null,
): JobMediaAsset[] {
  // Legacy manifest wins when populated.
  const manifest =
    (job.r2_asset_manifest as Array<{
      key: string;
      type: string;
      size_bytes: number;
    }> | null) ?? [];
  const filtered = manifest.filter((a) => a.key !== "skipped");
  if (filtered.length > 0) {
    return filtered.map((a) => ({
      key: a.key,
      name: a.key.split("/").pop() ?? a.type,
      url: toMediaUrl(a.key, mediaRoot) ?? `/api/assets/${job.id}/${a.key}`,
      type: a.type,
      sizeBytes: a.size_bytes ?? 0,
    }));
  }

  // RANKING: assemble the "assets used" from metadata (final video, narration
  // audio, per-item hero images + footage candidates, create-time uploads).
  if (job.format === "RANKING") {
    const ranking = extractRanking(job.metadata);
    if (!ranking) return [];
    const out: JobMediaAsset[] = [];
    const seen = new Set<string>();

    const push = (rawUrl: string | undefined, type: string, name?: string) => {
      if (!rawUrl) return;
      const url = toMediaUrl(rawUrl, mediaRoot);
      if (!url || seen.has(url)) return;
      seen.add(url);
      out.push({
        key: rawUrl,
        name: name ?? rawUrl.split("/").pop() ?? type,
        url,
        type,
        sizeBytes: sizeOf(rawUrl, mediaRoot),
      });
    };

    if (finalVideoUrl && !seen.has(finalVideoUrl)) {
      seen.add(finalVideoUrl);
      out.push({
        key: finalVideoUrl,
        name: "final_video.mp4",
        url: finalVideoUrl,
        type: "video/final-render",
        sizeBytes:
          job.final_video_size_bytes ??
          (mediaRoot && job.channel_id
            ? sizeOf(
                `${mediaRoot}/${job.channel_id}/${job.id}/final_video.mp4`,
                mediaRoot,
              )
            : 0),
      });
    }

    push(ranking.audioUrl, "audio/narration", "narration.mp3");

    const byId = new Map(ranking.items.map((it) => [it.id, it]));
    for (const p of orderedPlacements(ranking)) {
      const item = byId.get(p.itemId);
      if (!item) continue;
      push(
        item.heroSelection?.imageUrl ?? item.heroImageUrl ?? item.imageUrl,
        "image/hero",
        `${item.name} — hero`,
      );
      for (const c of item.footageCandidates ?? []) {
        push(
          c.url,
          c.kind === "photo" ? "image/footage" : "video/footage",
          `${item.name} — ${c.source}`,
        );
      }
      for (const u of item.userFootageUrls ?? []) {
        push(u, "video/footage", `${item.name} — upload`);
      }
    }
    for (const m of ranking.userMedia ?? []) {
      push(
        m.url,
        m.kind === "photo" ? "image/upload" : "video/upload",
        m.name ?? "upload",
      );
    }
    return out;
  }

  return [];
}

/**
 * Build the normalized, format-agnostic media view for a job. Pure read —
 * only stat()s files. Never throws.
 */
export function buildJobMediaView(job: Job): JobMediaView {
  const mediaRoot = process.env["LOCAL_MEDIA_ROOT"] ?? "";
  const finalVideoUrl = resolveFinalVideoUrl(job, mediaRoot);
  return {
    finalVideoUrl,
    scenes: buildScenes(job, mediaRoot),
    assets: buildAssets(job, mediaRoot, finalVideoUrl),
  };
}
