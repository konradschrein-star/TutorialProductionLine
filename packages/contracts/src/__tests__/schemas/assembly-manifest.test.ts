import { describe, it, expect } from "vitest";
import {
  AssemblyManifestSchema,
  SceneSchema,
  WordTimestampSchema,
  TickerItemSchema,
  VisualTypeSchema,
} from "../../schemas/assembly-manifest.js";

// ─── Minimal valid scene ──────────────────────────────────────────────────────

function makeScene(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scene_index: 0,
    paragraph: "This is the first paragraph.",
    visual_type: "BROLL_IMAGE",
    ...overrides,
  };
}

// ─── VisualTypeSchema ─────────────────────────────────────────────────────────

describe("VisualTypeSchema", () => {
  it("accepts all known visual types", () => {
    for (const value of ["AVATAR_ON_CAMERA", "AVATAR_PIP", "BROLL_IMAGE", "BROLL_VIDEO"]) {
      expect(VisualTypeSchema.safeParse(value).success).toBe(true);
    }
  });

  it("rejects unknown visual type", () => {
    expect(VisualTypeSchema.safeParse("DRONE_SHOT").success).toBe(false);
  });
});

// ─── SceneSchema ──────────────────────────────────────────────────────────────

describe("SceneSchema", () => {
  it("accepts a minimal valid scene", () => {
    const result = SceneSchema.safeParse(makeScene());
    expect(result.success).toBe(true);
  });

  it("defaults start_frame to null", () => {
    const result = SceneSchema.safeParse(makeScene());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.start_frame).toBeNull();
  });

  it("defaults end_frame to null", () => {
    const result = SceneSchema.safeParse(makeScene());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.end_frame).toBeNull();
  });

  it("defaults duration_frames to null", () => {
    const result = SceneSchema.safeParse(makeScene());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.duration_frames).toBeNull();
  });

  it("defaults visual_asset_key to null", () => {
    const result = SceneSchema.safeParse(makeScene());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.visual_asset_key).toBeNull();
  });

  it("defaults image_prompt to null", () => {
    const result = SceneSchema.safeParse(makeScene());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.image_prompt).toBeNull();
  });

  it("defaults ticker_headline to null", () => {
    const result = SceneSchema.safeParse(makeScene());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.ticker_headline).toBeNull();
  });

  it("rejects negative scene_index", () => {
    const result = SceneSchema.safeParse(makeScene({ scene_index: -1 }));
    expect(result.success).toBe(false);
  });

  it("rejects unknown visual_type", () => {
    const result = SceneSchema.safeParse(makeScene({ visual_type: "CGI" }));
    expect(result.success).toBe(false);
  });

  it("rejects missing paragraph", () => {
    const { paragraph: _, ...scene } = makeScene() as { paragraph: string };
    const result = SceneSchema.safeParse(scene);
    expect(result.success).toBe(false);
  });

  it("enforces ticker_headline max length of 200", () => {
    const result = SceneSchema.safeParse(makeScene({ ticker_headline: "x".repeat(201) }));
    expect(result.success).toBe(false);
  });

  it("accepts a scene with all optional fields populated", () => {
    const result = SceneSchema.safeParse(makeScene({
      start_frame: 0,
      end_frame: 100,
      duration_frames: 100,
      visual_asset_key: "channels/c1/jobs/j1/scene_0.jpg",
      image_prompt: "A dramatic landscape",
      enriched_image_prompt: "A dramatic landscape, wide angle, golden hour",
      ticker_headline: "Breaking: Something happened",
      shot_type: "wide",
      camera_angle: "eye_level",
      visual_theme: {
        setting: "urban",
        timeOfDay: "day",
        colorPalette: "warm",
        mood: "energetic",
      },
    }));
    expect(result.success).toBe(true);
  });

  it("rejects invalid shot_type", () => {
    const result = SceneSchema.safeParse(makeScene({ shot_type: "fisheye" }));
    expect(result.success).toBe(false);
  });
});

// ─── WordTimestampSchema ──────────────────────────────────────────────────────

describe("WordTimestampSchema", () => {
  it("accepts a valid word timestamp", () => {
    const result = WordTimestampSchema.safeParse({ word: "hello", start: 0.5, end: 0.9 });
    expect(result.success).toBe(true);
  });

  it("rejects negative start time", () => {
    const result = WordTimestampSchema.safeParse({ word: "hello", start: -0.1, end: 0.5 });
    expect(result.success).toBe(false);
  });

  it("rejects missing word field", () => {
    const result = WordTimestampSchema.safeParse({ start: 0.5, end: 0.9 });
    expect(result.success).toBe(false);
  });
});

// ─── TickerItemSchema ─────────────────────────────────────────────────────────

describe("TickerItemSchema", () => {
  it("accepts a valid ticker item", () => {
    const result = TickerItemSchema.safeParse({ text: "Markets rally on positive data" });
    expect(result.success).toBe(true);
  });

  it("rejects text longer than 200 characters", () => {
    const result = TickerItemSchema.safeParse({ text: "x".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects missing text", () => {
    const result = TickerItemSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ─── AssemblyManifestSchema ───────────────────────────────────────────────────

describe("AssemblyManifestSchema", () => {
  it("accepts a minimal valid manifest with one scene", () => {
    const result = AssemblyManifestSchema.safeParse({
      scenes: [makeScene()],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty scenes array", () => {
    const result = AssemblyManifestSchema.safeParse({ scenes: [] });
    expect(result.success).toBe(false);
  });

  it("rejects missing scenes field", () => {
    const result = AssemblyManifestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts optional word_timestamps", () => {
    const result = AssemblyManifestSchema.safeParse({
      scenes: [makeScene()],
      word_timestamps: [{ word: "hello", start: 0.0, end: 0.5 }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional ticker_items", () => {
    const result = AssemblyManifestSchema.safeParse({
      scenes: [makeScene()],
      ticker_items: [{ text: "Test headline" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional render_seed", () => {
    const result = AssemblyManifestSchema.safeParse({
      scenes: [makeScene()],
      render_seed: 42,
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative render_seed", () => {
    const result = AssemblyManifestSchema.safeParse({
      scenes: [makeScene()],
      render_seed: -1,
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional global_visual_theme", () => {
    const result = AssemblyManifestSchema.safeParse({
      scenes: [makeScene()],
      global_visual_theme: {
        setting: "city",
        timeOfDay: "night",
        colorPalette: "cool blues",
        mood: "tense",
      },
    });
    expect(result.success).toBe(true);
  });
});
