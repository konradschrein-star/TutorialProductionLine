/**
 * Shared Test Helpers for @repo/domain tests
 *
 * Factory functions for constructing common test inputs.
 * No production code — pure test infrastructure.
 */

import type { WordTimestamp, SentenceImage } from "@repo/contracts";

// ---------------------------------------------------------------------------
// Word Timestamps
// ---------------------------------------------------------------------------

/**
 * Build a synthetic array of WordTimestamp objects.
 *
 * @param words           Array of word strings to convert.
 * @param startOffset     Seconds before the first word starts (default 0).
 * @param durationPerWord Seconds each word occupies (default 0.3).
 */
export function makeWordTimestamps(
  words: string[],
  startOffset = 0,
  durationPerWord = 0.3,
): WordTimestamp[] {
  return words.map((word, i) => ({
    word,
    start: startOffset + i * durationPerWord,
    end: startOffset + i * durationPerWord + durationPerWord,
  }));
}

// ---------------------------------------------------------------------------
// Scene arrays
// ---------------------------------------------------------------------------

/**
 * Build a minimal scene array from raw paragraph strings.
 * Useful for computeWordAlignedPacing and computeScenePacing tests.
 */
export function makeScenesWith(
  paragraphs: string[],
): Array<{ paragraph: string }> {
  return paragraphs.map((paragraph) => ({ paragraph }));
}

// ---------------------------------------------------------------------------
// Assembly Manifest helpers
// ---------------------------------------------------------------------------

export interface MinimalScene {
  scene_index: number;
  paragraph: string;
  start_frame: number | null;
  end_frame: number | null;
  duration_frames: number | null;
  visual_asset_key: string | null;
  visual_type: "BROLL_IMAGE";
  image_prompt: string | null;
  ticker_headline: string | null;
  enriched_image_prompt?: string | null;
  shot_type?: string;
  camera_angle?: string;
}

/**
 * Create an array of minimal scene objects for use in AssemblyManifest.
 */
export function makeManifestScenes(
  count: number,
  overrides: Partial<MinimalScene> = {},
): MinimalScene[] {
  return Array.from({ length: count }, (_, i) => ({
    scene_index: i,
    paragraph: `Scene ${i} paragraph text for testing.`,
    start_frame: null,
    end_frame: null,
    duration_frames: null,
    visual_asset_key: null,
    visual_type: "BROLL_IMAGE" as const,
    image_prompt: null,
    ticker_headline: null,
    ...overrides,
  }));
}

/**
 * Create manifest scenes with frame timing pre-populated.
 */
export function makeTimedManifestScenes(
  count: number,
  fps: number,
  totalSeconds: number,
): MinimalScene[] {
  const totalFrames = Math.round(totalSeconds * fps);
  const framesPerScene = Math.floor(totalFrames / count);

  return Array.from({ length: count }, (_, i) => {
    const start_frame = i * framesPerScene;
    const end_frame = i === count - 1 ? totalFrames : (i + 1) * framesPerScene;
    return {
      scene_index: i,
      paragraph: `Scene ${i} paragraph.`,
      start_frame,
      end_frame,
      duration_frames: end_frame - start_frame,
      visual_asset_key: null,
      visual_type: "BROLL_IMAGE" as const,
      image_prompt: null,
      ticker_headline: null,
    };
  });
}

// ---------------------------------------------------------------------------
// SentenceImage helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal SentenceImage array for testing computeSentenceImageTimings.
 * Each sentence gets its own group_index (no grouping).
 */
export function makeSentenceImages(sentences: string[]): SentenceImage[] {
  return sentences.map((sentence_text, i) => ({
    group_index: i,
    sentence_text,
    image_prompt: "placeholder prompt",
    is_key_fact: false,
    key_fact_text: null,
  }));
}

/**
 * Build a SentenceImage array where consecutive sentences share the same group_index.
 *
 * @param sentences   Array of sentence strings.
 * @param groupSize   How many sentences share one group_index (default 2).
 */
export function makeSentenceImagesGrouped(
  sentences: string[],
  groupSize = 2,
): SentenceImage[] {
  return sentences.map((sentence_text, i) => ({
    group_index: Math.floor(i / groupSize),
    sentence_text,
    image_prompt: "placeholder prompt",
    is_key_fact: false,
    key_fact_text: null,
  }));
}
