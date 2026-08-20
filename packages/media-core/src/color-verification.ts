/**
 * Color-Based Cut Verification
 *
 * Verifies that rendered video has correct images at correct cut points
 * by comparing average colors of source images to extracted video frames.
 *
 * Problem: Images may be in wrong order or cuts placed incorrectly during
 * rendering, causing visual discontinuity.
 *
 * Solution: Extract frames at cut points, compare colors to expected source
 * images. Large color distance indicates mismatch.
 */

import { execa } from "execa";
import { join } from "node:path";

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface ColorMatch {
  frameTime: number; // Time in video (seconds)
  frameColor: RGB; // Extracted frame average color
  expectedColor: RGB; // Expected source image color
  distance: number; // Euclidean distance between colors
  matched: boolean; // True if distance < threshold (default: 50)
}

/**
 * Extract average RGB color from an image file using FFmpeg.
 *
 * Uses FFmpeg's signalstats filter to compute mean color values.
 *
 * @param imagePath Absolute path to image (PNG, JPG, etc.)
 * @returns Average RGB color across all pixels
 * @throws Error if FFmpeg fails
 */
export async function getAverageColor(imagePath: string): Promise<RGB> {
  try {
    // Use FFmpeg to extract color stats
    // signalstats filter outputs YMIN, YMAX, YAVG, etc.
    // We'll use a different approach: scale to 1x1 pixel and extract that color
    const result = await execa(
      "ffmpeg",
      [
        "-i",
        imagePath,
        "-vf",
        "scale=1:1", // Scale to 1x1 pixel (average color)
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24", // RGB 3 bytes
        "-",
      ],
      {
        timeout: 5000,
        encoding: "buffer",
        reject: false,
      },
    );

    if (result.exitCode !== 0) {
      throw new Error(`FFmpeg failed: ${result.stderr}`);
    }

    // Extract RGB from 3-byte buffer
    const pixels = result.stdout;
    if (pixels.length < 3) {
      throw new Error("No pixel data returned");
    }

    return {
      r: pixels[0],
      g: pixels[1],
      b: pixels[2],
    };
  } catch (error) {
    throw new Error(
      `Failed to extract color from ${imagePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Calculate Euclidean distance between two RGB colors.
 *
 * @param c1 First color
 * @param c2 Second color
 * @returns Distance (0 = identical, higher = more different)
 */
export function colorDistance(c1: RGB, c2: RGB): number {
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;

  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Extract a single frame from a video at a specific timestamp.
 *
 * @param videoPath Path to video file
 * @param timestamp Time in seconds to extract frame
 * @param outputPath Where to save extracted frame
 * @throws Error if FFmpeg fails
 */
export async function extractFrameAtTime(
  videoPath: string,
  timestamp: number,
  outputPath: string,
): Promise<void> {
  try {
    await execa("ffmpeg", [
      "-ss",
      timestamp.toFixed(3), // Seek to timestamp
      "-i",
      videoPath,
      "-vframes",
      "1", // Extract 1 frame
      "-q:v",
      "2", // High quality
      "-y", // Overwrite output
      outputPath,
    ]);
  } catch (error) {
    throw new Error(
      `Failed to extract frame at ${timestamp}s: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Verify that video has correct images at cut points by comparing colors.
 *
 * @param videoPath Path to rendered video
 * @param expectedImages Array of { time: number, imagePath: string }
 *                       where time is the expected cut point in seconds
 * @param tempDir Directory for temporary frame extractions
 * @param threshold Color distance threshold for match (default: 50)
 * @returns Array of ColorMatch results for each cut point
 */
export async function verifyCutColors(
  videoPath: string,
  expectedImages: Array<{ time: number; imagePath: string }>,
  tempDir: string,
  threshold: number = 50,
): Promise<ColorMatch[]> {
  const results: ColorMatch[] = [];

  console.log(
    `[Color Verification] Checking ${expectedImages.length} cut points`,
  );

  for (const { time, imagePath } of expectedImages) {
    // Extract frame from video at cut point
    const framePath = join(tempDir, `frame-${time.toFixed(2)}.png`);
    await extractFrameAtTime(videoPath, time, framePath);

    // Get colors
    const frameColor = await getAverageColor(framePath);
    const expectedColor = await getAverageColor(imagePath);

    // Calculate distance
    const distance = colorDistance(frameColor, expectedColor);
    const matched = distance < threshold;

    results.push({
      frameTime: time,
      frameColor,
      expectedColor,
      distance,
      matched,
    });

    const status = matched ? "✓" : "✗";
    console.log(
      `[Color Verification] ${status} t=${time.toFixed(2)}s: distance=${distance.toFixed(1)} (frame:RGB(${frameColor.r},${frameColor.g},${frameColor.b}) vs expected:RGB(${expectedColor.r},${expectedColor.g},${expectedColor.b}))`,
    );
  }

  const matchCount = results.filter((r) => r.matched).length;
  const matchRate = (matchCount / results.length) * 100;

  console.log(
    `[Color Verification] ${matchCount}/${results.length} cuts matched (${matchRate.toFixed(1)}%)`,
  );

  return results;
}

/**
 * Verify cut timing by checking color consistency across a time range.
 *
 * This extracts multiple frames around a cut point to ensure the image
 * doesn't change unexpectedly (indicating a timing error).
 *
 * @param videoPath Path to rendered video
 * @param cutTime Time of the cut point (seconds)
 * @param expectedImagePath Path to expected source image
 * @param tempDir Directory for temporary frames
 * @param sampleWindow Time window to sample around cut (default: 0.5s)
 * @param sampleInterval Time between samples (default: 0.1s)
 * @returns True if all samples match expected image
 */
export async function verifyCutTimingConsistency(
  videoPath: string,
  cutTime: number,
  expectedImagePath: string,
  tempDir: string,
  sampleWindow: number = 0.5,
  sampleInterval: number = 0.1,
): Promise<boolean> {
  const expectedColor = await getAverageColor(expectedImagePath);
  const startTime = Math.max(0, cutTime - sampleWindow / 2);
  const endTime = cutTime + sampleWindow / 2;

  const samples: Array<{ time: number; matched: boolean }> = [];

  for (
    let t = startTime;
    t <= endTime;
    t = Math.round((t + sampleInterval) * 100) / 100
  ) {
    const framePath = join(tempDir, `consistency-${t.toFixed(2)}.png`);
    await extractFrameAtTime(videoPath, t, framePath);

    const frameColor = await getAverageColor(framePath);
    const distance = colorDistance(frameColor, expectedColor);
    const matched = distance < 50;

    samples.push({ time: t, matched });

    const status = matched ? "✓" : "✗";
    console.log(
      `[Consistency Check] ${status} t=${t.toFixed(2)}s: distance=${distance.toFixed(1)}`,
    );
  }

  const allMatched = samples.every((s) => s.matched);
  const matchRate =
    (samples.filter((s) => s.matched).length / samples.length) * 100;

  console.log(
    `[Consistency Check] Cut at ${cutTime.toFixed(2)}s: ${matchRate.toFixed(1)}% consistent`,
  );

  return allMatched;
}
