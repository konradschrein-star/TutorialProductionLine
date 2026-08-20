/**
 * Timeline Hydration Tests
 *
 * Tests for hydrateTimelineFromManifest — the pure function that converts
 * an assembly_manifest + scene_frame_sequences into a VideoTimeline edit layer.
 */

import { describe, it, expect } from "vitest";
import { hydrateTimelineFromManifest } from "../timeline-hydration.js";
import type { HydrationParams, FrameSequenceInput } from "../timeline-hydration.js";
import type { AssemblyManifest } from "@repo/contracts";
import { makeTimedManifestScenes, makeManifestScenes } from "./helpers.js";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

const JOB_ID = "00000000-0000-0000-0000-000000000001";
const FPS = 30;

function makeManifest(
  sceneCount: number,
  options: {
    withFrameTiming?: boolean;
    withTicker?: boolean;
    withCompositionPlan?: boolean;
  } = {},
): AssemblyManifest {
  const rawScenes = options.withFrameTiming
    ? makeTimedManifestScenes(sceneCount, FPS, sceneCount * 5) // 5s per scene
    : makeManifestScenes(sceneCount);

  const scenes = rawScenes.map((s) => ({
    ...s,
    ticker_headline: options.withTicker ? `Headline for scene ${s.scene_index}` : null,
  }));

  const base: AssemblyManifest = { scenes } as unknown as AssemblyManifest;

  if (options.withCompositionPlan) {
    (base as unknown as { composition_plan: unknown }).composition_plan = {
      entries: scenes.map((s, i) => ({
        sceneIndex: i,
        layoutType: i === 0 ? "AVATAR_FULLSCREEN" : "AVATAR_PIP",
        transitionIn: i === 0 ? "CUT" : "CUT",
        isHook: i < 2,
        isFirstInBiome: i === 0,
      })),
      biomes: [],
      hookEndSceneIndex: 2,
      outroStartSceneIndex: sceneCount - 1,
    };
  }

  return base;
}

function makeHydrationParams(
  sceneCount: number,
  options: {
    fps?: number;
    targetDurationSeconds?: number;
    frameSequences?: FrameSequenceInput[];
    withFrameTiming?: boolean;
    withTicker?: boolean;
    withCompositionPlan?: boolean;
  } = {},
): HydrationParams {
  const fps = options.fps ?? FPS;
  const targetDurationSeconds = options.targetDurationSeconds ?? sceneCount * 5;

  return {
    jobId: JOB_ID,
    manifest: makeManifest(sceneCount, {
      withFrameTiming: options.withFrameTiming,
      withTicker: options.withTicker,
      withCompositionPlan: options.withCompositionPlan,
    }),
    frameSequences: options.frameSequences ?? [],
    fps,
    targetDurationSeconds,
  };
}

// ---------------------------------------------------------------------------
// Basic structure
// ---------------------------------------------------------------------------

describe("hydrateTimelineFromManifest — basic structure", () => {
  it("returns a VideoTimeline with job_id set correctly", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(3));
    expect(timeline.job_id).toBe(JOB_ID);
  });

  it("version defaults to 1", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(3));
    expect(timeline.version).toBe(1);
  });

  it("scene count matches input manifest scene count", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(5));
    expect(timeline.scenes).toHaveLength(5);
  });

  it("scene count of 1 produces a valid timeline", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(1));
    expect(timeline.scenes).toHaveLength(1);
  });

  it("scene count of 10 produces correct number of scenes", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(10));
    expect(timeline.scenes).toHaveLength(10);
  });

  it("scene_index values are sequential starting at 0", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(5));
    timeline.scenes.forEach((scene, i) => {
      expect(scene.scene_index).toBe(i);
    });
  });
});

// ---------------------------------------------------------------------------
// scene_id formation
// ---------------------------------------------------------------------------

describe("hydrateTimelineFromManifest — scene_id", () => {
  it("scene_id is '{jobId}:scene_{index}'", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(3));
    expect(timeline.scenes[0]!.scene_id).toBe(`${JOB_ID}:scene_0`);
    expect(timeline.scenes[1]!.scene_id).toBe(`${JOB_ID}:scene_1`);
    expect(timeline.scenes[2]!.scene_id).toBe(`${JOB_ID}:scene_2`);
  });
});

// ---------------------------------------------------------------------------
// Timing — fallback (no frame timing)
// ---------------------------------------------------------------------------

describe("hydrateTimelineFromManifest — timing (fallback, no frame data)", () => {
  it("first scene starts at 0ms", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(5));
    expect(timeline.scenes[0]!.start_ms).toBe(0);
  });

  it("each scene's start_ms matches previous scene's start_ms + duration_ms", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(5));
    for (let i = 1; i < timeline.scenes.length; i++) {
      const prev = timeline.scenes[i - 1]!;
      const curr = timeline.scenes[i]!;
      expect(curr.start_ms).toBe(prev.start_ms + prev.duration_ms);
    }
  });

  it("total_duration_ms equals the sum of all scene duration_ms values", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(5));
    const sumMs = timeline.scenes.reduce((sum, s) => sum + s.duration_ms, 0);
    // total_duration_ms is max(start + duration) — for sequential scenes this equals sum
    expect(timeline.total_duration_ms).toBe(sumMs);
  });

  it("all duration_ms values are positive", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(8));
    for (const scene of timeline.scenes) {
      expect(scene.duration_ms).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Timing — frame-accurate (render worker data)
// ---------------------------------------------------------------------------

describe("hydrateTimelineFromManifest — timing (frame-accurate data)", () => {
  it("uses frame timing when start_frame and duration_frames are set", () => {
    const params = makeHydrationParams(3, {
      withFrameTiming: true,
      targetDurationSeconds: 15,
    });
    const timeline = hydrateTimelineFromManifest(params);
    // All scenes should have computed ms values
    for (const scene of timeline.scenes) {
      expect(scene.start_ms).toBeGreaterThanOrEqual(0);
      expect(scene.duration_ms).toBeGreaterThan(0);
    }
  });

  it("first scene starts at 0ms when frame timing is present", () => {
    const params = makeHydrationParams(4, { withFrameTiming: true });
    const timeline = hydrateTimelineFromManifest(params);
    expect(timeline.scenes[0]!.start_ms).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Layout — fallback to AVATAR_PIP when no composition_plan
// ---------------------------------------------------------------------------

describe("hydrateTimelineFromManifest — layout_type fallback", () => {
  it("defaults layout_type to AVATAR_PIP when no composition_plan is present", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(3));
    for (const scene of timeline.scenes) {
      expect(scene.layout_type).toBe("AVATAR_PIP");
    }
  });

  it("defaults transition_in to CUT when no composition_plan", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(3));
    for (const scene of timeline.scenes) {
      expect(scene.transition_in).toBe("CUT");
    }
  });
});

// ---------------------------------------------------------------------------
// Layout — AVATAR_PIP produces avatar_pip field
// ---------------------------------------------------------------------------

describe("hydrateTimelineFromManifest — AVATAR_PIP layout", () => {
  it("includes avatar_pip field for AVATAR_PIP layout", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(3));
    // Default is AVATAR_PIP, so all scenes should have avatar_pip
    for (const scene of timeline.scenes) {
      expect(scene.avatar_pip).toBeDefined();
    }
  });

  it("avatar_pip position is 'bottom-right' for AVATAR_PIP", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(2));
    expect(timeline.scenes[0]!.avatar_pip?.position).toBe("bottom-right");
  });

  it("avatar_pip scale is 0.3 for AVATAR_PIP", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(2));
    expect(timeline.scenes[0]!.avatar_pip?.scale).toBe(0.3);
  });

  it("avatar_pip asset_id starts as null (HeyGen footage not yet linked)", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(2));
    expect(timeline.scenes[0]!.avatar_pip?.asset_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Layout — composition_plan is used when present
// ---------------------------------------------------------------------------

describe("hydrateTimelineFromManifest — composition_plan integration", () => {
  it("uses layoutType from composition_plan entry when present", () => {
    const timeline = hydrateTimelineFromManifest(
      makeHydrationParams(5, { withCompositionPlan: true }),
    );
    // First scene is always AVATAR_FULLSCREEN per plan in our factory
    expect(timeline.scenes[0]!.layout_type).toBe("AVATAR_FULLSCREEN");
    // Other scenes are AVATAR_PIP per plan
    expect(timeline.scenes[1]!.layout_type).toBe("AVATAR_PIP");
  });

  it("AVATAR_FULLSCREEN layout gets hidden position avatar_pip", () => {
    const timeline = hydrateTimelineFromManifest(
      makeHydrationParams(5, { withCompositionPlan: true }),
    );
    const fullscreenScene = timeline.scenes[0]!;
    // AVATAR_FULLSCREEN → avatar_pip present with position 'hidden'
    expect(fullscreenScene.avatar_pip?.position).toBe("hidden");
    expect(fullscreenScene.avatar_pip?.scale).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// Text overlays — ticker_headline
// ---------------------------------------------------------------------------

describe("hydrateTimelineFromManifest — text overlays", () => {
  it("empty text_overlays when ticker_headline is null", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(3));
    for (const scene of timeline.scenes) {
      expect(scene.text_overlays).toEqual([]);
    }
  });

  it("non-empty text_overlays when ticker_headline is set", () => {
    const timeline = hydrateTimelineFromManifest(
      makeHydrationParams(3, { withTicker: true }),
    );
    for (const scene of timeline.scenes) {
      expect(scene.text_overlays.length).toBeGreaterThan(0);
      expect(scene.text_overlays[0]!.position).toBe("lower-third");
    }
  });

  it("text overlay text matches ticker_headline from manifest", () => {
    const timeline = hydrateTimelineFromManifest(
      makeHydrationParams(2, { withTicker: true }),
    );
    expect(timeline.scenes[0]!.text_overlays[0]!.text).toContain("Headline for scene 0");
    expect(timeline.scenes[1]!.text_overlays[0]!.text).toContain("Headline for scene 1");
  });
});

// ---------------------------------------------------------------------------
// Voiceover defaults
// ---------------------------------------------------------------------------

describe("hydrateTimelineFromManifest — voiceover defaults", () => {
  it("voiceover asset_id starts as null", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(3));
    for (const scene of timeline.scenes) {
      expect(scene.voiceover.asset_id).toBeNull();
    }
  });

  it("voiceover offset_ms defaults to 0", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(3));
    for (const scene of timeline.scenes) {
      expect(scene.voiceover.offset_ms).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Frame sequences integration
// ---------------------------------------------------------------------------

describe("hydrateTimelineFromManifest — frame sequences", () => {
  const frameSeqs: FrameSequenceInput[] = [
    {
      id: "fs-001",
      scene_index: 0,
      frame_index: 0,
      asset_id: "asset-abc",
      hold_duration_ms: 2000,
      transition_type: "cut",
      prompt_delta: null,
    },
    {
      id: "fs-002",
      scene_index: 0,
      frame_index: 1,
      asset_id: null,
      hold_duration_ms: 3000,
      transition_type: "dissolve",
      prompt_delta: "zoom in slightly",
    },
    {
      id: "fs-003",
      scene_index: 1,
      frame_index: 0,
      asset_id: "asset-xyz",
      hold_duration_ms: 4000,
      transition_type: "hold",
      prompt_delta: null,
    },
  ];

  it("populates video_frames for scenes that have frame sequences", () => {
    const timeline = hydrateTimelineFromManifest(
      makeHydrationParams(3, { frameSequences: frameSeqs }),
    );
    expect(timeline.scenes[0]!.video_frames).toHaveLength(2);
    expect(timeline.scenes[1]!.video_frames).toHaveLength(1);
    expect(timeline.scenes[2]!.video_frames).toHaveLength(0);
  });

  it("frame_sequences are sorted by frame_index", () => {
    const unsorted: FrameSequenceInput[] = [
      { id: "f2", scene_index: 0, frame_index: 1, asset_id: null, hold_duration_ms: 1000, transition_type: "cut", prompt_delta: null },
      { id: "f1", scene_index: 0, frame_index: 0, asset_id: null, hold_duration_ms: 1000, transition_type: "cut", prompt_delta: null },
    ];
    const timeline = hydrateTimelineFromManifest(
      makeHydrationParams(2, { frameSequences: unsorted }),
    );
    expect(timeline.scenes[0]!.video_frames[0]!.frame_index).toBe(0);
    expect(timeline.scenes[0]!.video_frames[1]!.frame_index).toBe(1);
  });

  it("preserves asset_id and prompt_delta from frame sequences", () => {
    const timeline = hydrateTimelineFromManifest(
      makeHydrationParams(3, { frameSequences: frameSeqs }),
    );
    const firstFrame = timeline.scenes[0]!.video_frames[0]!;
    expect(firstFrame.asset_id).toBe("asset-abc");
    expect(firstFrame.prompt_delta).toBeNull();

    const secondFrame = timeline.scenes[0]!.video_frames[1]!;
    expect(secondFrame.prompt_delta).toBe("zoom in slightly");
    expect(secondFrame.transition_type).toBe("dissolve");
  });

  it("returns empty video_frames when no frame sequences provided", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(3));
    for (const scene of timeline.scenes) {
      expect(scene.video_frames).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Global audio defaults
// ---------------------------------------------------------------------------

describe("hydrateTimelineFromManifest — global_audio defaults", () => {
  it("music_duck_db defaults to -12", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(3));
    expect(timeline.global_audio.music_duck_db).toBe(-12);
  });

  it("voiceover_gain_db defaults to 0", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(3));
    expect(timeline.global_audio.voiceover_gain_db).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Regeneration requests default
// ---------------------------------------------------------------------------

describe("hydrateTimelineFromManifest — regeneration_requests", () => {
  it("starts with empty regeneration_requests for all scenes", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(4));
    for (const scene of timeline.scenes) {
      expect(scene.regeneration_requests).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Paragraph and prompt passthrough
// ---------------------------------------------------------------------------

describe("hydrateTimelineFromManifest — source metadata passthrough", () => {
  it("paragraph text is preserved from manifest", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(3));
    for (let i = 0; i < 3; i++) {
      expect(timeline.scenes[i]!.paragraph).toContain(`Scene ${i} paragraph`);
    }
  });

  it("image_prompt is null when not set in manifest", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(3));
    for (const scene of timeline.scenes) {
      expect(scene.image_prompt).toBeNull();
    }
  });

  it("shot_type is null when not set in manifest", () => {
    const timeline = hydrateTimelineFromManifest(makeHydrationParams(3));
    for (const scene of timeline.scenes) {
      expect(scene.shot_type).toBeNull();
    }
  });
});
