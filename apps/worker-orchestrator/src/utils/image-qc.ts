/**
 * Auto Image QC
 *
 * Evaluates scene images from the r2_asset_manifest using file-size heuristics.
 * Runs after all automated image generation completes and before the pipeline
 * decides whether to pause for human review (AWAITING_IMAGE_QC) or proceed.
 *
 * Detection approach:
 * - AI-generated images (PNG/WebP, 1K–2K resolution) are typically 80–2000 KB.
 * - Blank images (all-white, all-black, solid color) compress to < 20 KB in PNG.
 * - Zero-byte or truncated uploads indicate a hard generation failure.
 * - Size check covers the most common failure mode: silent blank-image returns
 *   from the AI generation API without throwing an error.
 *
 * Outputs:
 * - passedCount / failedCount / total
 * - failedKeys: R2 keys of suspicious images (for operator review notes)
 * - autoApproved: true if failedCount/total is within the tolerance threshold
 */

export interface ImageQcEntry {
  key: string;
  size_bytes: number;
}

export interface ImageQcResult {
  total: number;
  passedCount: number;
  failedCount: number;
  /** R2 keys of images that failed the size check */
  failedKeys: string[];
  /**
   * True when the failure rate is within the configured tolerance —
   * the caller can skip AWAITING_IMAGE_QC and proceed directly to QMS.
   */
  autoApproved: boolean;
}

export interface ImageQcConfig {
  /**
   * Minimum file size in bytes for an image to be considered valid.
   * Default: 50_000 (50 KB) — well above blank PNG artifacts, well below any
   * real AI-generated image at 1K+ resolution.
   */
  minSizeBytes?: number;
  /**
   * Maximum percentage of total images that may fail the size check
   * before auto-approval is denied and human review is required.
   * Default: 5 (5%).
   */
  tolerancePct?: number;
}

const DEFAULT_MIN_SIZE_BYTES = 50_000;  // 50 KB
const DEFAULT_TOLERANCE_PCT  = 5;       // 5%

/**
 * Run automated image quality checks against a list of r2_asset_manifest entries.
 *
 * @param images  Array of { key, size_bytes } entries from r2_asset_manifest
 *                where type === "image/broll".
 * @param config  Optional thresholds (uses defaults if omitted).
 * @returns       QC result including per-image breakdown and auto-approval decision.
 */
export function runAutoImageQc(
  images: ImageQcEntry[],
  config: ImageQcConfig = {},
): ImageQcResult {
  const minSizeBytes = config.minSizeBytes ?? DEFAULT_MIN_SIZE_BYTES;
  const tolerancePct = config.tolerancePct ?? DEFAULT_TOLERANCE_PCT;

  if (images.length === 0) {
    return {
      total: 0,
      passedCount: 0,
      failedCount: 0,
      failedKeys: [],
      autoApproved: true, // Nothing to check → no blocker
    };
  }

  const failedKeys: string[] = [];

  for (const img of images) {
    if (img.size_bytes < minSizeBytes) {
      failedKeys.push(img.key);
    }
  }

  const failedCount  = failedKeys.length;
  const passedCount  = images.length - failedCount;
  const failureRate  = (failedCount / images.length) * 100;
  const autoApproved = failureRate <= tolerancePct;

  return {
    total: images.length,
    passedCount,
    failedCount,
    failedKeys,
    autoApproved,
  };
}
