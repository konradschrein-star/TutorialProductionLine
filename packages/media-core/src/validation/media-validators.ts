/**
 * Media Validation Functions
 *
 * Pure validation functions that check media probe results against
 * expected constraints. Each returns a Result type with typed
 * MediaValidationError on failure.
 *
 * Used by QMS pre-flight checks before expensive render operations.
 */

import { extname } from "node:path";
import { PipelineErrorCode, MediaValidationError } from "@repo/domain";
import type { Result } from "@repo/contracts";
import type { MediaProbeResult } from "../ffmpeg/full-probe.js";

// ── Types ─────────────────────────────────────────────────────────

export interface AssetHealthParams {
  expectedAspectRatio?: string;
  allowedFileTypes?: string[];
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  minWidth?: number;
  minHeight?: number;
}

// ── Individual Validators ─────────────────────────────────────────

export function validateAspectRatio(
  probe: MediaProbeResult,
  expected: string,
): Result<true, MediaValidationError> {
  if (!probe.video) {
    return {
      success: false,
      error: new MediaValidationError(
        PipelineErrorCode.INVALID_ASPECT_RATIO,
        "No video stream found to validate aspect ratio",
        { expected },
      ),
    };
  }

  if (probe.video.aspectRatio !== expected) {
    return {
      success: false,
      error: new MediaValidationError(
        PipelineErrorCode.INVALID_ASPECT_RATIO,
        `Aspect ratio mismatch: expected ${expected}, got ${probe.video.aspectRatio}`,
        { expected, actual: probe.video.aspectRatio },
      ),
    };
  }

  return { success: true, data: true };
}

export function validateResolution(
  probe: MediaProbeResult,
  minWidth: number,
  minHeight: number,
): Result<true, MediaValidationError> {
  if (!probe.video) {
    return {
      success: false,
      error: new MediaValidationError(
        PipelineErrorCode.INVALID_RESOLUTION,
        "No video stream found to validate resolution",
        { expected: `${minWidth}x${minHeight}` },
      ),
    };
  }

  if (probe.video.width < minWidth || probe.video.height < minHeight) {
    return {
      success: false,
      error: new MediaValidationError(
        PipelineErrorCode.INVALID_RESOLUTION,
        `Resolution ${probe.video.width}x${probe.video.height} is below minimum ${minWidth}x${minHeight}`,
        {
          expected: `${minWidth}x${minHeight}`,
          actual: `${probe.video.width}x${probe.video.height}`,
        },
      ),
    };
  }

  return { success: true, data: true };
}

export function validateFileType(
  filePath: string,
  allowedExtensions: string[],
): Result<true, MediaValidationError> {
  const ext = extname(filePath).toLowerCase();

  // Normalize allowed extensions to always have a leading dot
  const normalized = allowedExtensions.map((e) =>
    e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`,
  );

  if (!normalized.includes(ext)) {
    return {
      success: false,
      error: new MediaValidationError(
        PipelineErrorCode.INVALID_FILE_TYPE,
        `File type "${ext}" is not in allowed list: ${normalized.join(", ")}`,
        { expected: normalized.join(", "), actual: ext },
      ),
    };
  }

  return { success: true, data: true };
}

export function validateDuration(
  probe: MediaProbeResult,
  bounds: { minSeconds: number; maxSeconds: number },
): Result<true, MediaValidationError> {
  const { durationSeconds } = probe;
  const { minSeconds, maxSeconds } = bounds;

  if (durationSeconds < minSeconds) {
    return {
      success: false,
      error: new MediaValidationError(
        PipelineErrorCode.INVALID_DURATION,
        `Duration ${durationSeconds}s is below minimum ${minSeconds}s`,
        { expected: `>= ${minSeconds}s`, actual: `${durationSeconds}s` },
      ),
    };
  }

  if (durationSeconds > maxSeconds) {
    return {
      success: false,
      error: new MediaValidationError(
        PipelineErrorCode.INVALID_DURATION,
        `Duration ${durationSeconds}s exceeds maximum ${maxSeconds}s`,
        { expected: `<= ${maxSeconds}s`, actual: `${durationSeconds}s` },
      ),
    };
  }

  return { success: true, data: true };
}

// ── Composite Validator ───────────────────────────────────────────

export function validateAssetHealth(
  probe: MediaProbeResult,
  filePath: string,
  params: AssetHealthParams,
): Result<true, MediaValidationError[]> {
  const errors: MediaValidationError[] = [];

  if (params.expectedAspectRatio !== undefined) {
    const result = validateAspectRatio(probe, params.expectedAspectRatio);
    if (!result.success) errors.push(result.error);
  }

  if (params.allowedFileTypes !== undefined) {
    const result = validateFileType(filePath, params.allowedFileTypes);
    if (!result.success) errors.push(result.error);
  }

  if (params.minDurationSeconds !== undefined || params.maxDurationSeconds !== undefined) {
    const result = validateDuration(probe, {
      minSeconds: params.minDurationSeconds ?? 0,
      maxSeconds: params.maxDurationSeconds ?? Number.MAX_SAFE_INTEGER,
    });
    if (!result.success) errors.push(result.error);
  }

  if (params.minWidth !== undefined || params.minHeight !== undefined) {
    const result = validateResolution(
      probe,
      params.minWidth ?? 0,
      params.minHeight ?? 0,
    );
    if (!result.success) errors.push(result.error);
  }

  if (errors.length > 0) {
    return { success: false, error: errors };
  }

  return { success: true, data: true };
}
