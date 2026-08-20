// packages/media-core/src/subtitles/types.ts

export interface WordTimestamp {
  word: string;
  start: number; // seconds
  end: number; // seconds
  /**
   * Optional speaker registry id (Phase 4 multi-speaker). Diarization/assignment
   * is out of scope for the chunker — this is simply carried through from the
   * caller (e.g. a diarization step, or the live-preview sample mapper) onto the
   * resulting CaptionWord/CaptionChunk so the renderer can show a heading.
   */
  speakerId?: string;
}

// ---------------------------------------------------------------------------
// CaptionPlan v2 — the engine-agnostic output of the segmentation brain.
// Both the Remotion renderer (Task 3) and the ASS renderer (Task 6) consume
// this. See docs/superpowers/specs/2026-07-26-global-subtitle-system-design.md
// §3.1. The canonical Remotion/FFmpeg subtitle CONFIG types live in @repo/db.
// ---------------------------------------------------------------------------

export interface CaptionWord {
  /** Display text after punctuation + text-case transforms. */
  word: string;
  /** Original token before any transform (used for POS tagging / sentence detection). */
  raw: string;
  start: number; // seconds
  end: number; // seconds
  role: "normal" | "keyword" | "secondary";
  /** Resolved from the color rotation when role === 'keyword'. */
  keywordColor?: string;
  speakerId?: string;
}

export interface CaptionChunk {
  words: CaptionWord[];
  /** Wrapping applied when breakLines is on; otherwise a single line of all words. */
  lines: CaptionWord[][];
  start: number; // seconds — start of first word
  end: number; // seconds — end of last word (gapFree may extend to next chunk start)
  speakerId?: string;
}

export type CaptionPlan = CaptionChunk[];

/**
 * Narrowed option bag the chunker actually needs, destructured from a
 * RemotionSubtitleConfig by buildCaptionPlan. Kept independent of @repo/db so
 * the chunker stays a pure, testable unit.
 */
export interface ChunkerOptions {
  wordsPerChunk: number;
  oneWordMode: { pairShortWords: boolean; shortWordMaxLen: number };
  punctuationMode: "all" | "soft" | "none";
  textCase: "asIs" | "upper" | "lower";
  breakLines: boolean;
  maxLines: number;
  gapFree: boolean;
  smartSplit: boolean;
  /** Gap larger than this (ms) forces a chunk boundary when smartSplit is on. */
  largeSilenceThresholdMs?: number;
  /**
   * Widest a wrapped line may be, in em of the caption's own font size. Derived
   * from the target frame by `lineWidthBudgetEm`. Omitted (Infinity) means "do
   * not width-constrain", which leaves wrapping purely balance-based.
   *
   * This exists so the CHUNKER owns line breaking. If a line overflows, Chrome
   * (Remotion) and libass (ASS) each re-wrap it on their own and break at
   * different words, so the two engines stop matching.
   */
  lineWidthBudgetEm?: number;
  /** Caption weight — heavier faces are wider, which the budget must account for. */
  fontWeight?: number;
}
