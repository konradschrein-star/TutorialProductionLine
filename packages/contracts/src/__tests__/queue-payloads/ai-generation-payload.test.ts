import { describe, it, expect } from "vitest";
import { AIGenerationPayloadSchema } from "../../queue-payloads/ai-generation-payload.js";

const JOB_ID = "00000000-0000-0000-0000-000000000001";

// ─── TTS Payload ──────────────────────────────────────────────────────────────

describe("AIGenerationPayloadSchema — tts", () => {
  const validTts = {
    job_id: JOB_ID,
    generation_type: "tts",
    voice_id: "eleven-rachel",
    text: "Hello, welcome to Content Forge.",
  };

  it("accepts a valid TTS payload", () => {
    expect(AIGenerationPayloadSchema.safeParse(validTts).success).toBe(true);
  });

  it("rejects TTS missing voice_id", () => {
    const { voice_id: _, ...rest } = validTts;
    expect(AIGenerationPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects TTS missing text", () => {
    const { text: _, ...rest } = validTts;
    expect(AIGenerationPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects TTS voice_id longer than 100 chars", () => {
    expect(
      AIGenerationPayloadSchema.safeParse({
        ...validTts,
        voice_id: "v".repeat(101),
      }).success,
    ).toBe(false);
  });

  it("rejects TTS text longer than 100000 chars", () => {
    expect(
      AIGenerationPayloadSchema.safeParse({
        ...validTts,
        text: "x".repeat(100001),
      }).success,
    ).toBe(false);
  });

  it("accepts optional language field", () => {
    expect(
      AIGenerationPayloadSchema.safeParse({ ...validTts, language: "de" })
        .success,
    ).toBe(true);
  });
});

// ─── Script Payload ───────────────────────────────────────────────────────────

describe("AIGenerationPayloadSchema — script", () => {
  const validScript = {
    job_id: JOB_ID,
    generation_type: "script",
    template_id: "00000000-0000-0000-0000-000000000010",
    topic: "The future of AI in healthcare",
  };

  it("accepts a valid script payload", () => {
    expect(AIGenerationPayloadSchema.safeParse(validScript).success).toBe(true);
  });

  it("rejects script missing template_id", () => {
    const { template_id: _, ...rest } = validScript;
    expect(AIGenerationPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects script with non-UUID template_id", () => {
    expect(
      AIGenerationPayloadSchema.safeParse({
        ...validScript,
        template_id: "bad",
      }).success,
    ).toBe(false);
  });

  it("rejects script missing topic", () => {
    const { topic: _, ...rest } = validScript;
    expect(AIGenerationPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects topic longer than 1000 chars", () => {
    expect(
      AIGenerationPayloadSchema.safeParse({
        ...validScript,
        topic: "x".repeat(1001),
      }).success,
    ).toBe(false);
  });
});

// ─── Scene Image Payload ──────────────────────────────────────────────────────

describe("AIGenerationPayloadSchema — scene_image", () => {
  const validSceneImage = {
    job_id: JOB_ID,
    generation_type: "scene_image",
    scene_index: 0,
    image_prompt: "A wide shot of a city skyline at dusk",
  };

  it("accepts a valid scene_image payload", () => {
    expect(AIGenerationPayloadSchema.safeParse(validSceneImage).success).toBe(
      true,
    );
  });

  it("defaults aspect_ratio to 16:9", () => {
    const result = AIGenerationPayloadSchema.safeParse(validSceneImage);
    expect(result.success).toBe(true);
    if (result.success && result.data.generation_type === "scene_image") {
      expect(result.data.aspect_ratio).toBe("16:9");
    }
  });

  it("rejects negative scene_index", () => {
    expect(
      AIGenerationPayloadSchema.safeParse({
        ...validSceneImage,
        scene_index: -1,
      }).success,
    ).toBe(false);
  });

  it("rejects missing image_prompt", () => {
    const { image_prompt: _, ...rest } = validSceneImage;
    expect(AIGenerationPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects image_prompt longer than 2000 chars", () => {
    expect(
      AIGenerationPayloadSchema.safeParse({
        ...validSceneImage,
        image_prompt: "x".repeat(2001),
      }).success,
    ).toBe(false);
  });

  it("accepts optional enriched_image_prompt", () => {
    expect(
      AIGenerationPayloadSchema.safeParse({
        ...validSceneImage,
        enriched_image_prompt: "Wide angle, 50mm lens, golden hour lighting",
      }).success,
    ).toBe(true);
  });
});

// ─── Sentence Image Payload ───────────────────────────────────────────────────

describe("AIGenerationPayloadSchema — sentence_image", () => {
  const validSentenceImage = {
    job_id: JOB_ID,
    generation_type: "sentence_image",
    scene_index: 2,
    img_index: 0,
    group_index: 0,
    image_prompt: "Close-up of hands typing on a keyboard",
  };

  it("accepts a valid sentence_image payload", () => {
    expect(
      AIGenerationPayloadSchema.safeParse(validSentenceImage).success,
    ).toBe(true);
  });

  it("defaults aspect_ratio to 16:9", () => {
    const result = AIGenerationPayloadSchema.safeParse(validSentenceImage);
    expect(result.success).toBe(true);
    if (result.success && result.data.generation_type === "sentence_image") {
      expect(result.data.aspect_ratio).toBe("16:9");
    }
  });

  it("rejects missing img_index", () => {
    const { img_index: _, ...rest } = validSentenceImage;
    expect(AIGenerationPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects missing group_index", () => {
    const { group_index: _, ...rest } = validSentenceImage;
    expect(AIGenerationPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects negative img_index", () => {
    expect(
      AIGenerationPayloadSchema.safeParse({
        ...validSentenceImage,
        img_index: -1,
      }).success,
    ).toBe(false);
  });

  it("rejects image_prompt longer than 2000 chars", () => {
    expect(
      AIGenerationPayloadSchema.safeParse({
        ...validSentenceImage,
        image_prompt: "x".repeat(2001),
      }).success,
    ).toBe(false);
  });
});

// ─── YouTube Metadata Payload ─────────────────────────────────────────────────

describe("AIGenerationPayloadSchema — youtube_metadata", () => {
  const validYtMeta = {
    job_id: JOB_ID,
    generation_type: "youtube_metadata",
    topic: "Top 10 AI breakthroughs of 2026",
    format: "EXPLAINER",
  };

  it("accepts a valid youtube_metadata payload", () => {
    expect(AIGenerationPayloadSchema.safeParse(validYtMeta).success).toBe(true);
  });

  it("defaults language to en", () => {
    const result = AIGenerationPayloadSchema.safeParse(validYtMeta);
    expect(result.success).toBe(true);
    if (result.success && result.data.generation_type === "youtube_metadata") {
      expect(result.data.language).toBe("en");
    }
  });

  it("rejects missing topic", () => {
    const { topic: _, ...rest } = validYtMeta;
    expect(AIGenerationPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects missing format", () => {
    const { format: _, ...rest } = validYtMeta;
    expect(AIGenerationPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects topic longer than 1000 chars", () => {
    expect(
      AIGenerationPayloadSchema.safeParse({
        ...validYtMeta,
        topic: "x".repeat(1001),
      }).success,
    ).toBe(false);
  });
});

// ─── Discriminated union — unknown type ───────────────────────────────────────

describe("AIGenerationPayloadSchema — discriminated union", () => {
  it("rejects unknown generation_type", () => {
    expect(
      AIGenerationPayloadSchema.safeParse({
        job_id: JOB_ID,
        generation_type: "video_render",
      }).success,
    ).toBe(false);
  });

  it("rejects missing generation_type", () => {
    expect(
      AIGenerationPayloadSchema.safeParse({ job_id: JOB_ID }).success,
    ).toBe(false);
  });

  it("rejects missing job_id in any branch", () => {
    expect(
      AIGenerationPayloadSchema.safeParse({
        generation_type: "thumbnail",
        prompt: "test prompt",
      }).success,
    ).toBe(false);
  });

  it("rejects non-UUID job_id", () => {
    expect(
      AIGenerationPayloadSchema.safeParse({
        job_id: "not-a-uuid",
        generation_type: "youtube_metadata",
      }).success,
    ).toBe(false);
  });
});
