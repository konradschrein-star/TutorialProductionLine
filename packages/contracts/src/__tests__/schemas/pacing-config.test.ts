import { describe, it, expect } from "vitest";
import { PacingConfigSchema, getPacingConfig, getPacingZone } from "../../schemas/pacing-config.js";

describe("PacingConfigSchema", () => {
  it("accepts an empty object and applies all defaults", () => {
    const result = PacingConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hook_use_subsentences).toBe(true);
      expect(result.data.early_body_end_pct).toBe(50);
      expect(result.data.early_body_end_seconds).toBe(480);
      expect(result.data.late_body_sentences_per_image_min).toBe(2);
      expect(result.data.late_body_sentences_per_image_max).toBe(4);
      expect(result.data.max_image_duration_seconds).toBe(30);
      expect(result.data.key_fact_trigger).toBe("content_detection");
    }
  });

  it("accepts undefined and applies all defaults (schema-level default)", () => {
    const result = PacingConfigSchema.safeParse(undefined);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.key_fact_trigger).toBe("content_detection");
    }
  });

  it("accepts a fully specified config", () => {
    const result = PacingConfigSchema.safeParse({
      hook_use_subsentences: false,
      early_body_end_pct: 40,
      early_body_end_seconds: 300,
      late_body_sentences_per_image_min: 1,
      late_body_sentences_per_image_max: 3,
      max_image_duration_seconds: 20,
      key_fact_trigger: "claude_flagged",
      key_fact_content_pattern: "\\d+%",
    });
    expect(result.success).toBe(true);
  });

  // === Numeric constraints ===

  it("rejects early_body_end_pct below 10", () => {
    const result = PacingConfigSchema.safeParse({ early_body_end_pct: 9 });
    expect(result.success).toBe(false);
  });

  it("rejects early_body_end_pct above 90", () => {
    const result = PacingConfigSchema.safeParse({ early_body_end_pct: 91 });
    expect(result.success).toBe(false);
  });

  it("rejects early_body_end_seconds below 60", () => {
    const result = PacingConfigSchema.safeParse({ early_body_end_seconds: 59 });
    expect(result.success).toBe(false);
  });

  it("rejects early_body_end_seconds above 3600", () => {
    const result = PacingConfigSchema.safeParse({ early_body_end_seconds: 3601 });
    expect(result.success).toBe(false);
  });

  it("rejects late_body_sentences_per_image_min below 1", () => {
    const result = PacingConfigSchema.safeParse({ late_body_sentences_per_image_min: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects late_body_sentences_per_image_min above 4", () => {
    const result = PacingConfigSchema.safeParse({ late_body_sentences_per_image_min: 5 });
    expect(result.success).toBe(false);
  });

  it("rejects late_body_sentences_per_image_max below 2", () => {
    const result = PacingConfigSchema.safeParse({ late_body_sentences_per_image_max: 1 });
    expect(result.success).toBe(false);
  });

  it("rejects late_body_sentences_per_image_max above 8", () => {
    const result = PacingConfigSchema.safeParse({ late_body_sentences_per_image_max: 9 });
    expect(result.success).toBe(false);
  });

  it("rejects max_image_duration_seconds below 5", () => {
    const result = PacingConfigSchema.safeParse({ max_image_duration_seconds: 4 });
    expect(result.success).toBe(false);
  });

  it("rejects max_image_duration_seconds above 120", () => {
    const result = PacingConfigSchema.safeParse({ max_image_duration_seconds: 121 });
    expect(result.success).toBe(false);
  });

  // === Enum constraints ===

  it("rejects invalid key_fact_trigger", () => {
    const result = PacingConfigSchema.safeParse({ key_fact_trigger: "ai_only" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid key_fact_trigger values", () => {
    for (const trigger of ["content_detection", "claude_flagged", "disabled"]) {
      const result = PacingConfigSchema.safeParse({ key_fact_trigger: trigger });
      expect(result.success, `trigger ${trigger} should be valid`).toBe(true);
    }
  });
});

// ─── getPacingConfig helper ───────────────────────────────────────────────────

describe("getPacingConfig", () => {
  it("returns all defaults when passed an empty render_config", () => {
    const config = getPacingConfig({});
    expect(config.early_body_end_pct).toBe(50);
    expect(config.key_fact_trigger).toBe("content_detection");
  });

  it("returns all defaults when passed null", () => {
    const config = getPacingConfig(null);
    expect(config.hook_use_subsentences).toBe(true);
  });

  it("returns parsed pacing from nested render_config.pacing", () => {
    const config = getPacingConfig({ pacing: { early_body_end_pct: 30 } });
    expect(config.early_body_end_pct).toBe(30);
    // Other fields still default
    expect(config.max_image_duration_seconds).toBe(30);
  });

  it("falls back to defaults when pacing is invalid", () => {
    const config = getPacingConfig({ pacing: { early_body_end_pct: 999 } });
    expect(config.early_body_end_pct).toBe(50);
  });
});

// ─── getPacingZone helper ─────────────────────────────────────────────────────

describe("getPacingZone", () => {
  const defaultConfig = PacingConfigSchema.parse({});

  it("returns hook for scene in first 15%", () => {
    // Scene 0 of 20 = 0%
    expect(getPacingZone(0, 20, defaultConfig)).toBe("hook");
    // Scene 2 of 20 = 10%
    expect(getPacingZone(2, 20, defaultConfig)).toBe("hook");
  });

  it("returns early_body for scenes between 15% and early_body_end_pct", () => {
    // Scene 4 of 20 = 20% (above 15%, below 50%)
    expect(getPacingZone(4, 20, defaultConfig)).toBe("early_body");
  });

  it("returns late_body for scenes after early_body_end_pct", () => {
    // Scene 15 of 20 = 75% (above 50%)
    expect(getPacingZone(15, 20, defaultConfig)).toBe("late_body");
  });

  it("handles single scene without division by zero", () => {
    const zone = getPacingZone(0, 1, defaultConfig);
    expect(["hook", "early_body", "late_body"]).toContain(zone);
  });
});
