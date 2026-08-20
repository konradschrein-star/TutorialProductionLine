/**
 * Pacing Algorithm Tests
 *
 * Tests for computeScenePacing, computeWordAlignedPacing,
 * and computeSentenceImageTimings.
 */

import { describe, it, expect } from "vitest";
import {
  computeScenePacing,
  computeWordAlignedPacing,
  computeSentenceImageTimings,
  computeSentenceImageTimingsWithOnsets,
} from "../pacing.js";
import type { SceneTiming } from "../pacing.js";
import {
  makeWordTimestamps,
  makeScenesWith,
  makeSentenceImages,
  makeSentenceImagesGrouped,
} from "./helpers.js";

// ---------------------------------------------------------------------------
// computeScenePacing — validation
// ---------------------------------------------------------------------------

describe("computeScenePacing — invalid args", () => {
  it("throws on sceneCount = 0", () => {
    expect(() =>
      computeScenePacing({ sceneCount: 0, avatarDurationSeconds: 60, fps: 30 }),
    ).toThrow("sceneCount must be > 0");
  });

  it("throws on negative sceneCount", () => {
    expect(() =>
      computeScenePacing({
        sceneCount: -1,
        avatarDurationSeconds: 60,
        fps: 30,
      }),
    ).toThrow("sceneCount must be > 0");
  });

  it("throws on avatarDurationSeconds = 0", () => {
    expect(() =>
      computeScenePacing({ sceneCount: 5, avatarDurationSeconds: 0, fps: 30 }),
    ).toThrow("avatarDurationSeconds must be > 0");
  });

  it("throws on fps = 0", () => {
    expect(() =>
      computeScenePacing({ sceneCount: 5, avatarDurationSeconds: 60, fps: 0 }),
    ).toThrow("fps must be > 0");
  });
});

// ---------------------------------------------------------------------------
// computeScenePacing — output structure
// ---------------------------------------------------------------------------

describe("computeScenePacing — output structure", () => {
  const SCENE_COUNT = 20;
  const DURATION = 120; // seconds
  const FPS = 30;
  const TOTAL_FRAMES = DURATION * FPS; // 3600

  function run(sceneCount = SCENE_COUNT) {
    return computeScenePacing({
      sceneCount,
      avatarDurationSeconds: DURATION,
      fps: FPS,
    });
  }

  it("returns array with length equal to sceneCount", () => {
    const timings = run();
    expect(timings).toHaveLength(SCENE_COUNT);
  });

  it("scene_index values match array positions", () => {
    const timings = run();
    timings.forEach((t, i) => {
      expect(t.scene_index).toBe(i);
    });
  });

  it("start_frame of first scene is 0", () => {
    expect(run()[0]!.start_frame).toBe(0);
  });

  it("end_frame of last scene equals totalFrames (frame-accurate)", () => {
    const timings = run();
    expect(timings[timings.length - 1]!.end_frame).toBe(TOTAL_FRAMES);
  });

  it("scenes form a contiguous chain: each start_frame equals previous end_frame", () => {
    const timings = run();
    for (let i = 1; i < timings.length; i++) {
      expect(timings[i]!.start_frame).toBe(timings[i - 1]!.end_frame);
    }
  });

  it("duration_frames equals end_frame - start_frame for every scene", () => {
    const timings = run();
    for (const t of timings) {
      expect(t.duration_frames).toBe(t.end_frame - t.start_frame);
    }
  });

  it("all duration_frames are positive", () => {
    const timings = run();
    for (const t of timings) {
      expect(t.duration_frames).toBeGreaterThan(0);
    }
  });

  it("handles 1-scene video", () => {
    const timings = run(1);
    expect(timings).toHaveLength(1);
    expect(timings[0]!.start_frame).toBe(0);
    expect(timings[0]!.end_frame).toBe(TOTAL_FRAMES);
    expect(timings[0]!.duration_frames).toBe(TOTAL_FRAMES);
  });

  it("handles 2-scene video", () => {
    const timings = run(2);
    expect(timings).toHaveLength(2);
    expect(timings[1]!.end_frame).toBe(TOTAL_FRAMES);
    expect(timings[0]!.end_frame).toBe(timings[1]!.start_frame);
  });
});

describe("computeScenePacing — hook/body distribution", () => {
  it("early scenes (hook) have shorter duration than late scenes (body) for large scene counts", () => {
    const timings = computeScenePacing({
      sceneCount: 30,
      avatarDurationSeconds: 300,
      fps: 30,
      hookDurationSeconds: 30,
      hookSceneDurationSeconds: 1.5,
    });
    // Hook scenes are ~1.5s each = ~45 frames at 30fps
    // Body scenes are spread across remaining time
    const hookDuration = timings[0]!.duration_frames;
    const bodyDuration = timings[timings.length - 5]!.duration_frames; // mid body
    expect(hookDuration).toBeLessThan(bodyDuration);
  });

  it("respects custom hookDurationSeconds", () => {
    const timings = computeScenePacing({
      sceneCount: 20,
      avatarDurationSeconds: 120,
      fps: 30,
      hookDurationSeconds: 10,
      hookSceneDurationSeconds: 1.0,
    });
    expect(timings).toHaveLength(20);
    expect(timings[timings.length - 1]!.end_frame).toBe(120 * 30);
  });
});

// ---------------------------------------------------------------------------
// computeWordAlignedPacing — validation
// ---------------------------------------------------------------------------

describe("computeWordAlignedPacing — invalid args", () => {
  it("throws on empty scenes array", () => {
    expect(() => computeWordAlignedPacing([], [], 3600, 30)).toThrow(
      "sceneCount must be > 0",
    );
  });

  it("throws on totalFrames = 0", () => {
    const scenes = makeScenesWith(["Hello world"]);
    expect(() => computeWordAlignedPacing(scenes, [], 0, 30)).toThrow(
      "totalFrames must be > 0",
    );
  });

  it("throws on fps = 0", () => {
    const scenes = makeScenesWith(["Hello world"]);
    expect(() => computeWordAlignedPacing(scenes, [], 3600, 0)).toThrow(
      "fps must be > 0",
    );
  });
});

// ---------------------------------------------------------------------------
// computeWordAlignedPacing — matching
// ---------------------------------------------------------------------------

describe("computeWordAlignedPacing — word alignment", () => {
  it("last scene end_frame equals totalFrames (frame-accurate)", () => {
    // Two scenes; words clearly match their paragraph lead words
    const scenes = makeScenesWith([
      "The quick brown fox",
      "jumps over lazy dog",
    ]);
    const words = makeWordTimestamps([
      "the",
      "quick",
      "brown",
      "fox",
      "jumps",
      "over",
      "lazy",
      "dog",
    ]);
    const totalFrames = 300;
    const fps = 30;

    const timings = computeWordAlignedPacing(scenes, words, totalFrames, fps);
    expect(timings[timings.length - 1]!.end_frame).toBe(totalFrames);
  });

  it("scenes form a contiguous chain", () => {
    const scenes = makeScenesWith([
      "The quick brown fox",
      "jumps over lazy dog",
      "runs into forest quickly",
    ]);
    const words = makeWordTimestamps([
      "the",
      "quick",
      "brown",
      "fox",
      "jumps",
      "over",
      "lazy",
      "dog",
      "runs",
      "into",
      "forest",
      "quickly",
    ]);
    const timings = computeWordAlignedPacing(scenes, words, 360, 30);

    for (let i = 1; i < timings.length; i++) {
      expect(timings[i]!.start_frame).toBe(timings[i - 1]!.end_frame);
    }
  });

  it("returns same number of timings as input scenes", () => {
    const scenes = makeScenesWith([
      "The quick brown fox",
      "jumps over the lazy dog",
      "and runs away fast",
    ]);
    const words = makeWordTimestamps([
      "the",
      "quick",
      "brown",
      "fox",
      "jumps",
      "over",
      "the",
      "lazy",
      "dog",
      "and",
      "runs",
      "away",
      "fast",
    ]);
    const timings = computeWordAlignedPacing(scenes, words, 450, 30);
    expect(timings).toHaveLength(scenes.length);
  });

  it("throws error with diagnostics when fewer than 50% of scenes match", () => {
    // Use nonsense paragraph text that will never match any words
    const scenes = makeScenesWith([
      "aaaaaaa bbbbbbb ccccccc",
      "ddddddd eeeeeee fffffff",
      "ggggggg hhhhhhh iiiiiii",
      "jjjjjjj kkkkkkk lllllll",
    ]);
    // Words are completely unrelated
    const words = makeWordTimestamps(["hello", "world", "foo", "bar"]);
    const totalFrames = 3600;
    const fps = 30;

    // Should throw error with diagnostic information
    expect(() =>
      computeWordAlignedPacing(scenes, words, totalFrames, fps),
    ).toThrow(/Word alignment failed/);
  });

  it("handles scenes with null paragraph gracefully", () => {
    const scenes = [
      { paragraph: "The quick brown fox" },
      { paragraph: null },
      { paragraph: "runs away fast now" },
    ];
    const words = makeWordTimestamps([
      "the",
      "quick",
      "brown",
      "fox",
      "runs",
      "away",
      "fast",
      "now",
    ]);
    const timings = computeWordAlignedPacing(scenes, words, 270, 30);
    expect(timings).toHaveLength(3);
    expect(timings[2]!.end_frame).toBe(270);
  });

  it("handles paragraphs starting with numbers (e.g., '103 years ago')", () => {
    // Numbers at paragraph start should be skipped in lead word extraction
    const scenes = makeScenesWith([
      "103 years ago something happened",
      "50 people were involved here",
    ]);
    const words = makeWordTimestamps([
      "103",
      "years",
      "ago",
      "something",
      "happened",
      "50",
      "people",
      "were",
      "involved",
      "here",
    ]);
    const timings = computeWordAlignedPacing(scenes, words, 600, 30);

    // Should match successfully by skipping the number and matching "years", "ago", etc.
    expect(timings).toHaveLength(2);
    expect(timings[0]!.start_frame).toBe(0);
    expect(timings[1]!.end_frame).toBe(600);
  });

  it("handles misspellings with flexible matching (e.g., 'Aryan' vs 'Arian')", () => {
    // TTS might pronounce names differently than spelled in script
    const scenes = makeScenesWith([
      "Aryan was the founder",
      "This started the movement",
    ]);
    const words = makeWordTimestamps([
      "arian",
      "was",
      "the",
      "founder", // Note: "arian" instead of "aryan"
      "this",
      "started",
      "the",
      "movement",
    ]);
    const timings = computeWordAlignedPacing(scenes, words, 600, 30);

    // Flexible matching should handle the misspelling
    expect(timings).toHaveLength(2);
    expect(timings[0]!.start_frame).toBe(0);
  });

  it("provides detailed diagnostics in error message on alignment failure", () => {
    const scenes = makeScenesWith([
      "completely unmatched text here",
      "another unmatched paragraph now",
    ]);
    const words = makeWordTimestamps(["foo", "bar", "baz", "qux"]);

    try {
      computeWordAlignedPacing(scenes, words, 600, 30);
      expect.fail("Should have thrown error");
    } catch (err: any) {
      // Verify error message includes diagnostics
      expect(err.message).toContain("Word alignment failed");
      expect(err.message).toContain("Scene 0");
      expect(err.message).toContain("Lead words");
      expect(err.message).toContain("Whisper window");
    }
  });
});

// ---------------------------------------------------------------------------
// computeSentenceImageTimings — empty input
// ---------------------------------------------------------------------------

describe("computeSentenceImageTimings — empty input", () => {
  it("returns empty array when sentenceImages is empty", () => {
    const result = computeSentenceImageTimings(0, 300, [], [], 30);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeSentenceImageTimings — basic structure
// ---------------------------------------------------------------------------

describe("computeSentenceImageTimings — basic structure", () => {
  const FPS = 30;
  const SCENE_START = 0;
  const SCENE_END = 300; // 10 seconds at 30fps

  it("returns one segment per unique group_index", () => {
    const sentences = makeSentenceImages([
      "First sentence here.",
      "Second sentence here.",
      "Third sentence here.",
    ]);
    const words = makeWordTimestamps([
      "first",
      "sentence",
      "here",
      "second",
      "sentence",
      "here",
      "third",
      "sentence",
      "here",
    ]);
    const result = computeSentenceImageTimings(
      SCENE_START,
      SCENE_END,
      sentences,
      words,
      FPS,
    );
    expect(result).toHaveLength(3);
  });

  it("groups sentences with the same group_index into one segment", () => {
    const sentences = makeSentenceImagesGrouped(
      [
        "First sentence here.",
        "Second sentence joined.",
        "Third sentence standalone.",
        "Fourth sentence joined.",
      ],
      2,
    );
    const words = makeWordTimestamps([
      "first",
      "sentence",
      "here",
      "second",
      "sentence",
      "joined",
      "third",
      "sentence",
      "standalone",
      "fourth",
      "sentence",
      "joined",
    ]);
    const result = computeSentenceImageTimings(
      SCENE_START,
      SCENE_END,
      sentences,
      words,
      FPS,
    );
    // 4 sentences with groupSize 2 → 2 unique group_index values (0 and 1)
    expect(result).toHaveLength(2);
  });

  it("returns segments sorted by group_index ascending", () => {
    const sentences = makeSentenceImages([
      "Alpha sentence starts.",
      "Beta sentence follows.",
      "Gamma sentence ends.",
    ]);
    const words = makeWordTimestamps([
      "alpha",
      "sentence",
      "starts",
      "beta",
      "sentence",
      "follows",
      "gamma",
      "sentence",
      "ends",
    ]);
    const result = computeSentenceImageTimings(
      SCENE_START,
      SCENE_END,
      sentences,
      words,
      FPS,
    );
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.group_index).toBeGreaterThan(
        result[i - 1]!.group_index,
      );
    }
  });

  it("all segment start_frames are >= sceneStartFrame", () => {
    const sentences = makeSentenceImages([
      "Alpha beta gamma.",
      "Delta epsilon zeta.",
    ]);
    const words = makeWordTimestamps([
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
    ]);
    const result = computeSentenceImageTimings(
      SCENE_START,
      SCENE_END,
      sentences,
      words,
      FPS,
    );
    for (const seg of result) {
      expect(seg.start_frame).toBeGreaterThanOrEqual(SCENE_START);
    }
  });

  it("all segment end_frames are <= sceneEndFrame", () => {
    const sentences = makeSentenceImages([
      "Alpha beta gamma.",
      "Delta epsilon zeta.",
    ]);
    const words = makeWordTimestamps([
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
    ]);
    const result = computeSentenceImageTimings(
      SCENE_START,
      SCENE_END,
      sentences,
      words,
      FPS,
    );
    for (const seg of result) {
      expect(seg.end_frame).toBeLessThanOrEqual(SCENE_END);
    }
  });

  it("all duration_frames are >= 1 (minimum 1 frame)", () => {
    const sentences = makeSentenceImages([
      "Alpha beta gamma.",
      "Delta epsilon zeta.",
    ]);
    const words = makeWordTimestamps([
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
    ]);
    const result = computeSentenceImageTimings(
      SCENE_START,
      SCENE_END,
      sentences,
      words,
      FPS,
    );
    for (const seg of result) {
      expect(seg.duration_frames).toBeGreaterThanOrEqual(1);
    }
  });

  it("duration_frames equals end_frame - start_frame for each segment", () => {
    const sentences = makeSentenceImages([
      "Alpha beta gamma.",
      "Delta epsilon zeta.",
      "Third more words.",
    ]);
    const words = makeWordTimestamps([
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "third",
      "more",
      "words",
    ]);
    const result = computeSentenceImageTimings(
      SCENE_START,
      SCENE_END,
      sentences,
      words,
      FPS,
    );
    for (const seg of result) {
      expect(seg.duration_frames).toBe(seg.end_frame - seg.start_frame);
    }
  });
});

describe("computeSentenceImageTimings — key fact flag", () => {
  it("preserves is_key_fact flag on segment", () => {
    const sentences = [
      {
        group_index: 0,
        sentence_text: "Alpha beta gamma fact.",
        image_prompt: "prompt",
        is_key_fact: true,
        key_fact_text: "Alpha fact",
      },
    ];
    const words = makeWordTimestamps(["alpha", "beta", "gamma", "fact"]);
    const result = computeSentenceImageTimings(0, 300, sentences, words, 30);
    expect(result[0]!.is_key_fact).toBe(true);
    expect(result[0]!.key_fact_text).toBe("Alpha fact");
  });
});

describe("computeSentenceImageTimings — single sentence", () => {
  it("single sentence spans the full scene", () => {
    const sentences = makeSentenceImages(["This is the only sentence here."]);
    const words = makeWordTimestamps([
      "this",
      "is",
      "the",
      "only",
      "sentence",
      "here",
    ]);
    const sceneEnd = 300;
    const result = computeSentenceImageTimings(
      0,
      sceneEnd,
      sentences,
      words,
      30,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.start_frame).toBe(0);
    expect(result[0]!.end_frame).toBe(sceneEnd);
  });
});

// ---------------------------------------------------------------------------
// computeWordAlignedPacing — minimum duration guard
// ---------------------------------------------------------------------------

// The min-duration boost + cumulative-rebuild guard was removed on 2026-06-17.
// It was the root cause of the CE smoke desync: scene 6 was correctly Whisper-
// anchored at 47.72s, then the guard rebuilt every start_frame as a cumulative
// sum of doctored durations and placed scene 6 at 45.4s in the render. Whisper
// is now the source of truth. False-positive matches are fixed at the matcher
// (strict consecutive 3-word match), not papered over after the fact.

// ---------------------------------------------------------------------------
// computeWordAlignedPacing — strict matcher (regression: tail mega-scene)
// ---------------------------------------------------------------------------
//
// 2026-06-15 smoke job b865c86d rendered a 9-scene CE video where scene 8 ran
// 131s of 304s total: the last paragraph's lead words "this video helped
// explain everything" false-matched against an early occurrence of "this
// video" near the intro because the 2-of-5 fuzzy matcher only needed two
// hits in a 10-word window. The strict consecutive matcher (3 words in order,
// up to 3 skips per gap) refuses that early window and finds the real
// position later in the transcript — or fails cleanly so interpolation runs.

describe("computeWordAlignedPacing — strict matcher rejects 2-of-5 false positives", () => {
  it("does not anchor tail scene to early intro false-match", () => {
    // 9 scenes, last paragraph is small (10 words → ~4.6s expected at 130wpm)
    // but the last paragraph's lead words match early in Whisper, giving it
    // 131s out of 304s total. We expect the cap to fire and redistribute.
    const scenes = [
      { paragraph: "Welcome to today's video about procrastination habits" },
      { paragraph: "We all know the feeling staring at a blank screen" },
      { paragraph: "Your brain knows the deadline is approaching fast" },
      { paragraph: "Yet you somehow find yourself watching cat videos" },
      { paragraph: "This is because dopamine seeks immediate reward signals" },
      { paragraph: "The prefrontal cortex loses to limbic reward circuitry" },
      { paragraph: "Modern apps exploit this with infinite scroll mechanics" },
      {
        paragraph:
          "Breaking the cycle requires environment design not willpower",
      },
      // Last paragraph has "this" + "video" which already appear early
      { paragraph: "This video helped explain everything" },
    ];
    const fps = 30;
    // Whisper transcript: "this" and "video" appear at the start (in scene 0's
    // speech) which causes scene 8 to false-match very early.
    const wordTimestamps: { word: string; start: number; end: number }[] = [];
    // Pack 270 fake words across 290s with the false-match seed for "this"/"video"
    // at index 1 (just past scene 0's lead anchor).
    const words = [
      "welcome",
      "today's",
      "video",
      "about",
      "procrastination",
      "habits",
      "this",
      "video",
      "explains",
      "everything", // <-- false anchors for scene 8
      "we",
      "all",
      "know",
      "the",
      "feeling",
      "staring",
      "blank",
      "screen",
      "your",
      "brain",
      "knows",
      "deadline",
      "approaching",
      "fast",
      "yet",
      "somehow",
      "find",
      "yourself",
      "watching",
      "cat",
      "videos",
      "because",
      "dopamine",
      "seeks",
      "immediate",
      "reward",
      "signals",
      "prefrontal",
      "cortex",
      "loses",
      "limbic",
      "reward",
      "circuitry",
      "modern",
      "apps",
      "exploit",
      "infinite",
      "scroll",
      "mechanics",
      "breaking",
      "cycle",
      "requires",
      "environment",
      "design",
      "willpower",
    ];
    let t = 0;
    for (const w of words) {
      wordTimestamps.push({ word: w, start: t, end: t + 0.4 });
      t += 0.5;
    }
    const totalFrames = Math.round(304 * fps); // 304s video

    const timings = computeWordAlignedPacing(
      scenes,
      wordTimestamps,
      totalFrames,
      fps,
    );

    // Invariant: total frames preserved
    const totalAssigned = timings.reduce((s, t) => s + t.duration_frames, 0);
    expect(totalAssigned).toBe(totalFrames);

    // Scene 8 lead words are [this, video, helped, explain, everything].
    // The early "this video explains everything" run at indices 6-9 has
    // [this, video, explains, everything] — strict-3 matching requires
    // [this, video, helped] in order. Since "helped" never appears in the
    // transcript at all, scene 8 falls through to interpolation. Crucially,
    // it does NOT false-anchor to the early "this video" position.
    const scene8 = timings[8]!;
    const scene8StartSec = scene8.start_frame / fps;
    // The 2026-06-15 bug had scene 8 starting near 173s (anchored early).
    // With strict matching + interpolation between scene 7 (matched late) and
    // totalFrames, scene 8 starts much later than the false-match position.
    expect(scene8StartSec).toBeGreaterThan(50);

    // All scenes positive
    for (const seg of timings) {
      expect(seg.duration_frames).toBeGreaterThan(0);
    }
  });

  it("anchors each scene at its true Whisper position when 3 lead words appear in order", () => {
    // Realistic case: 3 well-paced scenes, no caps should fire
    const scenes = [
      { paragraph: "First paragraph with several words to anchor matching" },
      { paragraph: "Second paragraph that follows the first one naturally" },
      { paragraph: "Third paragraph closes out the script with content" },
    ];
    const fps = 30;
    const wordTimestamps: { word: string; start: number; end: number }[] = [];
    const allWords =
      "first paragraph with several words to anchor matching " +
      "second paragraph that follows the first one naturally " +
      "third paragraph closes out the script with content";
    let t = 0;
    for (const w of allWords.split(" ")) {
      wordTimestamps.push({ word: w, start: t, end: t + 0.3 });
      t += 0.4;
    }
    const totalFrames = Math.round(t * fps);

    const timings = computeWordAlignedPacing(
      scenes,
      wordTimestamps,
      totalFrames,
      fps,
    );

    const totalAssigned = timings.reduce((s, t) => s + t.duration_frames, 0);
    expect(totalAssigned).toBe(totalFrames);
    expect(timings.length).toBe(3);
    // Scene 1 should be anchored to where "second paragraph that" actually
    // appears in Whisper, not stretched/squeezed by any guard.
    const scene1StartSec = timings[1]!.start_frame / fps;
    // "second" appears at index 8 of the joined word stream, t = 8 * 0.4 = 3.2s
    expect(scene1StartSec).toBeGreaterThanOrEqual(3.0);
    expect(scene1StartSec).toBeLessThanOrEqual(3.4);
  });
});

// ---------------------------------------------------------------------------
// computeWordAlignedPacing — per-scene match provenance (no synthetic fallback)
// ---------------------------------------------------------------------------
//
// The overall ≥50% gate already existed and is covered above. These tests
// cover the previously-unflagged secondary gap: scenes that fail to match
// *within* a passing majority were silently interpolated with no way for a
// caller/QC reviewer to tell which scene cuts are real vs. guessed. Every
// SceneTiming now carries a `matched` flag for exactly that purpose.

describe("computeWordAlignedPacing — per-scene match provenance", () => {
  it("flags an interpolated scene within an otherwise-passing majority", () => {
    // 4 scenes; scene 2's lead words never appear in the transcript, but the
    // other 3 do, so the overall match rate (75%) clears the 50% gate and no
    // error is thrown. Scene 2 must still be flagged matched: false.
    const scenes = makeScenesWith([
      "Alpha beta gamma",
      "Delta epsilon zeta",
      "Wwwww vvvvv uuuuu",
      "Theta iota kappa",
    ]);
    const words = makeWordTimestamps([
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "theta",
      "iota",
      "kappa",
    ]);
    const timings = computeWordAlignedPacing(scenes, words, 2700, 30);

    expect(timings).toHaveLength(4);
    expect(timings[0]!.matched).toBe(true); // pinned scene 0 — always true
    expect(timings[1]!.matched).toBe(true);
    expect(timings[2]!.matched).toBe(false); // interpolated — no real anchor
    expect(timings[3]!.matched).toBe(true);
  });

  it("flags every scene matched when all lead words are found", () => {
    const scenes = makeScenesWith([
      "The quick brown fox",
      "jumps over lazy dog",
    ]);
    const words = makeWordTimestamps([
      "the",
      "quick",
      "brown",
      "fox",
      "jumps",
      "over",
      "lazy",
      "dog",
    ]);
    const timings = computeWordAlignedPacing(scenes, words, 300, 30);
    for (const t of timings) {
      expect(t.matched).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// computeSentenceImageTimings — match-rate gate + per-segment provenance
// ---------------------------------------------------------------------------
//
// Mirrors computeWordAlignedPacing's ≥50% gate (packages/domain/src/pacing.ts)
// so a sentence's start time is never silently linear-interpolated past that
// threshold with no error path — the previous behavior for this function even
// at a 0% match rate.

describe("computeSentenceImageTimings — match-rate gate (no synthetic fallback)", () => {
  it("throws with diagnostics when fewer than 50% of sentences match", () => {
    const sentences = makeSentenceImages([
      "Alpha beta gamma.",
      "Zzzzz yyyyy xxxxx.",
      "Wwwww vvvvv uuuuu.",
      "Ttttt sssss rrrrr.",
    ]);
    // Only sentence 0's words actually appear in the transcript.
    const words = makeWordTimestamps(["alpha", "beta", "gamma"]);

    expect(() =>
      computeSentenceImageTimings(0, 300, sentences, words, 30),
    ).toThrow(/Sentence alignment failed/);
  });

  it("error message includes per-sentence diagnostics", () => {
    const sentences = makeSentenceImages([
      "Completely unmatched text here.",
      "Another unmatched sentence now.",
    ]);
    const words = makeWordTimestamps(["foo", "bar", "baz", "qux"]);

    try {
      computeSentenceImageTimings(0, 300, sentences, words, 30);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.message).toContain("Sentence alignment failed");
      expect(err.message).toContain("Sentence 0");
      expect(err.message).toContain("Lead words");
      expect(err.message).toContain("Whisper window");
    }
  });

  it("does not throw at a 0% match rate on empty sentenceImages (short-circuits before gate)", () => {
    const result = computeSentenceImageTimings(0, 300, [], [], 30);
    expect(result).toEqual([]);
  });
});

describe("computeSentenceImageTimings — per-segment match provenance", () => {
  it("marks a segment matched:false when its sentence was interpolated, others matched:true", () => {
    // 4 sentences (1:1 with segments — makeSentenceImages doesn't group).
    // Sentence index 2's words never appear in the transcript; 0, 1, 3 do.
    // Overall rate is 75% (>= 50%), so this passes the gate but sentence 2's
    // segment must still be flagged as an interpolated guess.
    const sentences = makeSentenceImages([
      "Alpha beta gamma.",
      "Delta epsilon zeta.",
      "Wwwww vvvvv uuuuu.",
      "Theta iota kappa.",
    ]);
    const words = makeWordTimestamps([
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "theta",
      "iota",
      "kappa",
    ]);
    const result = computeSentenceImageTimings(0, 300, sentences, words, 30);

    expect(result).toHaveLength(4);
    expect(result[0]!.matched).toBe(true);
    expect(result[1]!.matched).toBe(true);
    expect(result[2]!.matched).toBe(false);
    expect(result[3]!.matched).toBe(true);
  });

  it("marks every segment matched:true when all sentences match", () => {
    const sentences = makeSentenceImages([
      "First sentence here.",
      "Second sentence here.",
      "Third sentence here.",
    ]);
    const words = makeWordTimestamps([
      "first",
      "sentence",
      "here",
      "second",
      "sentence",
      "here",
      "third",
      "sentence",
      "here",
    ]);
    const result = computeSentenceImageTimings(0, 300, sentences, words, 30);
    for (const seg of result) {
      expect(seg.matched).toBe(true);
    }
  });

  it("marks a grouped segment matched:false if any member sentence was interpolated", () => {
    // groupSize 2: sentences [0,1] -> group 0, [2,3] -> group 1.
    // Sentence 1's words never appear in the transcript, so group 0 must be
    // matched:false even though sentence 0 (its groupmate) matched fine.
    const sentences = makeSentenceImagesGrouped(
      [
        "Alpha beta gamma.",
        "Wwwww vvvvv uuuuu.",
        "Delta epsilon zeta.",
        "Theta iota kappa.",
      ],
      2,
    );
    const words = makeWordTimestamps([
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "theta",
      "iota",
      "kappa",
    ]);
    const result = computeSentenceImageTimings(0, 300, sentences, words, 30);
    expect(result).toHaveLength(2);
    expect(result[0]!.matched).toBe(false); // group 0: sentence 1 unmatched
    expect(result[1]!.matched).toBe(true); // group 1: both sentences matched
  });
});

// ---------------------------------------------------------------------------
// computeSentenceImageTimingsWithOnsets — same gate + provenance (async)
// ---------------------------------------------------------------------------

describe("computeSentenceImageTimingsWithOnsets — match-rate gate + provenance", () => {
  it("throws with diagnostics when fewer than 50% of sentences match", async () => {
    const sentences = makeSentenceImages([
      "Alpha beta gamma.",
      "Zzzzz yyyyy xxxxx.",
      "Wwwww vvvvv uuuuu.",
      "Ttttt sssss rrrrr.",
    ]);
    const words = makeWordTimestamps(["alpha", "beta", "gamma"]);

    await expect(
      computeSentenceImageTimingsWithOnsets(
        null,
        null,
        0,
        300,
        sentences,
        words,
        30,
      ),
    ).rejects.toThrow(/Sentence alignment failed/);
  });

  it("marks a segment matched:false when its sentence was interpolated, others matched:true", async () => {
    const sentences = makeSentenceImages([
      "Alpha beta gamma.",
      "Delta epsilon zeta.",
      "Wwwww vvvvv uuuuu.",
      "Theta iota kappa.",
    ]);
    const words = makeWordTimestamps([
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "theta",
      "iota",
      "kappa",
    ]);
    const result = await computeSentenceImageTimingsWithOnsets(
      null,
      null,
      0,
      300,
      sentences,
      words,
      30,
    );

    expect(result).toHaveLength(4);
    expect(result[0]!.matched).toBe(true);
    expect(result[1]!.matched).toBe(true);
    expect(result[2]!.matched).toBe(false);
    expect(result[3]!.matched).toBe(true);
  });

  it("returns empty array without throwing for empty sentenceImages", async () => {
    const result = await computeSentenceImageTimingsWithOnsets(
      null,
      null,
      0,
      300,
      [],
      [],
      30,
    );
    expect(result).toEqual([]);
  });
});
