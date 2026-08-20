import { describe, it, expect } from "vitest";
import {
  TimelineFrameSchema,
  TextOverlaySchema,
  AvatarPipSchema,
  VoiceoverSchema,
  RegenerationActionSchema,
  RegenerationRequestSchema,
  TimelineSceneSchema,
  VideoTimelineSchema,
} from "../../schemas/video-timeline.js";

// ─── Shared test UUIDs ────────────────────────────────────────────────────────

const UUID1 = "00000000-0000-0000-0000-000000000001";
const UUID2 = "00000000-0000-0000-0000-000000000002";

// ─── TimelineFrameSchema ──────────────────────────────────────────────────────

describe("TimelineFrameSchema", () => {
  const validFrame = {
    frame_sequence_id: UUID1,
    frame_index: 0,
    asset_id: null,
    hold_duration_ms: 2000,
    transition_type: "cut",
    prompt_delta: null,
  };

  it("accepts a valid frame", () => {
    expect(TimelineFrameSchema.safeParse(validFrame).success).toBe(true);
  });

  it("rejects non-UUID frame_sequence_id", () => {
    expect(TimelineFrameSchema.safeParse({ ...validFrame, frame_sequence_id: "bad" }).success).toBe(false);
  });

  it("rejects negative frame_index", () => {
    expect(TimelineFrameSchema.safeParse({ ...validFrame, frame_index: -1 }).success).toBe(false);
  });

  it("rejects non-positive hold_duration_ms", () => {
    expect(TimelineFrameSchema.safeParse({ ...validFrame, hold_duration_ms: 0 }).success).toBe(false);
  });

  it("rejects invalid transition_type", () => {
    expect(TimelineFrameSchema.safeParse({ ...validFrame, transition_type: "wipe" }).success).toBe(false);
  });

  it("accepts all valid transition types", () => {
    for (const t of ["cut", "dissolve", "hold"]) {
      expect(TimelineFrameSchema.safeParse({ ...validFrame, transition_type: t }).success).toBe(true);
    }
  });

  it("accepts pending_regeneration when present", () => {
    const result = TimelineFrameSchema.safeParse({
      ...validFrame,
      pending_regeneration: { new_prompt_delta: "Make it darker" },
    });
    expect(result.success).toBe(true);
  });
});

// ─── TextOverlaySchema ────────────────────────────────────────────────────────

describe("TextOverlaySchema", () => {
  it("accepts a valid text overlay", () => {
    expect(TextOverlaySchema.safeParse({ text: "Breaking News", position: "lower-third" }).success).toBe(true);
  });

  it("rejects text longer than 200 characters", () => {
    expect(TextOverlaySchema.safeParse({ text: "x".repeat(201), position: "ticker" }).success).toBe(false);
  });

  it("rejects invalid position", () => {
    expect(TextOverlaySchema.safeParse({ text: "hello", position: "top-left" }).success).toBe(false);
  });

  it("accepts all valid positions", () => {
    for (const pos of ["lower-third", "ticker", "center"]) {
      expect(TextOverlaySchema.safeParse({ text: "test", position: pos }).success).toBe(true);
    }
  });
});

// ─── AvatarPipSchema ──────────────────────────────────────────────────────────

describe("AvatarPipSchema", () => {
  const validPip = {
    asset_id: null,
    position: "bottom-right",
  };

  it("accepts a minimal valid avatar pip", () => {
    expect(AvatarPipSchema.safeParse(validPip).success).toBe(true);
  });

  it("defaults scale to 0.3", () => {
    const result = AvatarPipSchema.safeParse(validPip);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.scale).toBe(0.3);
  });

  it("defaults trim_start_ms to 0", () => {
    const result = AvatarPipSchema.safeParse(validPip);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.trim_start_ms).toBe(0);
  });

  it("defaults trim_end_ms to 0", () => {
    const result = AvatarPipSchema.safeParse(validPip);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.trim_end_ms).toBe(0);
  });

  it("rejects scale below 0.1", () => {
    expect(AvatarPipSchema.safeParse({ ...validPip, scale: 0.09 }).success).toBe(false);
  });

  it("rejects scale above 1.0", () => {
    expect(AvatarPipSchema.safeParse({ ...validPip, scale: 1.01 }).success).toBe(false);
  });

  it("rejects invalid position", () => {
    expect(AvatarPipSchema.safeParse({ ...validPip, position: "top-right" }).success).toBe(false);
  });

  it("accepts all valid positions", () => {
    for (const pos of ["bottom-right", "bottom-left", "hidden"]) {
      expect(AvatarPipSchema.safeParse({ ...validPip, position: pos }).success).toBe(true);
    }
  });

  it("rejects negative trim_start_ms", () => {
    expect(AvatarPipSchema.safeParse({ ...validPip, trim_start_ms: -1 }).success).toBe(false);
  });
});

// ─── VoiceoverSchema ──────────────────────────────────────────────────────────

describe("VoiceoverSchema", () => {
  it("accepts a minimal valid voiceover", () => {
    expect(VoiceoverSchema.safeParse({ asset_id: null }).success).toBe(true);
  });

  it("defaults offset_ms to 0", () => {
    const result = VoiceoverSchema.safeParse({ asset_id: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.offset_ms).toBe(0);
  });

  it("defaults trim_start_ms to 0", () => {
    const result = VoiceoverSchema.safeParse({ asset_id: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.trim_start_ms).toBe(0);
  });

  it("accepts a valid UUID asset_id", () => {
    expect(VoiceoverSchema.safeParse({ asset_id: UUID1 }).success).toBe(true);
  });

  it("rejects negative trim_start_ms", () => {
    expect(VoiceoverSchema.safeParse({ asset_id: null, trim_start_ms: -1 }).success).toBe(false);
  });
});

// ─── RegenerationActionSchema ─────────────────────────────────────────────────

describe("RegenerationActionSchema", () => {
  it("accepts all valid regeneration actions", () => {
    for (const action of ["full_regen", "prompt_delta", "swap_layout", "swap_character_state", "swap_environment"]) {
      expect(RegenerationActionSchema.safeParse(action).success).toBe(true);
    }
  });

  it("rejects unknown action", () => {
    expect(RegenerationActionSchema.safeParse("delete_scene").success).toBe(false);
  });
});

// ─── RegenerationRequestSchema ────────────────────────────────────────────────

describe("RegenerationRequestSchema", () => {
  const validRequest = {
    action: "full_regen",
    requested_at: "2026-04-01T12:00:00.000Z",
  };

  it("accepts a minimal valid regeneration request", () => {
    expect(RegenerationRequestSchema.safeParse(validRequest).success).toBe(true);
  });

  it("defaults status to pending", () => {
    const result = RegenerationRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("pending");
  });

  it("accepts all valid statuses", () => {
    for (const status of ["pending", "dispatched", "complete", "failed"]) {
      expect(RegenerationRequestSchema.safeParse({ ...validRequest, status }).success).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    expect(RegenerationRequestSchema.safeParse({ ...validRequest, status: "running" }).success).toBe(false);
  });

  it("rejects invalid action", () => {
    expect(RegenerationRequestSchema.safeParse({ ...validRequest, action: "magic" }).success).toBe(false);
  });

  it("accepts optional new_layout_type", () => {
    const result = RegenerationRequestSchema.safeParse({
      ...validRequest,
      action: "swap_layout",
      new_layout_type: "AVATAR_PIP",
    });
    expect(result.success).toBe(true);
  });
});

// ─── TimelineSceneSchema ──────────────────────────────────────────────────────

function makeValidTimelineScene(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scene_index: 0,
    scene_id: "job123:scene_0",
    start_ms: 0,
    duration_ms: 5000,
    layout_type: "AVATAR_PIP",
    transition_in: "CUT",
    is_hook: false,
    video_frames: [],
    text_overlays: [],
    voiceover: { asset_id: null },
    paragraph: "Test paragraph text.",
    image_prompt: null,
    enriched_image_prompt: null,
    shot_type: null,
    camera_angle: null,
    regeneration_requests: [],
    ...overrides,
  };
}

describe("TimelineSceneSchema", () => {
  it("accepts a valid minimal timeline scene", () => {
    expect(TimelineSceneSchema.safeParse(makeValidTimelineScene()).success).toBe(true);
  });

  it("defaults regeneration_requests to empty array", () => {
    const input = { ...makeValidTimelineScene() };
    delete (input as Record<string, unknown>).regeneration_requests;
    const result = TimelineSceneSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.regeneration_requests).toEqual([]);
  });

  it("rejects negative scene_index", () => {
    expect(TimelineSceneSchema.safeParse(makeValidTimelineScene({ scene_index: -1 })).success).toBe(false);
  });

  it("rejects non-positive duration_ms", () => {
    expect(TimelineSceneSchema.safeParse(makeValidTimelineScene({ duration_ms: 0 })).success).toBe(false);
  });

  it("rejects negative start_ms", () => {
    expect(TimelineSceneSchema.safeParse(makeValidTimelineScene({ start_ms: -1 })).success).toBe(false);
  });

  it("rejects invalid layout_type", () => {
    expect(TimelineSceneSchema.safeParse(makeValidTimelineScene({ layout_type: "FLOATING_TEXT" })).success).toBe(false);
  });

  it("rejects invalid transition_in", () => {
    expect(TimelineSceneSchema.safeParse(makeValidTimelineScene({ transition_in: "WIPE" })).success).toBe(false);
  });
});

// ─── VideoTimelineSchema ──────────────────────────────────────────────────────

describe("VideoTimelineSchema", () => {
  const validTimeline = {
    job_id: UUID1,
    total_duration_ms: 30000,
    scenes: [makeValidTimelineScene()],
    global_audio: {},
  };

  it("accepts a minimal valid timeline", () => {
    expect(VideoTimelineSchema.safeParse(validTimeline).success).toBe(true);
  });

  it("defaults version to 1", () => {
    const result = VideoTimelineSchema.safeParse(validTimeline);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.version).toBe(1);
  });

  it("defaults music_duck_db to -12", () => {
    const result = VideoTimelineSchema.safeParse(validTimeline);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.global_audio.music_duck_db).toBe(-12);
  });

  it("defaults voiceover_gain_db to 0", () => {
    const result = VideoTimelineSchema.safeParse(validTimeline);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.global_audio.voiceover_gain_db).toBe(0);
  });

  it("rejects non-UUID job_id", () => {
    expect(VideoTimelineSchema.safeParse({ ...validTimeline, job_id: "bad" }).success).toBe(false);
  });

  it("rejects non-positive total_duration_ms", () => {
    expect(VideoTimelineSchema.safeParse({ ...validTimeline, total_duration_ms: 0 }).success).toBe(false);
  });

  it("rejects empty scenes array", () => {
    expect(VideoTimelineSchema.safeParse({ ...validTimeline, scenes: [] }).success).toBe(false);
  });

  it("accepts optional render_queued_at with valid ISO 8601 datetime", () => {
    const result = VideoTimelineSchema.safeParse({
      ...validTimeline,
      render_queued_at: "2026-04-01T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid render_queued_at format", () => {
    expect(VideoTimelineSchema.safeParse({
      ...validTimeline,
      render_queued_at: "not-a-date",
    }).success).toBe(false);
  });

  it("accepts music_asset_id as UUID in global_audio", () => {
    const result = VideoTimelineSchema.safeParse({
      ...validTimeline,
      global_audio: { music_asset_id: UUID2 },
    });
    expect(result.success).toBe(true);
  });
});
