import { spawn } from "node:child_process";
import { probeMediaDimensions } from "./probe.js";

const WQHD_WIDTH = 2560;
const WQHD_HEIGHT = 1440;

/**
 * Apply GIST wash (Gaussian noise + crop jitter) and, if the input is below
 * WQHD resolution, upscale to 2560×1440 — all in a single FFmpeg pass.
 *
 * If the input is already ≥ 2560×1440, the scale step is skipped and only
 * the GIST fingerprint filters are applied. This avoids a pointless re-encode
 * of footage that HeyGen (or another source) already delivered at 2K+.
 *
 * Replaces the previous two-step applyGistWash → upscaleTo1440p pattern.
 *
 * @param inputPath  - Input video path (intermediate Remotion/FFmpeg output)
 * @param outputPath - Output video path (final pre-metadata file)
 */
export async function applyGistWashAndUpscale(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  const { width, height } = await probeMediaDimensions(inputPath);
  const alreadyWQHD = width >= WQHD_WIDTH && height >= WQHD_HEIGHT;

  if (alreadyWQHD) {
    console.log(
      `[post-process] Input is already ${width}×${height} (≥ WQHD) — skipping upscale, applying GIST wash only`,
    );
    await _applyGistOnly(inputPath, outputPath);
  } else {
    console.log(
      `[post-process] Input is ${width}×${height} — upscaling to 2560×1440 and applying GIST wash`,
    );
    await _applyGistAndUpscale(inputPath, outputPath);
  }
}

// ─── internal helpers ────────────────────────────────────────────────────────

function _applyGistOnly(inputPath: string, outputPath: string): Promise<void> {
  return _runFFmpeg(inputPath, outputPath, {
    videoFilter: "noise=alls=5:allf=t+u,crop=iw-2:ih-2:1:1",
    encodeArgs: [
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "18",
      "-maxrate",
      "25M",
      "-bufsize",
      "50M",
    ],
  });
}

function _applyGistAndUpscale(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  return _runFFmpeg(inputPath, outputPath, {
    // Scale first, then noise+crop. Crop removes 2px total (1 each side) after
    // the scale, producing 2558×1438 — sufficient anti-fingerprint jitter.
    videoFilter: "scale=2560:1440,noise=alls=5:allf=t+u,crop=2558:1438:1:1",
    // CRF 18 for quality-controlled 1440p — avoids CBR bitrate starvation on
    // complex scenes. Maxrate cap prevents runaway file sizes.
    encodeArgs: [
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "18",
      "-maxrate",
      "30M",
      "-bufsize",
      "60M",
    ],
  });
}

interface FFmpegRunOptions {
  videoFilter: string;
  encodeArgs: string[];
}

function _runFFmpeg(
  inputPath: string,
  outputPath: string,
  { videoFilter, encodeArgs }: FFmpegRunOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegBin = process.env["FFMPEG_PATH"] ?? "ffmpeg";

    const args = [
      "-i",
      inputPath,
      "-vf",
      videoFilter,
      ...encodeArgs,
      "-preset",
      "medium",
      "-c:a",
      "copy",
      "-y",
      outputPath,
    ];

    const ffmpeg = spawn(ffmpegBin, args);

    let stderr = "";
    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `[post-process] FFmpeg exited ${code}: ${stderr.slice(-800)}`,
          ),
        );
        return;
      }
      console.log(`[post-process] Complete: ${outputPath}`);
      resolve();
    });
  });
}
