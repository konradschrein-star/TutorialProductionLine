/**
 * Audio Loudness Analysis - LUFS Measurement and YouTube Compliance
 *
 * Uses FFmpeg's ebur128 filter for integrated loudness (LUFS) measurement and
 * true peak detection. Validates against YouTube Recommended Audio Loudness:
 * - Target: -14 LUFS Integrated Loudness
 * - Acceptable range: -16 to -13 LUFS
 * - True Peak: ≤ -1.0 dBFS
 *
 * Reference: https://support.google.com/youtube/answer/1119474
 */

import { execa as defaultExeca } from "execa";

// Type for dependency injection
export type ExecFn = typeof defaultExeca;

/**
 * Analysis timeout in milliseconds (2 minutes for FFmpeg processing)
 */
const ANALYSIS_TIMEOUT_MS = 120_000;

/**
 * YouTube recommended audio loudness thresholds
 * Reference: https://support.google.com/youtube/answer/1119474
 */
const YOUTUBE_LUFS_MIN = -16; // Minimum acceptable integrated loudness
const YOUTUBE_LUFS_MAX = -13; // Maximum acceptable integrated loudness
const YOUTUBE_PEAK_MAX = -1.0; // Maximum true peak threshold (dBFS)

/**
 * Result of loudness measurement
 */
export interface LoudnessMeasurement {
  integrated_lufs: number; // In LUFS
  true_peak_dbfs: number; // In dBFS
  loudness_range_lu: number; // In LU
}

/**
 * Result of loudness validation
 */
export interface LoudnessValidationResult {
  passed: boolean;
  integrated_lufs_ok: boolean;
  true_peak_ok: boolean;
  warnings: string[];
}

/**
 * Measure audio loudness using FFmpeg ebur128 filter.
 *
 * Runs FFmpeg with ebur128 filter to analyze integrated loudness and true peak.
 * Parses the FFmpeg output to extract LUFS, dBFS, and LU (loudness range) values.
 *
 * @param videoPath - Absolute path to video file
 * @param execFn - Optional function for dependency injection (defaults to execa)
 * @returns Loudness measurement with integrated LUFS, true peak dBFS, and loudness range LU
 * @throws Error if LUFS/peak measurements not found or FFmpeg fails
 */
export async function measureLoudness(
  videoPath: string,
  execFn: ExecFn = defaultExeca,
): Promise<LoudnessMeasurement> {
  const ffmpegBin = process.env.FFMPEG_PATH ?? "ffmpeg";

  const result = await execFn(
    ffmpegBin,
    ["-i", videoPath, "-af", "ebur128=video=1", "-f", "null", "-"],
    {
      timeout: ANALYSIS_TIMEOUT_MS,
      reject: false, // Don't throw on FFmpeg non-zero exit (it writes analysis to stderr)
    },
  );

  const output = result.stderr;

  // Parse integrated loudness from: [ebur128 @ ...] Integrated loudness: -14.5 LUFS
  const lufsMatch = output.match(/Integrated loudness:\s*([-\d.]+)\s+LUFS/);
  if (!lufsMatch) {
    throw new Error(
      `LUFS loudness measurement not found in FFmpeg output for: ${videoPath}`,
    );
  }
  const integrated_lufs = parseFloat(lufsMatch[1]);

  // Parse true peak from: [ebur128 @ ...] True peak: -1.0 dBFS
  const peakMatch = output.match(/True peak:\s*([-\d.]+)\s+dBFS/);
  if (!peakMatch) {
    throw new Error(
      `True peak measurement not found in FFmpeg output for: ${videoPath}`,
    );
  }
  const true_peak_dbfs = parseFloat(peakMatch[1]);

  // Parse loudness range from: [ebur128 @ ...] Loudness range: X.X LU
  const lraMatch = output.match(/Loudness range:\s*([-\d.]+)\s+LU/);
  if (!lraMatch) {
    throw new Error(
      `Loudness range measurement not found in FFmpeg output for: ${videoPath}`,
    );
  }
  const loudness_range_lu = parseFloat(lraMatch[1]);

  return {
    integrated_lufs,
    true_peak_dbfs,
    loudness_range_lu,
  };
}

/**
 * Validate loudness against YouTube standards.
 *
 * YouTube recommends:
 * - Integrated loudness: -16 to -13 LUFS (target -14 LUFS)
 * - True peak: ≤ -1.0 dBFS
 *
 * @param measurement - Loudness measurement result
 * @returns Validation result with passed flag and compliance details
 */
export function validateLoudness(
  measurement: LoudnessMeasurement,
): LoudnessValidationResult {
  const warnings: string[] = [];

  const { integrated_lufs, true_peak_dbfs } = measurement;

  // Check integrated loudness range
  let integrated_lufs_ok = true;
  if (integrated_lufs < YOUTUBE_LUFS_MIN) {
    integrated_lufs_ok = false;
    warnings.push(
      `Integrated loudness too low: ${integrated_lufs} LUFS (below acceptable range of ${YOUTUBE_LUFS_MIN} to ${YOUTUBE_LUFS_MAX} LUFS)`,
    );
  } else if (integrated_lufs > YOUTUBE_LUFS_MAX) {
    integrated_lufs_ok = false;
    warnings.push(
      `Integrated loudness too high: ${integrated_lufs} LUFS (above acceptable range of ${YOUTUBE_LUFS_MIN} to ${YOUTUBE_LUFS_MAX} LUFS)`,
    );
  }

  // Check true peak threshold
  let true_peak_ok = true;
  if (true_peak_dbfs > YOUTUBE_PEAK_MAX) {
    true_peak_ok = false;
    warnings.push(
      `True peak exceeds threshold: ${true_peak_dbfs} dBFS (must be ≤ ${YOUTUBE_PEAK_MAX} dBFS)`,
    );
  }

  return {
    passed: integrated_lufs_ok && true_peak_ok,
    integrated_lufs_ok,
    true_peak_ok,
    warnings,
  };
}
