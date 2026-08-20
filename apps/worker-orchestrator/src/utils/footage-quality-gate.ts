import { spawn } from "node:child_process";
import { createContextLogger } from "@repo/logger";

const logger = createContextLogger("footage-quality-gate");
const FFPROBE_BIN = process.env["FFPROBE_BIN"] ?? "ffprobe";

export const QUALITY_THRESHOLDS = {
  minWidth: 1280,
  minHeight: 720,
  minDurationSeconds: 5,
  /** Below this average frame rate we treat the clip as a slideshow. */
  minFps: 15,
  /**
   * Reject anything that isn't clearly landscape. Our formats render 16:9
   * (1.78); a 9:16 short is 0.56 and a square is 1.0. 1.2 keeps 4:3 (1.33) and
   * wider while dropping vertical/portrait/square footage that would pillarbox
   * or crop badly. "No 9:16 footage for now."
   */
  minAspectRatio: 1.2,
} as const;

export interface QualityMetrics {
  width: number;
  height: number;
  durationSeconds: number;
  fps: number | null;
}

export interface QualityEvaluation {
  accepted: boolean;
  reasons: string[];
  metrics: QualityMetrics;
}

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  duration?: string;
  nb_frames?: string;
  avg_frame_rate?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string };
}

function parseFps(avgFrameRate: string | undefined): number | null {
  if (!avgFrameRate) return null;
  const parts = avgFrameRate.split("/").map(Number);
  const num = parts[0];
  const den = parts[1];
  if (!num || !den) return null;
  return num / den;
}

function runFfprobe(localPath: string): Promise<FfprobeOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFPROBE_BIN, [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      localPath,
    ]);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr?.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("close", (code: number) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited ${code}: ${stderr.slice(0, 200)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as FfprobeOutput);
      } catch (err) {
        reject(
          new Error(`ffprobe JSON parse failed: ${(err as Error).message}`),
        );
      }
    });
    child.on("error", reject);
  });
}

/**
 * Evaluate whether a clip meets the strict Phase 1 quality bar. Returns
 * `{ accepted, reasons, metrics }` — does NOT throw on rejection. Callers
 * (gateway) decide whether to fall through to the next source.
 *
 * Throws only on ffprobe infrastructure failures.
 */
export async function evaluateClip(
  localPath: string,
): Promise<QualityEvaluation> {
  const probe = await runFfprobe(localPath);
  const videoStream = probe.streams?.find((s) => s.codec_type === "video");
  if (!videoStream) {
    return {
      accepted: false,
      reasons: ["no video stream"],
      metrics: { width: 0, height: 0, durationSeconds: 0, fps: null },
    };
  }

  const width = videoStream.width ?? 0;
  const height = videoStream.height ?? 0;
  const durationSeconds = Number(
    videoStream.duration ?? probe.format?.duration ?? "0",
  );
  const fps = parseFps(videoStream.avg_frame_rate);
  const metrics: QualityMetrics = { width, height, durationSeconds, fps };

  const reasons: string[] = [];
  if (width < QUALITY_THRESHOLDS.minWidth) {
    reasons.push(
      `resolution ${width}x${height} below minimum ${QUALITY_THRESHOLDS.minWidth}x${QUALITY_THRESHOLDS.minHeight}`,
    );
  }
  const aspectRatio = height > 0 ? width / height : 0;
  if (aspectRatio < QUALITY_THRESHOLDS.minAspectRatio) {
    reasons.push(
      `aspect ${aspectRatio.toFixed(2)} is not landscape (min ${QUALITY_THRESHOLDS.minAspectRatio}) — vertical/9:16 footage excluded`,
    );
  }
  if (durationSeconds < QUALITY_THRESHOLDS.minDurationSeconds) {
    reasons.push(
      `duration ${durationSeconds.toFixed(1)}s below minimum ${QUALITY_THRESHOLDS.minDurationSeconds}s`,
    );
  }
  if (fps !== null && fps < QUALITY_THRESHOLDS.minFps) {
    reasons.push(
      `fps ${fps.toFixed(1)} below minimum ${QUALITY_THRESHOLDS.minFps} (likely a slideshow)`,
    );
  }

  const accepted = reasons.length === 0;
  if (!accepted) {
    logger.info({ localPath, reasons, metrics }, "clip rejected");
  }
  return { accepted, reasons, metrics };
}
