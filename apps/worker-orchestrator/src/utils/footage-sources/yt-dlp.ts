import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createContextLogger } from "@repo/logger";
import { searchAndDownloadClip } from "../yt-dlp-client.js";
import { evaluateClip } from "../footage-quality-gate.js";
import { footageDataDir } from "./data-dir.js";
import type { FootageRequest, FootageResult, FootageSource } from "./types.js";

const logger = createContextLogger("footage-yt-dlp");

export const ytDlpSource: FootageSource = {
  name: "yt-dlp",
  async fetch(req: FootageRequest): Promise<FootageResult | null> {
    const dir = footageDataDir();
    const fileName = `${randomUUID()}.mp4`;
    const destPath = join(dir, fileName);

    const clip = await searchAndDownloadClip(
      req.query,
      destPath,
      Math.min(req.durationSeconds, 15),
      true /* requireOfficial — copyright safety */,
    );
    if (!clip) return null;

    const evalResult = await evaluateClip(clip.local_path);
    if (!evalResult.accepted) {
      logger.info(
        { query: req.query, reasons: evalResult.reasons },
        "yt-dlp clip rejected by quality gate",
      );
      return null;
    }

    return {
      ref: `footage/${fileName}`,
      localPath: clip.local_path,
      source: "yt-dlp",
      durationSeconds: evalResult.metrics.durationSeconds,
      width: evalResult.metrics.width,
      height: evalResult.metrics.height,
      attribution: clip.channel ? `via YouTube — ${clip.channel}` : null,
      providerMeta: {
        url: clip.url,
        title: clip.title,
        channel: clip.channel,
        channel_id: clip.channel_id,
      },
    };
  },
};
