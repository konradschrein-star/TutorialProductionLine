/**
 * Quality Assurance System Tests
 *
 * Tests for prompt quality checks, reference image validation,
 * API call audit logging, and video quality verification.
 */

import { describe, test, expect } from "vitest";
import {
  checkPromptQuality,
  checkReferenceImageQuality,
  runPreflightChecks,
  createAPICallAuditLog,
  validateAPICallAuditLog,
} from "../quality-assurance.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

/** Create a mock PNG image buffer */
function createMockPNG(size: number): Uint8Array {
  const buf = new Uint8Array(size);
  // PNG magic number
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  return buf;
}

/** Create a mock JPEG image buffer */
function createMockJPEG(size: number): Uint8Array {
  const buf = new Uint8Array(size);
  // JPEG magic number
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf;
}

/** Create a corrupt/invalid image buffer */
function createCorruptImage(size: number): Uint8Array {
  return new Uint8Array(size).fill(0x00);
}

// ─── Prompt Quality Tests ───────────────────────────────────────────────────

describe("checkPromptQuality", () => {
  test("passes for detailed, specific prompt", () => {
    const prompt =
      "A minimalist stick figure character walking through a modern office space, drawn with thin black lines on a white background. The character has an expressive face showing determination, with arms swinging naturally. The office features clean geometric furniture and bright blue accent colors.";

    const result = checkPromptQuality(prompt);

    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThan(80);
    expect(result.failures).toHaveLength(0);
  });

  test("fails for too short prompt", () => {
    const prompt = "A simple image";

    const result = checkPromptQuality(prompt);

    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThan(60);
    expect(result.failures).toContainEqual(
      expect.stringContaining("Prompt too short"),
    );
  });

  test("warns for generic/vague terms (slop)", () => {
    const prompt =
      "A generic basic image showing some stuff with various things that look nice";

    const result = checkPromptQuality(prompt);

    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThanOrEqual(60);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures[0]).toContain("generic/vague terms");
  });

  test("warns when prompt lacks visual details", () => {
    const prompt =
      "A person standing in a room looking at something while thinking about stuff";

    const result = checkPromptQuality(prompt);

    // Should pass basic checks but have warnings
    expect(result.warnings).toContainEqual(
      expect.stringContaining("lacks specific visual details"),
    );
  });

  test("handles prompts with style instructions (reference injection)", () => {
    const prompt =
      "@img1 @img2 REFERENCE STYLE TARGET: @img1 shows the exact style. Match the art style from @img1. A stick figure walking through an office";

    const result = checkPromptQuality(prompt);

    // Should ignore @imgN references and style instructions in quality check
    expect(result.passed).toBe(true);
    expect(result.metadata?.content_length).toBeGreaterThan(0);
  });

  test("detects action and context in prompts", () => {
    const prompt =
      "A stick figure walking quickly next to a tall building while holding a briefcase, in front of a blue sky";

    const result = checkPromptQuality(prompt);

    expect(result.passed).toBe(true);
    expect(result.metadata?.has_action).toBe(true);
    expect(result.metadata?.has_context).toBe(true);
  });
});

// ─── Reference Image Quality Tests ──────────────────────────────────────────

describe("checkReferenceImageQuality", () => {
  test("passes for valid PNG style_guide in slot 0", () => {
    const images = [createMockPNG(5000)];
    const slots = ["style_guide"];

    const result = checkReferenceImageQuality(images, slots);

    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThan(90);
    expect(result.failures).toHaveLength(0);
  });

  test("passes for multiple valid references", () => {
    const images = [
      createMockPNG(5000),
      createMockJPEG(3000),
      createMockPNG(4000),
    ];
    const slots = ["style_guide", "character", "layout_reference"];

    const result = checkReferenceImageQuality(images, slots);

    expect(result.passed).toBe(true);
    expect(result.metadata?.reference_count).toBe(3);
  });

  test("fails when no reference images provided", () => {
    const result = checkReferenceImageQuality([], []);

    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThan(60);
    expect(result.failures).toContainEqual(
      expect.stringContaining("No reference images provided"),
    );
  });

  test("fails when style_guide is not in slot 0", () => {
    const images = [createMockPNG(5000), createMockPNG(5000)];
    const slots = ["character", "style_guide"];

    const result = checkReferenceImageQuality(images, slots);

    expect(result.passed).toBe(false);
    expect(result.failures).toContainEqual(
      expect.stringContaining("Style guide must be @img1"),
    );
  });

  test("fails for corrupt image (invalid magic number)", () => {
    const images = [createCorruptImage(5000)];
    const slots = ["style_guide"];

    const result = checkReferenceImageQuality(images, slots);

    expect(result.passed).toBe(false);
    expect(result.failures).toContainEqual(
      expect.stringContaining("Invalid format"),
    );
  });

  test("fails for image that's too small (likely corrupt)", () => {
    const images = [createMockPNG(500)]; // < 1KB
    const slots = ["style_guide"];

    const result = checkReferenceImageQuality(images, slots);

    expect(result.passed).toBe(false);
    expect(result.failures).toContainEqual(
      expect.stringContaining("Too small"),
    );
  });

  test("warns for large images (> 5MB)", () => {
    const images = [createMockPNG(6 * 1024 * 1024)]; // 6MB
    const slots = ["style_guide"];

    const result = checkReferenceImageQuality(images, slots);

    // Should still pass but warn
    expect(result.warnings).toContainEqual(
      expect.stringContaining("Large file"),
    );
  });
});

// ─── Pre-flight Checks Tests ────────────────────────────────────────────────

describe("runPreflightChecks", () => {
  test("passes when both prompt and references are good", () => {
    const prompt =
      "A minimalist stick figure walking with thin black lines, expressive face, blue background";
    const referenceImages = [createMockPNG(5000), createMockPNG(3000)];
    const referenceSlots = ["style_guide", "character"];

    const result = runPreflightChecks({
      prompt,
      referenceImages,
      referenceSlots,
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThan(70);
  });

  test("fails when prompt is bad", () => {
    const prompt = "simple image";
    const referenceImages = [createMockPNG(5000)];
    const referenceSlots = ["style_guide"];

    const result = runPreflightChecks({
      prompt,
      referenceImages,
      referenceSlots,
    });

    expect(result.passed).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  test("fails when references are bad", () => {
    const prompt =
      "A detailed stick figure with expressive lines and vibrant colors";
    const referenceImages = [createCorruptImage(5000)];
    const referenceSlots = ["character"]; // Wrong slot (should be style_guide first)

    const result = runPreflightChecks({
      prompt,
      referenceImages,
      referenceSlots,
    });

    expect(result.passed).toBe(false);
  });

  test("aggregates warnings from both checks", () => {
    const prompt = "A character walking"; // Short but not terrible
    const referenceImages = [createMockPNG(6 * 1024 * 1024)]; // Large
    const referenceSlots = ["style_guide"];

    const result = runPreflightChecks({
      prompt,
      referenceImages,
      referenceSlots,
    });

    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ─── API Call Audit Logging Tests ──────────────────────────────────────────

describe("createAPICallAuditLog", () => {
  test("creates audit log with all metadata", () => {
    const log = createAPICallAuditLog({
      job_id: "test-job-id",
      scene_index: 0,
      img_index: 1,
      generation_type: "sentence_image",
      model_id: "gemini-3.1-flash-image-preview",
      prompt:
        "@img1 @img2 REFERENCE STYLE TARGET: Match the style. A stick figure walking",
      referenceImages: [createMockPNG(5000), createMockJPEG(3000)],
      referenceSlots: ["style_guide", "character"],
      assetIds: ["asset-123", "asset-456"],
    });

    expect(log.job_id).toBe("test-job-id");
    expect(log.scene_index).toBe(0);
    expect(log.img_index).toBe(1);
    expect(log.generation_type).toBe("sentence_image");
    expect(log.model_id).toBe("gemini-3.1-flash-image-preview");
    expect(log.reference_images_sent).toHaveLength(2);
    expect(log.reference_images_sent[0]!.slot).toBe("style_guide");
    expect(log.reference_images_sent[0]!.format).toBe("PNG");
    expect(log.reference_images_sent[0]!.asset_id).toBe("asset-123");
    expect(log.reference_images_sent[1]!.format).toBe("JPEG");
    expect(log.prompt_has_style_instructions).toBe(true);
  });

  test("detects style instructions in prompt", () => {
    const log = createAPICallAuditLog({
      job_id: "test-job-id",
      generation_type: "sentence_image",
      model_id: "test-model",
      prompt: "@img1 REFERENCE STYLE TARGET: copy the style",
    });

    expect(log.prompt_has_style_instructions).toBe(true);
  });

  test("detects missing style instructions", () => {
    const log = createAPICallAuditLog({
      job_id: "test-job-id",
      generation_type: "sentence_image",
      model_id: "test-model",
      prompt: "Just a simple prompt without any style instructions",
    });

    expect(log.prompt_has_style_instructions).toBe(false);
  });
});

describe("validateAPICallAuditLog", () => {
  test("passes when style instructions present with references", () => {
    const log = createAPICallAuditLog({
      job_id: "test-job-id",
      generation_type: "sentence_image",
      model_id: "test-model",
      prompt: "@img1 REFERENCE STYLE TARGET: Match the style. A scene",
      referenceImages: [createMockPNG(5000)],
      referenceSlots: ["style_guide"],
    });

    const result = validateAPICallAuditLog(log);

    expect(result.passed).toBe(true);
  });

  test("fails when references sent without style instructions", () => {
    const log = createAPICallAuditLog({
      job_id: "test-job-id",
      generation_type: "sentence_image",
      model_id: "test-model",
      prompt: "A scene with no style instructions",
      referenceImages: [createMockPNG(5000)],
      referenceSlots: ["style_guide"],
    });

    const result = validateAPICallAuditLog(log);

    expect(result.passed).toBe(false);
    expect(result.failures).toContainEqual(
      expect.stringContaining("without style copying instructions"),
    );
  });

  test("fails when @img1 is not style_guide", () => {
    const log = createAPICallAuditLog({
      job_id: "test-job-id",
      generation_type: "sentence_image",
      model_id: "test-model",
      prompt: "@img1 REFERENCE STYLE TARGET: Match. A scene",
      referenceImages: [createMockPNG(5000)],
      referenceSlots: ["character"], // Wrong! Should be style_guide
    });

    const result = validateAPICallAuditLog(log);

    expect(result.passed).toBe(false);
    expect(result.failures).toContainEqual(
      expect.stringContaining("@img1 must be style_guide"),
    );
  });

  test("warns when no references sent", () => {
    const log = createAPICallAuditLog({
      job_id: "test-job-id",
      generation_type: "sentence_image",
      model_id: "test-model",
      prompt: "A simple prompt",
    });

    const result = validateAPICallAuditLog(log);

    expect(result.warnings).toContainEqual(
      expect.stringContaining("No reference images sent"),
    );
  });
});
