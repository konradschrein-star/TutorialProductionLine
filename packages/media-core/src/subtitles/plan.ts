import type { WordTimestamp, CaptionPlan, ChunkerOptions } from "./types.js";
import type { RemotionSubtitleConfig } from "@repo/db";
import { chunkWords } from "./chunker.js";
import { selectKeywords } from "./keyword-selector.js";
import { lineWidthBudgetEm, type FrameSize } from "./layout.js";

// ===========================================================================
// buildCaptionPlan — the segmentation-brain orchestrator: chunk -> keywords ->
// secondary tagging. Engine-agnostic; consumed by both the Remotion renderer
// (Task 3) and the ASS renderer (Task 6).
// Spec: docs/superpowers/specs/2026-07-26-global-subtitle-system-design.md §3
// ===========================================================================

function toChunkerOptions(
  config: RemotionSubtitleConfig,
  frame?: FrameSize,
): ChunkerOptions {
  return {
    wordsPerChunk: config.wordsPerChunk,
    oneWordMode: {
      pairShortWords: config.oneWordMode.pairShortWords,
      shortWordMaxLen: config.oneWordMode.shortWordMaxLen,
    },
    punctuationMode: config.punctuationMode,
    textCase: config.textCase,
    breakLines: config.breakLines,
    maxLines: config.maxLines,
    gapFree: config.gapFree,
    smartSplit: config.smartSplit,
    // largeSilenceThresholdMs left to the chunker's internal default (600).
    lineWidthBudgetEm: lineWidthBudgetEm(config, frame),
    fontWeight: config.fontWeight,
  };
}

export function buildCaptionPlan(
  words: WordTimestamp[],
  config: RemotionSubtitleConfig,
  /**
   * The frame this plan will be rendered into. Supplying it lets the chunker
   * wrap against the caption's real safe width, so BOTH engines follow the
   * chunker's explicit line breaks instead of each re-wrapping an overflowing
   * line their own way. Optional: omit it for an aspect-agnostic plan.
   */
  frame?: FrameSize,
): CaptionPlan {
  // 1. Chunk (throws on malformed input — no silent fallbacks).
  const plan = chunkWords(words, toChunkerOptions(config, frame));

  // 2. Keyword selection (no-op when keyword.enabled is false).
  selectKeywords(plan, config.keyword);

  // 3. Secondary role — only when a secondary font is configured. Non-keyword
  //    words become 'secondary' so the renderer can apply the reduced-emphasis
  //    secondary font. Without a secondary font they stay 'normal'.
  if (config.secondaryFont) {
    for (const chunk of plan) {
      for (const word of chunk.words) {
        if (word.role === "normal") word.role = "secondary";
      }
    }
  }

  return plan;
}
