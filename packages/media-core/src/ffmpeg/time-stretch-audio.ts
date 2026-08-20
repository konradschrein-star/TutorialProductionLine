import { exec } from "child_process";
import { promisify } from "util";
import { probeMediaDuration } from "./probe.js";

const execAsync = promisify(exec);

/**
 * Time Stretch Audio Result
 *
 * Metadata about the time-stretched audio output.
 */
export interface TimeStretchAudioResult {
  outputPath: string;
  originalDurationSeconds: number;
  targetDurationSeconds: number;
  speedFactor: number; // e.g., 1.2 for 20% faster, 0.8 for 20% slower
  atempoFilters: string[]; // FFmpeg atempo filter chain used
}

/**
 * Time Stretch Audio to Target Duration
 *
 * Speeds up or slows down audio to match a target duration using FFmpeg's atempo filter.
 * Handles large speed changes by chaining multiple atempo filters (each limited to 0.5x-2.0x).
 *
 * Use cases:
 * - Match voiceover duration to total video length
 * - Adjust podcast speed for different platforms
 * - Sync audio to video after editing
 *
 * **atempo Filter Limitation:**
 * - Single atempo filter: 0.5x to 2.0x only
 * - For larger changes: chain multiple filters
 * - Example: 3x speed = atempo=2.0,atempo=1.5
 *
 * @param inputPath - Path to input audio file
 * @param outputPath - Path for time-stretched output file
 * @param targetDurationSeconds - Desired duration in seconds
 * @param outputFormat - Output format (default: "wav")
 * @returns Metadata about time-stretching applied
 *
 * @example
 * ```typescript
 * // Voiceover is 120 seconds, but stitched videos total 100 seconds
 * const result = await timeStretchAudio(
 *   "/tmp/voiceover.mp3",
 *   "/tmp/voiceover-stretched.wav",
 *   100 // Target: 100 seconds
 * );
 *
 * console.log(`Speed factor: ${result.speedFactor}x`); // 1.2x (20% faster)
 * console.log(`atempo filters: ${result.atempoFilters.join(",")}`);
 * ```
 */
export async function timeStretchAudio(
  inputPath: string,
  outputPath: string,
  targetDurationSeconds: number,
  outputFormat: "wav" | "mp3" | "aac" = "wav",
): Promise<TimeStretchAudioResult> {
  // Probe input audio duration
  const originalDuration = await probeMediaDuration(inputPath);

  if (!originalDuration || originalDuration === 0) {
    throw new Error(`Could not determine duration of ${inputPath}`);
  }

  // Calculate speed factor
  const speedFactor = originalDuration / targetDurationSeconds;

  // Validate speed factor (reasonable limits)
  if (speedFactor < 0.25 || speedFactor > 4.0) {
    throw new Error(
      `Speed factor ${speedFactor.toFixed(2)}x is outside reasonable range (0.25x-4.0x). ` +
        `Original: ${originalDuration.toFixed(1)}s, Target: ${targetDurationSeconds.toFixed(1)}s`,
    );
  }

  // Build atempo filter chain
  const atempoFilters = buildAtempoFilterChain(speedFactor);

  // Build FFmpeg command
  let ffmpegCommand: string;

  if (speedFactor === 1.0 || Math.abs(speedFactor - 1.0) < 0.01) {
    // No stretching needed — just convert format
    ffmpegCommand = buildSimpleCopyCommand(inputPath, outputPath, outputFormat);
  } else {
    // Apply atempo filter chain
    ffmpegCommand = buildTimeStretchCommand(
      inputPath,
      outputPath,
      atempoFilters,
      outputFormat,
    );
  }

  // Execute time-stretching
  try {
    const { stderr } = await execAsync(ffmpegCommand);

    // Log FFmpeg output for debugging
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[timeStretchAudio] FFmpeg output:`,
        stderr.substring(0, 500),
      );
    }
  } catch (error: any) {
    throw new Error(
      `FFmpeg time-stretching failed: ${error.message}\nCommand: ${ffmpegCommand}`,
    );
  }

  // Verify output duration
  const outputDuration = await probeMediaDuration(outputPath);
  const durationError = Math.abs(outputDuration - targetDurationSeconds);

  if (durationError > 1.0) {
    // Allow 1 second tolerance
    console.warn(
      `[timeStretchAudio] Output duration ${outputDuration.toFixed(1)}s differs from target ${targetDurationSeconds.toFixed(1)}s by ${durationError.toFixed(1)}s`,
    );
  }

  return {
    outputPath,
    originalDurationSeconds: originalDuration,
    targetDurationSeconds,
    speedFactor,
    atempoFilters,
  };
}

/**
 * Build atempo Filter Chain
 *
 * Decomposes speed factor into multiple atempo filters (each limited to 0.5x-2.0x).
 *
 * Strategy:
 * - For speed > 2.0x: chain multiple 2.0x filters + final adjustment
 * - For speed < 0.5x: chain multiple 0.5x filters + final adjustment
 * - For 0.5x ≤ speed ≤ 2.0x: single filter
 *
 * @param speedFactor - Desired speed multiplier
 * @returns Array of atempo filter values
 *
 * @example
 * ```typescript
 * buildAtempoFilterChain(3.0);   // ["2.0", "1.5"]
 * buildAtempoFilterChain(0.3);   // ["0.5", "0.6"]
 * buildAtempoFilterChain(1.5);   // ["1.5"]
 * ```
 */
function buildAtempoFilterChain(speedFactor: number): string[] {
  const filters: string[] = [];
  let remaining = speedFactor;

  // atempo filter constraints: 0.5 ≤ factor ≤ 2.0
  const MIN_ATEMPO = 0.5;
  const MAX_ATEMPO = 2.0;

  if (speedFactor >= MIN_ATEMPO && speedFactor <= MAX_ATEMPO) {
    // Single filter is sufficient
    return [speedFactor.toFixed(3)];
  }

  // Decompose into multiple filters
  if (speedFactor > MAX_ATEMPO) {
    // Speed up: chain 2.0x filters until remaining < 2.0x
    while (remaining > MAX_ATEMPO) {
      filters.push(MAX_ATEMPO.toFixed(3));
      remaining /= MAX_ATEMPO;
    }
    // Add final adjustment filter
    if (remaining > 1.0) {
      filters.push(remaining.toFixed(3));
    }
  } else {
    // Slow down: chain 0.5x filters until remaining > 0.5x
    while (remaining < MIN_ATEMPO) {
      filters.push(MIN_ATEMPO.toFixed(3));
      remaining /= MIN_ATEMPO;
    }
    // Add final adjustment filter
    if (remaining < 1.0) {
      filters.push(remaining.toFixed(3));
    }
  }

  return filters;
}

/**
 * Build FFmpeg Time-Stretch Command
 *
 * Constructs FFmpeg command with atempo filter chain.
 */
function buildTimeStretchCommand(
  inputPath: string,
  outputPath: string,
  atempoFilters: string[],
  outputFormat: string,
): string {
  const atempoChain = atempoFilters.map((f) => `atempo=${f}`).join(",");

  const codecArgs =
    outputFormat === "wav"
      ? "-acodec pcm_s16le -ar 16000 -ac 1"
      : outputFormat === "mp3"
        ? "-acodec libmp3lame -b:a 192k"
        : "-acodec aac -b:a 192k";

  return [
    "ffmpeg",
    "-i",
    `"${inputPath.replace(/\\/g, "/")}"`,
    "-af",
    `"${atempoChain}"`,
    ...codecArgs.split(" "),
    "-y", // Overwrite output file
    `"${outputPath.replace(/\\/g, "/")}"`,
  ].join(" ");
}

/**
 * Build FFmpeg Simple Copy Command
 *
 * Used when no time-stretching is needed (speed factor ≈ 1.0).
 */
function buildSimpleCopyCommand(
  inputPath: string,
  outputPath: string,
  outputFormat: string,
): string {
  const codecArgs =
    outputFormat === "wav"
      ? "-acodec pcm_s16le -ar 16000 -ac 1"
      : outputFormat === "mp3"
        ? "-acodec libmp3lame -b:a 192k"
        : "-acodec aac -b:a 192k";

  return [
    "ffmpeg",
    "-i",
    `"${inputPath.replace(/\\/g, "/")}"`,
    ...codecArgs.split(" "),
    "-y",
    `"${outputPath.replace(/\\/g, "/")}"`,
  ].join(" ");
}
