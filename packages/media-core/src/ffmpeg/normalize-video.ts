import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { probeMedia } from "./full-probe.js";

const execAsync = promisify(exec);

/**
 * Video Normalization Configuration
 *
 * Target specifications for normalized videos.
 * All input videos will be converted to these specs before stitching.
 */
export interface NormalizeVideoConfig {
  targetWidth: number; // e.g., 1920
  targetHeight: number; // e.g., 1080
  targetFps: number; // e.g., 30
  targetCodec?: string; // e.g., "libx264" (defaults to libx264)
  targetAudioCodec?: string; // e.g., "aac" (defaults to aac)
  targetAudioBitrate?: string; // e.g., "192k" (defaults to 192k)
  pixelFormat?: string; // e.g., "yuv420p" (defaults to yuv420p)
  preset?: string; // e.g., "fast", "medium", "slow" (defaults to "fast")
}

/**
 * Normalized Video Result
 *
 * Metadata about the normalized video output.
 */
export interface NormalizeVideoResult {
  outputPath: string;
  originalWidth: number;
  originalHeight: number;
  originalFps: number;
  targetWidth: number;
  targetHeight: number;
  targetFps: number;
  wasScaled: boolean;
  wasFpsConverted: boolean;
  wasLetterboxed: boolean; // Black bars top/bottom
  wasPillarboxed: boolean; // Black bars left/right
  durationSeconds: number;
}

/**
 * Normalize Video to Target Specifications
 *
 * Converts input video to consistent resolution, FPS, and codec.
 * Handles different aspect ratios with letterboxing/pillarboxing.
 *
 * Pipeline:
 * 1. Probe input video for current specs
 * 2. Calculate scaling with aspect ratio preservation
 * 3. Apply letterbox/pillarbox if needed
 * 4. Convert FPS if needed
 * 5. Re-encode to target codec
 *
 * @param inputPath - Path to input video file
 * @param outputPath - Path for normalized output file
 * @param config - Target normalization specs
 * @returns Metadata about normalization applied
 *
 * @example
 * ```typescript
 * const result = await normalizeVideo(
 *   "/path/to/input.mp4",
 *   "/path/to/normalized.mp4",
 *   { targetWidth: 1920, targetHeight: 1080, targetFps: 30 }
 * );
 *
 * console.log(`Scaled: ${result.wasScaled}`);
 * console.log(`FPS converted: ${result.wasFpsConverted}`);
 * console.log(`Letterboxed: ${result.wasLetterboxed}`);
 * ```
 */
export async function normalizeVideo(
  inputPath: string,
  outputPath: string,
  config: NormalizeVideoConfig,
): Promise<NormalizeVideoResult> {
  // Probe input video
  const probe = await probeMedia(inputPath);

  if (!probe.video) {
    throw new Error(`No video stream found in ${inputPath}`);
  }

  const {
    width: originalWidth,
    height: originalHeight,
    fps: originalFps,
  } = probe.video;

  // Defaults
  const targetCodec = config.targetCodec || "libx264";
  const targetAudioCodec = config.targetAudioCodec || "aac";
  const targetAudioBitrate = config.targetAudioBitrate || "192k";
  const pixelFormat = config.pixelFormat || "yuv420p";
  const preset = config.preset || "fast";

  // Calculate scaling with aspect ratio preservation
  const inputAspectRatio = originalWidth / originalHeight;
  const targetAspectRatio = config.targetWidth / config.targetHeight;

  let scaleWidth: number;
  let scaleHeight: number;
  let padWidth = 0;
  let padHeight = 0;
  let wasLetterboxed = false;
  let wasPillarboxed = false;

  if (Math.abs(inputAspectRatio - targetAspectRatio) < 0.01) {
    // Same aspect ratio — simple scale
    scaleWidth = config.targetWidth;
    scaleHeight = config.targetHeight;
  } else if (inputAspectRatio > targetAspectRatio) {
    // Input is wider — pillarbox (black bars left/right)
    scaleWidth = config.targetWidth;
    scaleHeight = Math.round(config.targetWidth / inputAspectRatio);
    padHeight = config.targetHeight - scaleHeight;
    wasPillarboxed = true;
  } else {
    // Input is taller — letterbox (black bars top/bottom)
    scaleHeight = config.targetHeight;
    scaleWidth = Math.round(config.targetHeight * inputAspectRatio);
    padWidth = config.targetWidth - scaleWidth;
    wasLetterboxed = true;
  }

  // Build FFmpeg filter complex
  const filters: string[] = [];

  // 1. Scale to fit within target dimensions (preserving aspect ratio)
  filters.push(`scale=${scaleWidth}:${scaleHeight}`);

  // 2. Pad to exact target dimensions if needed
  if (padWidth > 0 || padHeight > 0) {
    const padX = Math.floor(padWidth / 2);
    const padY = Math.floor(padHeight / 2);
    filters.push(
      `pad=${config.targetWidth}:${config.targetHeight}:${padX}:${padY}:black`,
    );
  }

  // 3. Set SAR (Sample Aspect Ratio) to 1:1
  filters.push("setsar=1");

  // 4. Convert FPS if needed
  const wasFpsConverted = Math.abs(originalFps - config.targetFps) > 0.1;
  if (wasFpsConverted) {
    filters.push(`fps=${config.targetFps}`);
  }

  // 5. Set pixel format
  filters.push(`format=${pixelFormat}`);

  const filterComplex = filters.join(",");

  // Build FFmpeg command
  const ffmpegCommand = [
    "ffmpeg",
    "-i",
    `"${inputPath.replace(/\\/g, "/")}"`,
    "-vf",
    `"${filterComplex}"`,
    "-c:v",
    targetCodec,
    "-preset",
    preset,
    "-c:a",
    targetAudioCodec,
    "-b:a",
    targetAudioBitrate,
    "-y", // Overwrite output file
    `"${outputPath.replace(/\\/g, "/")}"`,
  ].join(" ");

  // Execute normalization
  try {
    const { stderr } = await execAsync(ffmpegCommand);

    // Log FFmpeg output for debugging
    if (process.env.NODE_ENV !== "production") {
      console.log(`[normalizeVideo] FFmpeg output:`, stderr.substring(0, 500));
    }
  } catch (error: any) {
    throw new Error(
      `FFmpeg normalization failed: ${error.message}\nCommand: ${ffmpegCommand}`,
    );
  }

  // Return normalization result
  return {
    outputPath,
    originalWidth,
    originalHeight,
    originalFps,
    targetWidth: config.targetWidth,
    targetHeight: config.targetHeight,
    targetFps: config.targetFps,
    wasScaled:
      originalWidth !== config.targetWidth ||
      originalHeight !== config.targetHeight,
    wasFpsConverted,
    wasLetterboxed,
    wasPillarboxed,
    durationSeconds: probe.durationSeconds,
  };
}

/**
 * Batch Normalize Multiple Videos
 *
 * Normalizes multiple videos to the same target specifications in parallel.
 * Useful for preparing videos before stitching.
 *
 * @param inputs - Array of { inputPath, outputPath } pairs
 * @param config - Target normalization specs
 * @param maxConcurrency - Maximum parallel normalizations (default: 2)
 * @returns Array of normalization results
 *
 * @example
 * ```typescript
 * const results = await batchNormalizeVideos(
 *   [
 *     { inputPath: "/tmp/video1.mp4", outputPath: "/tmp/norm1.mp4" },
 *     { inputPath: "/tmp/video2.mp4", outputPath: "/tmp/norm2.mp4" },
 *   ],
 *   { targetWidth: 1920, targetHeight: 1080, targetFps: 30 }
 * );
 * ```
 */
export async function batchNormalizeVideos(
  inputs: Array<{ inputPath: string; outputPath: string }>,
  config: NormalizeVideoConfig,
  maxConcurrency = 2,
): Promise<NormalizeVideoResult[]> {
  const results: NormalizeVideoResult[] = [];

  // Process in batches to avoid overwhelming the system
  for (let i = 0; i < inputs.length; i += maxConcurrency) {
    const batch = inputs.slice(i, i + maxConcurrency);
    const batchResults = await Promise.all(
      batch.map(({ inputPath, outputPath }) =>
        normalizeVideo(inputPath, outputPath, config),
      ),
    );
    results.push(...batchResults);
  }

  return results;
}
