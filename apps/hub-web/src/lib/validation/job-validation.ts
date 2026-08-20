import { getAssetConfig } from "@/lib/asset-type-registry";
import type { DropZoneAsset } from "@/components/job-creation/drop-zone-card";

/**
 * Job Validation Utilities
 *
 * Validates staged jobs against format requirements before dispatch.
 * Checks asset presence, file types, sizes, and other requirements.
 */

export interface ValidationResult {
  status: "valid" | "warning" | "error";
  messages: string[];
}

export interface JobValidationInput {
  format: string;
  assets: Map<string, DropZoneAsset[]>;
  topic: string;
  channel_id: string;
  // Database asset references
  character_ids?: string[];
  environment_id?: string | null;
  knowledge_refs?: string[];
}

/**
 * Validate a staged job against format requirements.
 *
 * Checks:
 * - Required assets are present
 * - File types match zone accept lists
 * - File sizes within limits
 * - Minimum asset counts met
 */
export function validateStagedJob(input: JobValidationInput): ValidationResult {
  const {
    format,
    assets,
    topic,
    channel_id,
    character_ids,
    environment_id,
    knowledge_refs,
  } = input;
  const messages: string[] = [];
  let hasErrors = false;
  let hasWarnings = false;

  // Get format configuration
  const config = getAssetConfig(format);

  // Check basic requirements
  if (!topic || topic.trim().length === 0) {
    messages.push("Topic is required");
    hasErrors = true;
  }

  if (!channel_id) {
    messages.push("Channel is required");
    hasErrors = true;
  }

  // Validate database asset requirements for specific formats
  if (format === "CASUALLY_EXPLAINED") {
    if (!character_ids || character_ids.length === 0) {
      messages.push(
        "At least one character is required for illustration formats",
      );
      hasErrors = true;
    }
  }

  // Validate each required zone
  for (const zone of config.zones) {
    const zoneAssets = assets.get(zone.id) ?? [];

    // Check required zones
    if (zone.required && zoneAssets.length === 0) {
      messages.push(`Missing required asset: ${zone.label}`);
      hasErrors = true;
      continue;
    }

    // Check max files
    if (zone.maxFiles !== null && zoneAssets.length > zone.maxFiles) {
      messages.push(
        `${zone.label}: Maximum ${zone.maxFiles} file${zone.maxFiles > 1 ? "s" : ""} allowed (${zoneAssets.length} provided)`,
      );
      hasWarnings = true;
    }

    // Validate file types and sizes
    for (const asset of zoneAssets) {
      const file = asset.file;
      const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();

      // Check file type
      if (!zone.accept.includes(ext)) {
        messages.push(
          `${zone.label}: Invalid file type "${ext}" for ${file.name}. Expected: ${zone.accept.join(", ")}`,
        );
        hasErrors = true;
      }

      // Check file size
      const maxSize = zone.maxSize ?? Infinity;
      if (file.size > maxSize) {
        const maxMB = (maxSize / (1024 * 1024)).toFixed(1);
        const actualMB = (file.size / (1024 * 1024)).toFixed(1);
        messages.push(
          `${zone.label}: ${file.name} is too large (${actualMB}MB). Maximum: ${maxMB}MB`,
        );
        hasErrors = true;
      }
    }
  }

  // Determine final status
  if (hasErrors) {
    return { status: "error", messages };
  } else if (hasWarnings) {
    return { status: "warning", messages };
  } else {
    return { status: "valid", messages: [] };
  }
}

/**
 * Batch validate multiple jobs.
 * Returns a map of job ID to validation result.
 */
export function validateStagedJobs(
  jobs: Array<JobValidationInput & { id: string }>,
  format: string,
): Map<string, ValidationResult> {
  const results = new Map<string, ValidationResult>();

  for (const job of jobs) {
    const result = validateStagedJob({ ...job, format });
    results.set(job.id, result);
  }

  return results;
}

/**
 * Calculate asset completion progress for a job.
 * Returns number of required assets provided vs total required.
 */
export function calculateAssetProgress(input: JobValidationInput): {
  provided: number;
  total: number;
  percentage: number;
  isComplete: boolean;
} {
  const { format, assets, character_ids } = input;
  const config = getAssetConfig(format);

  // Count required zones
  const requiredZones = config.zones.filter((z) => z.required);
  let providedCount = 0;
  let totalRequired = requiredZones.length;

  // Check file asset zones
  for (const zone of requiredZones) {
    const zoneAssets = assets.get(zone.id) ?? [];
    if (zoneAssets.length > 0) {
      providedCount++;
    }
  }

  // Add database asset requirements
  if (format === "CASUALLY_EXPLAINED") {
    totalRequired += 1; // Character required
    if (character_ids && character_ids.length > 0) {
      providedCount += 1;
    }
  }

  const percentage =
    totalRequired > 0 ? Math.round((providedCount / totalRequired) * 100) : 100;
  const isComplete = providedCount === totalRequired;

  return {
    provided: providedCount,
    total: totalRequired,
    percentage,
    isComplete,
  };
}
