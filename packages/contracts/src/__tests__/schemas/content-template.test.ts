import { describe, it, expect } from "vitest";
import { ContentTemplateSchema } from "../../schemas/content-template.js";
import { makeMinimalTemplate } from "../helpers.js";

describe("ContentTemplateSchema", () => {
  it("accepts a minimal valid template", () => {
    const result = ContentTemplateSchema.safeParse(makeMinimalTemplate());
    expect(result.success).toBe(true);
  });

  // === Required fields ===

  it("rejects missing id", () => {
    const { id: _, ...input } = makeMinimalTemplate() as { id: string };
    const result = ContentTemplateSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects non-UUID id", () => {
    const result = ContentTemplateSchema.safeParse(makeMinimalTemplate({ id: "not-a-uuid" }));
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = ContentTemplateSchema.safeParse(makeMinimalTemplate({ name: "" }));
    expect(result.success).toBe(false);
  });

  it("rejects invalid format", () => {
    const result = ContentTemplateSchema.safeParse(makeMinimalTemplate({ format: "RECIPE_VIDEO" }));
    expect(result.success).toBe(false);
  });

  it("rejects empty pipeline_stages array", () => {
    const result = ContentTemplateSchema.safeParse(makeMinimalTemplate({ pipeline_stages: [] }));
    expect(result.success).toBe(false);
  });

  it("rejects missing pipeline_stages", () => {
    const input = { ...makeMinimalTemplate() };
    delete (input as Record<string, unknown>).pipeline_stages;
    const result = ContentTemplateSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects missing prompts", () => {
    const input = { ...makeMinimalTemplate() };
    delete (input as Record<string, unknown>).prompts;
    const result = ContentTemplateSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects missing created_at", () => {
    const input = { ...makeMinimalTemplate() };
    delete (input as Record<string, unknown>).created_at;
    const result = ContentTemplateSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects invalid datetime for created_at", () => {
    const result = ContentTemplateSchema.safeParse(makeMinimalTemplate({ created_at: "not-a-date" }));
    expect(result.success).toBe(false);
  });

  // === format enum ===

  it("accepts all valid formats", () => {
    const validFormats = [
      "EXPLAINER", "NEWS_BROADCAST", "DOCUMENTARY", "POLITICAL_COMMENTARY",
      "TECH_COMPARISON", "DAY_IN_THE_LIFE", "HISTORICAL_WHAT_IF",
      "VIDEO_ESSAY", "CASUALLY_EXPLAINED", "STICKMAN_ANIMATION",
    ];
    for (const format of validFormats) {
      const result = ContentTemplateSchema.safeParse(makeMinimalTemplate({ format }));
      expect(result.success, `format ${format} should be valid`).toBe(true);
    }
  });

  // === render_config ===

  it("accepts render_config with engine and aspect_ratio", () => {
    const result = ContentTemplateSchema.safeParse(makeMinimalTemplate({
      render_config: {
        engine: "FFMPEG",
        aspect_ratio: "16:9",
        target_duration_seconds: 600,
        default_resolution: "1080p",
        captions_enabled: true,
        voice_id: "voice-abc123",
      },
    }));
    expect(result.success).toBe(true);
  });

  it("accepts render_config with passthrough extra fields", () => {
    const result = ContentTemplateSchema.safeParse(makeMinimalTemplate({
      render_config: {
        custom_field: "some_value",
        another_field: 42,
      },
    }));
    expect(result.success).toBe(true);
  });

  it("rejects invalid engine in render_config", () => {
    const result = ContentTemplateSchema.safeParse(makeMinimalTemplate({
      render_config: { engine: "HANDBRAKE" },
    }));
    expect(result.success).toBe(false);
  });

  it("rejects invalid aspect_ratio in render_config", () => {
    const result = ContentTemplateSchema.safeParse(makeMinimalTemplate({
      render_config: { aspect_ratio: "4:3" },
    }));
    expect(result.success).toBe(false);
  });

  it("rejects non-positive target_duration_seconds in render_config", () => {
    const result = ContentTemplateSchema.safeParse(makeMinimalTemplate({
      render_config: { target_duration_seconds: 0 },
    }));
    expect(result.success).toBe(false);
  });

  it("rejects invalid default_resolution in render_config", () => {
    const result = ContentTemplateSchema.safeParse(makeMinimalTemplate({
      render_config: { default_resolution: "720p" },
    }));
    expect(result.success).toBe(false);
  });

  // === metadata (optional) ===

  it("accepts optional metadata field", () => {
    const result = ContentTemplateSchema.safeParse(makeMinimalTemplate({
      metadata: { tags: ["news", "politics"], style: "broadcast" },
    }));
    expect(result.success).toBe(true);
  });

  it("omitting metadata is valid", () => {
    const input = { ...makeMinimalTemplate() };
    delete (input as Record<string, unknown>).metadata;
    const result = ContentTemplateSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});
