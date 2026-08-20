import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createContextLogger } from "@repo/logger";
import {
  searchPexelsVideos,
  searchPexelsPhotos,
  downloadUrlToFile,
} from "../pexels-client.js";
import { evaluateClip } from "../footage-quality-gate.js";
import { footageDataDir } from "./data-dir.js";
import type { FootageRequest, FootageResult, FootageSource } from "./types.js";

const logger = createContextLogger("footage-pexels");

async function tryVideo(
  req: FootageRequest,
  dir: string,
  apiKey: string,
): Promise<FootageResult | null> {
  const videos = await searchPexelsVideos(req.query, apiKey, { perPage: 3 });
  if (videos.length === 0) return null;

  // Prefer longer-duration videos so we have headroom for trim.
  videos.sort((a, b) => b.duration - a.duration);
  const candidate = videos[0]!;
  const fileName = `${randomUUID()}.mp4`;
  const destPath = join(dir, fileName);
  await downloadUrlToFile(candidate.download_url, destPath);

  const evalResult = await evaluateClip(destPath);
  if (!evalResult.accepted) {
    logger.info(
      { query: req.query, reasons: evalResult.reasons },
      "pexels video rejected by quality gate",
    );
    return null;
  }

  return {
    ref: `footage/${fileName}`,
    localPath: destPath,
    source: "pexels",
    durationSeconds: evalResult.metrics.durationSeconds,
    width: evalResult.metrics.width,
    height: evalResult.metrics.height,
    attribution: `Pexels — ${candidate.attribution.photographer}`,
    providerMeta: {
      pexels_id: candidate.id,
      source_url: candidate.attribution.source_url,
      kind: "video",
    },
  };
}

async function tryPhoto(
  req: FootageRequest,
  dir: string,
  apiKey: string,
): Promise<FootageResult | null> {
  const photos = await searchPexelsPhotos(req.query, apiKey, { perPage: 3 });
  if (photos.length === 0) return null;

  const candidate = photos[0]!;
  const fileName = `${randomUUID()}.jpg`;
  const destPath = join(dir, fileName);
  await downloadUrlToFile(candidate.download_url, destPath);

  // Photo skips the ffprobe quality gate — it's a still.
  return {
    ref: `footage/${fileName}`,
    localPath: destPath,
    source: "pexels",
    durationSeconds: 0, // still image; caller Ken Burns it
    width: candidate.width,
    height: candidate.height,
    attribution: `Pexels — ${candidate.attribution.photographer}`,
    providerMeta: {
      pexels_id: candidate.id,
      source_url: candidate.attribution.source_url,
      kind: "photo",
      avg_color_hex: candidate.avg_color_hex,
    },
  };
}

export const pexelsSource: FootageSource = {
  name: "pexels",
  async fetch(req: FootageRequest): Promise<FootageResult | null> {
    const apiKey = process.env["PEXELS_API_KEY"];
    if (!apiKey) {
      logger.warn("PEXELS_API_KEY not configured");
      return null;
    }

    const dir = footageDataDir();
    const video = await tryVideo(req, dir, apiKey);
    if (video) return video;
    return tryPhoto(req, dir, apiKey);
  },
};
