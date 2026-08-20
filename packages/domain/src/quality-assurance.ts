/**
 * Quality Assurance System
 *
 * Comprehensive QA tools to prevent slop and ensure high-quality content production.
 * Includes pre-flight checks, API call monitoring, and output verification.
 */

import type { ReferenceSlot } from "./asset-resolution.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QACheckResult {
  passed: boolean;
  score: number; // 0-100
  failures: string[];
  warnings: string[];
  metadata?: Record<string, unknown>;
}

export interface APICallAuditLog {
  timestamp: string;
  job_id: string;
  scene_index?: number;
  img_index?: number;
  generation_type: string;
  model_id: string;
  prompt_length: number;
  reference_images_sent: {
    slot: ReferenceSlot | string;
    asset_id?: string;
    size_bytes: number;
    format: "PNG" | "JPEG" | "unknown";
  }[];
  prompt_has_style_instructions: boolean;
  prompt_snippet: string; // First 200 chars for debugging
}

// ---------------------------------------------------------------------------
// Pre-flight Checks (Anti-Slop Prevention)
// ---------------------------------------------------------------------------

/**
 * Check prompt quality before sending to AI generation.
 * Prevents generic, bland, or low-effort prompts from being processed.
 */
export function checkPromptQuality(prompt: string): QACheckResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  let score = 100;

  // Strip @imgN references and style instructions for content analysis
  const contentPrompt = prompt
    .replace(/@img\d+/g, "")
    .replace(/REFERENCE STYLE TARGET:.*?(?=\s{2,}|$)/gs, "")
    .replace(/Match the character.*?(?=\s{2,}|$)/gs, "")
    .replace(/IMPORTANT:.*?(?=\s{2,}|$)/gs, "")
    .trim();

  // Check minimum length (after stripping references/instructions)
  if (contentPrompt.length < 20) {
    failures.push("Prompt too short (< 20 chars after stripping references)");
    score -= 30;
  } else if (contentPrompt.length < 50) {
    warnings.push("Prompt is quite short (< 50 chars)");
    score -= 10;
  }

  // Check for generic/vague terms (slop indicators)
  const slopTerms = [
    /\b(something|anything|stuff|things|various)\b/gi,
    /\b(generic|basic|simple|plain)\b/gi,
    /\b(nice|good|bad|okay)\b/gi,
    /\b(image|picture|photo|scene)\s*(of|showing|with)?\b/gi,
  ];

  let slopCount = 0;
  for (const pattern of slopTerms) {
    const matches = contentPrompt.match(pattern);
    if (matches) {
      slopCount += matches.length;
    }
  }

  if (slopCount >= 3) {
    failures.push(
      `Prompt contains ${slopCount} generic/vague terms (slop indicators)`,
    );
    score -= 25;
  } else if (slopCount >= 1) {
    warnings.push(`Prompt contains ${slopCount} generic term(s)`);
    score -= 5 * slopCount;
  }

  // Check for specific visual details (quality indicators)
  const detailIndicators = [
    /\b(color|hue|shade|tint|palette)\b/gi,
    /\b(line|stroke|outline|contour)\b/gi,
    /\b(light|shadow|highlight|shade)\b/gi,
    /\b(texture|pattern|grain)\b/gi,
    /\b(angle|perspective|viewpoint|composition)\b/gi,
    /\b(expression|gesture|pose|stance)\b/gi,
  ];

  let detailCount = 0;
  for (const pattern of detailIndicators) {
    if (pattern.test(contentPrompt)) {
      detailCount++;
    }
  }

  if (detailCount === 0) {
    warnings.push(
      "Prompt lacks specific visual details (color, composition, etc.)",
    );
    score -= 10;
  }

  // Check for action/context (not just static description)
  const hasAction =
    /\b(walking|running|sitting|standing|holding|looking|pointing|moving)\b/gi.test(
      contentPrompt,
    );
  const hasContext =
    /\b(in front of|behind|next to|above|below|inside|outside|during|while)\b/gi.test(
      contentPrompt,
    );

  if (!hasAction && !hasContext) {
    warnings.push("Prompt lacks action or spatial context");
    score -= 5;
  }

  const passed = failures.length === 0 && score >= 60;
  return {
    passed,
    score: Math.max(0, score),
    failures,
    warnings,
    metadata: {
      content_length: contentPrompt.length,
      slop_term_count: slopCount,
      detail_indicator_count: detailCount,
      has_action: hasAction,
      has_context: hasContext,
    },
  };
}

/**
 * Verify that reference images are correctly loaded and formatted.
 * Checks file format, size constraints, and slot assignments.
 */
export function checkReferenceImageQuality(
  referenceImages: Uint8Array[],
  slots: string[],
): QACheckResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  let score = 100;

  if (referenceImages.length === 0) {
    failures.push("No reference images provided - style consistency at risk");
    score -= 50;
  }

  // Check if style_guide is in slot 0 (@img1)
  if (slots[0] !== "style_guide" && referenceImages.length > 0) {
    failures.push(
      `Style guide must be @img1 (first slot), got: ${slots[0] || "unknown"}`,
    );
    score -= 30;
  }

  // Validate each reference image
  for (let i = 0; i < referenceImages.length; i++) {
    const img = referenceImages[i];
    const slot = slots[i] || "unknown";

    // Check magic number for format validation
    const isPNG =
      img[0] === 0x89 && img[1] === 0x50 && img[2] === 0x4e && img[3] === 0x47;
    const isJPEG = img[0] === 0xff && img[1] === 0xd8 && img[2] === 0xff;

    if (!isPNG && !isJPEG) {
      failures.push(
        `Reference ${i + 1} (${slot}): Invalid format (not PNG/JPEG)`,
      );
      score -= 20;
    }

    // Check size constraints
    if (img.length < 1024) {
      failures.push(
        `Reference ${i + 1} (${slot}): Too small (${img.length} bytes), likely corrupt`,
      );
      score -= 15;
    } else if (img.length > 5 * 1024 * 1024) {
      warnings.push(
        `Reference ${i + 1} (${slot}): Large file (${(img.length / 1024 / 1024).toFixed(2)}MB), may slow generation`,
      );
      score -= 5;
    }
  }

  const passed = failures.length === 0 && score >= 70;
  return {
    passed,
    score: Math.max(0, score),
    failures,
    warnings,
    metadata: {
      reference_count: referenceImages.length,
      slots,
      total_size_bytes: referenceImages.reduce(
        (sum, img) => sum + img.length,
        0,
      ),
    },
  };
}

/**
 * Pre-flight check: Combine all quality checks before generation.
 * Returns aggregated results and overall pass/fail.
 */
export function runPreflightChecks(input: {
  prompt: string;
  referenceImages?: Uint8Array[];
  referenceSlots?: string[];
}): QACheckResult {
  const promptCheck = checkPromptQuality(input.prompt);
  const referenceCheck = checkReferenceImageQuality(
    input.referenceImages ?? [],
    input.referenceSlots ?? [],
  );

  const failures = [...promptCheck.failures, ...referenceCheck.failures];
  const warnings = [...promptCheck.warnings, ...referenceCheck.warnings];

  // Weighted average: prompt quality 60%, reference quality 40%
  const score = Math.round(
    promptCheck.score * 0.6 + referenceCheck.score * 0.4,
  );
  const passed = failures.length === 0 && score >= 65;

  return {
    passed,
    score,
    failures,
    warnings,
    metadata: {
      prompt_check: promptCheck,
      reference_check: referenceCheck,
    },
  };
}

// ---------------------------------------------------------------------------
// API Call Monitoring
// ---------------------------------------------------------------------------

/**
 * Create an audit log entry for an AI generation API call.
 * Captures all relevant metadata for debugging and quality tracking.
 */
export function createAPICallAuditLog(input: {
  job_id: string;
  scene_index?: number;
  img_index?: number;
  generation_type: string;
  model_id: string;
  prompt: string;
  referenceImages?: Uint8Array[];
  referenceSlots?: (ReferenceSlot | string)[];
  assetIds?: (string | undefined)[];
}): APICallAuditLog {
  const {
    job_id,
    scene_index,
    img_index,
    generation_type,
    model_id,
    prompt,
    referenceImages = [],
    referenceSlots = [],
    assetIds = [],
  } = input;

  const reference_images_sent = referenceImages.map((img, idx) => {
    const isPNG = img[0] === 0x89 && img[1] === 0x50;
    const isJPEG = img[0] === 0xff && img[1] === 0xd8;
    const format = isPNG ? "PNG" : isJPEG ? "JPEG" : "unknown";

    return {
      slot: referenceSlots[idx] || `unknown_${idx}`,
      asset_id: assetIds[idx],
      size_bytes: img.length,
      format: format as "PNG" | "JPEG" | "unknown",
    };
  });

  const prompt_has_style_instructions =
    /REFERENCE STYLE TARGET:|Match the character|IMPORTANT:|MATCH EXACTLY:/i.test(
      prompt,
    );

  return {
    timestamp: new Date().toISOString(),
    job_id,
    scene_index,
    img_index,
    generation_type,
    model_id,
    prompt_length: prompt.length,
    reference_images_sent,
    prompt_has_style_instructions,
    prompt_snippet: prompt.slice(0, 200),
  };
}

/**
 * Validate that an API call audit log meets quality standards.
 * Checks that the correct references are sent based on archetype.
 */
export function validateAPICallAuditLog(log: APICallAuditLog): QACheckResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  let score = 100;

  // Check that style instructions are present when references are sent
  if (
    log.reference_images_sent.length > 0 &&
    !log.prompt_has_style_instructions
  ) {
    failures.push("Reference images sent without style copying instructions");
    score -= 40;
  }

  // Check that @img1 is style_guide when present
  if (log.reference_images_sent.length > 0) {
    const firstSlot = log.reference_images_sent[0]?.slot;
    if (firstSlot !== "style_guide") {
      failures.push(
        `@img1 must be style_guide, got: ${firstSlot}. This breaks style consistency.`,
      );
      score -= 50;
    }
  }

  // Check for corrupt or invalid reference images
  for (const ref of log.reference_images_sent) {
    if (ref.format === "unknown") {
      failures.push(`Invalid reference image format for slot: ${ref.slot}`);
      score -= 20;
    }
    if (ref.size_bytes < 1024) {
      failures.push(
        `Reference ${ref.slot} too small (${ref.size_bytes} bytes)`,
      );
      score -= 15;
    }
  }

  // Warn if no references sent (style consistency risk)
  if (log.reference_images_sent.length === 0) {
    warnings.push(
      "No reference images sent - style consistency cannot be enforced",
    );
    score -= 10;
  }

  const passed = failures.length === 0 && score >= 70;
  return {
    passed,
    score: Math.max(0, score),
    failures,
    warnings,
    metadata: {
      audit_log: log,
    },
  };
}
