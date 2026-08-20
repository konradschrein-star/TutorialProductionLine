/**
 * Footage Fetcher
 *
 * Orchestrates per-scene footage acquisition for TECH_COMPARISON jobs:
 *   1. Try yt-dlp (YouTube, official manufacturer channels only)
 *   2. Try Pexels video
 *   3. Try Pexels photo (Remotion Ken Burns fallback)
 *   4. null → scene uses motion-graphics only
 *
 * After fetching, each clip is trimmed to the required duration via ffmpeg
 * and saved to local storage. Returns a FootageManifest.
 */

import { spawn } from "node:child_process";
import { writeFile, mkdir, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createContextLogger } from "@repo/logger";
import { searchAndDownloadClip } from "./yt-dlp-client.js";
import {
  searchPexelsVideos,
  searchPexelsPhotos,
  downloadUrlToFile,
} from "./pexels-client.js";
import type {
  FootageBrief,
  FootageClipRequest,
} from "./footage-brief-generator.js";

const logger = createContextLogger("footage-fetcher");

const FFMPEG_BIN = process.env["FFMPEG_BIN"] ?? "ffmpeg";
const PEXELS_API_KEY = process.env["PEXELS_API_KEY"] ?? "";

export interface FootageSceneResult {
  scene_index: number;
  type: "video" | "photo" | null;
  local_path: string | null;
  source: "youtube" | "pexels_video" | "pexels_photo" | null;
  attribution: string | null;
}

export interface FootageManifest {
  job_id: string;
  fetched_at: string;
  scenes: FootageSceneResult[];
}

function runFfmpeg(args: string[], timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`ffmpeg timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const child = spawn(FFMPEG_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
      } else {
        resolve();
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Trim a local video/photo to `durationSec` and re-encode to mp4.
 * Output overwrites `destPath`. Returns destPath.
 */
async function trimToMp4(
  srcPath: string,
  destPath: string,
  durationSec: number,
): Promise<string> {
  await mkdir(dirname(destPath), { recursive: true });
  await runFfmpeg([
    "-y",
    "-i",
    srcPath,
    "-t",
    String(durationSec),
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    destPath,
  ]);
  return destPath;
}

/** Try YouTube via yt-dlp. Returns null (never throws) if no clip was found. */
async function tryYoutube(
  query: string,
  base: string,
  durationSec: number,
): Promise<FootageSceneResult | null> {
  const ytDest = `${base}_raw_yt.mp4`;
  const result = await searchAndDownloadClip(query, ytDest, durationSec, true);
  if (!result) return null;

  const trimmed = `${base}_yt.mp4`;
  await trimToMp4(result.local_path, trimmed, durationSec);
  await unlink(result.local_path).catch(() => undefined);

  return {
    scene_index: -1, // filled in by caller
    type: "video",
    local_path: trimmed,
    source: "youtube",
    attribution: `${result.title} — ${result.channel}`,
  };
}

/** Try Pexels stock video. Returns null (never throws) if unavailable/no hit. */
async function tryPexelsVideo(
  query: string,
  base: string,
  durationSec: number,
): Promise<FootageSceneResult | null> {
  if (!PEXELS_API_KEY) return null;
  const videos = await searchPexelsVideos(query, PEXELS_API_KEY, {
    minDuration: Math.max(1, Math.floor(durationSec * 0.5)),
  }).catch(() => []);
  const video = videos[0];
  if (!video?.download_url) return null;

  const raw = `${base}_raw_pexels.mp4`;
  await downloadUrlToFile(video.download_url, raw);
  const trimmed = `${base}_pexels_video.mp4`;
  await trimToMp4(raw, trimmed, durationSec);
  await unlink(raw).catch(() => undefined);

  return {
    scene_index: -1,
    type: "video",
    local_path: trimmed,
    source: "pexels_video",
    attribution: `Pexels — ${video.attribution.photographer}`,
  };
}

/**
 * Try a Pexels still photo. Kept as a plain image (no ffmpeg trim) — the
 * Remotion comparison composition applies its own Ken Burns pan/zoom to
 * photo-type footage, so there's no fixed "duration" to bake in here.
 */
async function tryPexelsPhoto(
  query: string,
  base: string,
): Promise<FootageSceneResult | null> {
  if (!PEXELS_API_KEY) return null;
  const photos = await searchPexelsPhotos(query, PEXELS_API_KEY, {
    perPage: 3,
  }).catch(() => []);
  const photo = photos[0];
  if (!photo?.download_url) return null;

  const dest = `${base}_pexels_photo.jpg`;
  await downloadUrlToFile(photo.download_url, dest);

  return {
    scene_index: -1,
    type: "photo",
    local_path: dest,
    source: "pexels_photo",
    attribution: `Pexels — ${photo.attribution.photographer}`,
  };
}

/**
 * Cascade order per the scene's source_preference. "youtube"/"any" try the
 * full cascade starting with YouTube; a pexels preference skips straight to
 * that source (saves a slow, usually-fruitless yt-dlp search) but still
 * falls through the remaining sources rather than giving up early.
 */
function cascadeFor(
  preference: FootageClipRequest["source_preference"],
): Array<"youtube" | "pexels_video" | "pexels_photo"> {
  switch (preference) {
    case "pexels_video":
      return ["pexels_video", "pexels_photo", "youtube"];
    case "pexels_photo":
      return ["pexels_photo", "pexels_video", "youtube"];
    case "youtube":
    case "any":
    default:
      return ["youtube", "pexels_video", "pexels_photo"];
  }
}

/**
 * Fetch footage for one scene: yt-dlp → Pexels video → Pexels photo → null.
 * Tries `primary_query` then `fallback_query` at each source before moving
 * to the next. Never throws — a scene with no footage anywhere degrades to
 * `{type: null}` so the render falls back to motion-graphics-only, matching
 * this module's documented contract.
 */
async function fetchSceneFootage(
  brief: FootageClipRequest,
  tmpDir: string,
): Promise<FootageSceneResult> {
  const { scene_index, primary_query, fallback_query, duration_seconds } =
    brief;
  const base = join(tmpDir, `scene_${scene_index}`);
  const queries = [primary_query, fallback_query].filter(Boolean);

  for (const source of cascadeFor(brief.source_preference)) {
    for (const query of queries) {
      try {
        const result =
          source === "youtube"
            ? await tryYoutube(query, base, duration_seconds)
            : source === "pexels_video"
              ? await tryPexelsVideo(query, base, duration_seconds)
              : await tryPexelsPhoto(query, base);
        if (result) {
          logger.info({ scene_index, source, query }, "footage fetched");
          return { ...result, scene_index };
        }
      } catch (err) {
        logger.warn(
          {
            scene_index,
            source,
            query,
            error: err instanceof Error ? err.message : String(err),
          },
          "footage source attempt failed, trying next",
        );
      }
    }
  }

  logger.warn(
    { scene_index, primary_query, fallback_query },
    "no footage found from any source — scene will use motion-graphics only",
  );
  return {
    scene_index,
    type: null,
    local_path: null,
    source: null,
    attribution: null,
  };
}

/**
 * Fetch footage for all scenes described in a FootageBrief.
 * Saves trimmed clips to `{LOCAL_MEDIA_ROOT}/{channelId}/{jobId}/footage/`.
 * Returns a FootageManifest with local paths (processors will convert to public URLs).
 */
export async function fetchFootageForJob(
  brief: FootageBrief,
  channelId: string,
  jobId: string,
): Promise<FootageManifest> {
  const localMediaRoot =
    process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";
  const footageDir = join(localMediaRoot, channelId, jobId, "footage");
  await mkdir(footageDir, { recursive: true });

  logger.info({ jobId, scene_count: brief.length }, "starting footage fetch");

  // Fetch scenes sequentially to avoid hammering yt-dlp / Pexels concurrently
  const scenes: FootageSceneResult[] = [];
  for (const clipReq of brief) {
    const result = await fetchSceneFootage(clipReq, footageDir);
    scenes.push(result);
  }

  const manifest: FootageManifest = {
    job_id: jobId,
    fetched_at: new Date().toISOString(),
    scenes,
  };

  // Write manifest JSON alongside the clips
  const manifestPath = join(footageDir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  const fetched = scenes.filter((s) => s.type !== null).length;
  logger.info(
    { jobId, fetched, total: scenes.length },
    "footage fetch complete",
  );

  return manifest;
}

/**
 * Build a public-accessible URL for a footage clip.
 * Converts local path to URL using MEDIA_BASE_URL env var.
 * Returns null if no local path.
 */
export function footageLocalPathToUrl(localPath: string | null): string | null {
  if (!localPath) return null;
  const mediaBaseUrl = process.env["MEDIA_BASE_URL"] ?? "";
  const localMediaRoot =
    process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";

  if (!mediaBaseUrl) return localPath;

  const relative = localPath.replace(localMediaRoot, "").replace(/\\/g, "/");
  return `${mediaBaseUrl.replace(/\/$/, "")}${relative}`;
}
