import type { SentenceImage, WordTimestamp } from "@repo/contracts";
import { normalizeWord } from "./alignment.js";

/**
 * Video Timing Algorithms
 *
 * Sentence-based architecture (V2+):
 *   computeSentenceImageTimings() — atomic sentence-level timing using Whisper
 *   word timestamps. Sentences are the fundamental video timing unit, enabling:
 *   - Fine-grained layout switching (every 15-30s instead of 60-90s)
 *   - Better retention (first sentence = 5-10s, not 30+ sec paragraphs)
 *   - Precise image-to-audio synchronization
 *
 * Scene-based algorithms (legacy, still used by some formats):
 *   computeWordAlignedPacing() — paragraph-aligned timing for comparison format
 *   computeScenePacing() — audio-blind fallback for testing/compatibility
 *
 * Frame-accurate: all algorithms ensure the last timing ends exactly at totalFrames
 * to prevent rounding drift.
 */

export interface SceneTiming {
  scene_index: number;
  start_frame: number;
  end_frame: number;
  duration_frames: number;
  /**
   * True when start_frame comes from a real Whisper word-alignment match
   * (or is the structurally-pinned scene 0); false when it was linearly
   * interpolated between neighboring matched scenes because this scene's
   * lead words could not be found in the transcript. Optional because
   * computeScenePacing (audio-blind, no Whisper involved) never sets it.
   */
  matched?: boolean;
}

export interface PacingParams {
  /** Number of scenes to distribute */
  sceneCount: number;
  /** Total avatar video duration in seconds (from FFprobe) */
  avatarDurationSeconds: number;
  /** Frames per second (from template render_config) */
  fps: number;
  /** Duration of the hook section in seconds (default: 30) */
  hookDurationSeconds?: number;
  /** Duration of each scene in the hook section (default: 1.5) */
  hookSceneDurationSeconds?: number;
}

/**
 * Compute frame-accurate per-scene timings from avatar duration.
 *
 * Called inside the render workflow after FFprobe reports HeyGen duration.
 * Returns an array indexed by scene_index, ready to be merged into assembly_manifest.
 */
export function computeScenePacing(params: PacingParams): SceneTiming[] {
  const {
    sceneCount,
    avatarDurationSeconds,
    fps,
    hookDurationSeconds = 30,
    hookSceneDurationSeconds = 1.5,
  } = params;

  if (sceneCount <= 0) throw new Error("sceneCount must be > 0");
  if (avatarDurationSeconds <= 0)
    throw new Error("avatarDurationSeconds must be > 0");
  if (fps <= 0) throw new Error("fps must be > 0");

  const totalFrames = Math.round(avatarDurationSeconds * fps);
  const hookSceneFrames = Math.round(hookSceneDurationSeconds * fps);

  // How many scenes fit in the hook window
  // Cap at 40% of total scenes so we always have body scenes for even distribution
  const maxHookScenes = Math.floor(
    hookDurationSeconds / hookSceneDurationSeconds,
  );
  const hookSceneCount = Math.min(
    maxHookScenes,
    Math.max(1, Math.floor(sceneCount * 0.4)),
  );
  const bodySceneCount = sceneCount - hookSceneCount;

  const hookTotalFrames = hookSceneCount * hookSceneFrames;
  const bodyTotalFrames = totalFrames - hookTotalFrames;
  const bodySceneFrames =
    bodySceneCount > 0 ? Math.floor(bodyTotalFrames / bodySceneCount) : 0;

  const timings: SceneTiming[] = [];
  let cursor = 0;

  for (let i = 0; i < sceneCount; i++) {
    const isHookScene = i < hookSceneCount;
    const isLastScene = i === sceneCount - 1;

    let duration: number;
    if (isLastScene) {
      // Force last scene to consume all remaining frames — eliminates rounding drift
      duration = totalFrames - cursor;
    } else if (isHookScene) {
      duration = hookSceneFrames;
    } else {
      duration = bodySceneFrames;
    }

    timings.push({
      scene_index: i,
      start_frame: cursor,
      end_frame: cursor + duration,
      duration_frames: duration,
    });

    cursor += duration;
  }

  return timings;
}

/**
 * Extract the first N significant words from a paragraph for matching.
 * Skips words < 4 chars (eliminates common function words: die, der, das, im, in, und, was, als, mit...).
 * Skips pure numbers (e.g., "103", "50") that commonly start paragraphs.
 */
function extractLeadWords(paragraph: string, count = 4): string[] {
  if (!paragraph) return [];
  return paragraph
    .split(/\s+/)
    .map(normalizeWord)
    .filter((w) => w.length >= 4 && !/^\d+$/.test(w)) // 4-char min filters common function words
    .slice(0, count);
}

/**
 * Strict consecutive-word matcher.
 *
 * Background: the previous "2-of-5 lead words in a 10-word window" matcher
 * false-matched scene 5 on the 2026-06-17 CE smoke at the END of scene 5's
 * audio (where "screen helps more" appears) instead of its real start ~15s
 * earlier. Because scenes have repeating function words ("your", "the"),
 * a permissive matcher will lock onto stray occurrences and propagate
 * desync into every subsequent scene's image placement.
 *
 * New rule: find the FIRST occurrence in `whisperNorm` (at or after startIdx)
 * where ≥ minConsecutive of `leadWords` match in their original order, in a
 * contiguous run of Whisper words. A single ≤ 1-word gap is tolerated for
 * minor Whisper drop-outs (filler words it occasionally swallows).
 *
 * Match per word is still fuzzy (substring) so misspellings ("Aryan" vs
 * "Arian") don't break alignment.
 *
 * Returns the start time + index of the FIRST matched lead word's position.
 * Returns null if no consecutive run found within the scan range.
 *
 * @param leadWords         Ordered lead words from the paragraph/sentence.
 * @param whisperNorm       Normalized Whisper words (full transcript).
 * @param startIdx          Scan cursor — first whisper index to consider.
 * @param scanLimit         Upper bound on whisper index to scan (exclusive).
 * @param minConsecutive    Min consecutive lead-word matches required (default 3).
 */
function strictConsecutiveMatch(
  leadWords: string[],
  whisperNorm: Array<{ norm: string; start: number; end: number }>,
  startIdx: number,
  scanLimit: number,
  minConsecutive = 3,
): { matchTime: number; matchIdx: number } | null {
  if (leadWords.length === 0) return null;
  const required = Math.min(minConsecutive, leadWords.length);
  const wordMatches = (ww: string, lw: string): boolean =>
    ww === lw || ww.includes(lw) || lw.includes(ww);

  // extractLeadWords filters out <4-char function words ("is", "the", "of"...).
  // Whisper keeps them, so between two consecutive lead-word matches we expect
  // 0–3 Whisper words to skip. 3-per-gap is the safe upper bound for English
  // running text without re-introducing the old 2-of-5-permissive failure mode.
  const MAX_SKIPS_PER_GAP = 3;
  const cap = Math.min(scanLimit, whisperNorm.length);

  for (let i = startIdx; i < cap; i++) {
    if (!wordMatches(whisperNorm[i]!.norm, leadWords[0]!)) continue;

    // Tentative anchor at i. Walk both pointers forward.
    let leadPtr = 1;
    let whisperPtr = i + 1;
    let matched = 1;
    let skipsThisGap = 0;

    while (
      leadPtr < leadWords.length &&
      whisperPtr < whisperNorm.length &&
      matched < required
    ) {
      if (wordMatches(whisperNorm[whisperPtr]!.norm, leadWords[leadPtr]!)) {
        matched++;
        leadPtr++;
        whisperPtr++;
        skipsThisGap = 0;
      } else if (skipsThisGap < MAX_SKIPS_PER_GAP) {
        skipsThisGap++;
        whisperPtr++;
      } else {
        break;
      }
    }

    if (matched >= required) {
      return { matchTime: whisperNorm[i]!.start, matchIdx: i };
    }
  }

  return null;
}

/**
 * Word-Aligned Scene Pacing (OBSOLETE FOR V2+ FORMATS)
 *
 * @deprecated This function is obsolete for V2+ sentence-based formats.
 * Use computeSentenceImageTimings() instead, which provides sentence-level
 * timing granularity for better retention and layout cycling.
 *
 * Still used by legacy formats:
 * - Comparison format (paragraph-based by design)
 * - Explainer format (pending migration to sentence-based)
 * - Clean layout format (pending migration to sentence-based)
 *
 * Aligns each scene's start_frame to the moment its paragraph text begins
 * being spoken, using Whisper word-level timestamps.
 *
 * Algorithm:
 *   For each scene in order, take the first few significant words of
 *   scene.paragraph, scan forward through the Whisper word list from the
 *   previous scene's match position, and find a flexible match (2 of 5 lead
 *   words in next 10 Whisper words). That match's start time → scene.start_frame.
 *
 *   Scenes that cannot be matched (filler text, punctuation-only paragraphs)
 *   receive interpolated timings between the surrounding matched scenes.
 *
 *   ERROR if fewer than 50% of scenes can be matched. No silent fallback.
 *
 * @param scenes - Array of scenes with paragraph text, in order
 * @param wordTimestamps - Whisper output: words with start/end in seconds
 * @param totalFrames - Total number of frames in the composition
 * @param fps - Frames per second
 * @throws Error with diagnostics if word alignment fails
 */
export function computeWordAlignedPacing(
  scenes: Array<{ paragraph?: string | null }>,
  wordTimestamps: WordTimestamp[],
  totalFrames: number,
  fps: number,
): SceneTiming[] {
  const sceneCount = scenes.length;
  if (sceneCount <= 0) throw new Error("sceneCount must be > 0");
  if (totalFrames <= 0) throw new Error("totalFrames must be > 0");
  if (fps <= 0) throw new Error("fps must be > 0");

  // Normalize all Whisper words once
  const whisperNorm = wordTimestamps.map((w) => ({
    norm: normalizeWord(w.word),
    start: w.start,
    end: w.end,
  }));

  // Try to match each scene to a word position
  const matchedStartTimes: (number | null)[] = new Array(sceneCount).fill(null);
  const matchDiagnostics: Array<{
    sceneIndex: number;
    leadWords: string[];
    matched: boolean;
  }> = [];
  let whisperCursor = 0; // scan forward only — scenes are sequential

  for (let i = 0; i < sceneCount; i++) {
    const paragraph = scenes[i]?.paragraph ?? "";
    const leadWords = extractLeadWords(paragraph, 5);

    if (leadWords.length < 2) {
      // Not enough words to match — will be interpolated later
      matchDiagnostics.push({ sceneIndex: i, leadWords, matched: false });
      continue;
    }

    // Strict consecutive-word match scanning forward from cursor.
    const searchLimit = Math.min(whisperNorm.length, whisperCursor + 400);
    const match = strictConsecutiveMatch(
      leadWords,
      whisperNorm,
      whisperCursor,
      searchLimit,
    );
    if (match !== null) {
      matchedStartTimes[i] = match.matchTime;
      whisperCursor = match.matchIdx + 1; // advance past the real match
      matchDiagnostics.push({ sceneIndex: i, leadWords, matched: true });
    }

    if (matchedStartTimes[i] === null) {
      matchDiagnostics.push({ sceneIndex: i, leadWords, matched: false });
    }
  }

  // Count matches
  const matchedCount = matchedStartTimes.filter((t) => t !== null).length;
  const matchRate = matchedCount / sceneCount;

  // Log diagnostics
  console.log(
    `[Word-Aligned Pacing] Matched ${matchedCount}/${sceneCount} scenes (${(matchRate * 100).toFixed(1)}%)`,
  );
  matchDiagnostics.forEach(({ sceneIndex, leadWords, matched }) => {
    console.log(
      `  Scene ${sceneIndex}: [${leadWords.join(", ")}] → ${matched ? "✓" : "✗"}`,
    );
  });

  // ERROR if fewer than 50% matched — no silent fallback
  if (matchRate < 0.5) {
    const failedScenes = matchDiagnostics.filter((d) => !d.matched);
    const diagnosticReport = failedScenes
      .slice(0, 5) // Show first 5 failures
      .map((d) => {
        const whisperWindow = whisperNorm.slice(0, 10).map((w) => w.norm);
        return `  Scene ${d.sceneIndex}: Lead words [${d.leadWords.join(", ")}] not found in Whisper window [${whisperWindow.join(", ")}...]`;
      })
      .join("\n");

    throw new Error(
      `Word alignment failed: Only ${matchedCount}/${sceneCount} scenes (${(matchRate * 100).toFixed(1)}%) matched.\n` +
        `Require ≥50% match rate. Check for:\n` +
        `- Misspellings between script and TTS audio\n` +
        `- Numbers at paragraph start (now filtered but may indicate mismatch)\n` +
        `- Script text not present in audio\n\n` +
        `Failed scenes (first 5):\n${diagnosticReport}`,
    );
  }

  // Per-scene provenance for callers/QC: true = real Whisper anchor, false =
  // about to be linearly interpolated below. Computed from the raw match
  // attempts above (before the scene-0 pin), then scene 0 is forced to true
  // since its frame-0 start is a structural fact, not a guess.
  const sceneMatched: boolean[] = matchDiagnostics.map((d) => d.matched);

  // Always pin scene 0 to frame 0 (audio always starts at 0). The matched
  // lead-word position can land mid-scene when the paragraph begins with
  // filtered words (numbers, short particles), but the scene itself still
  // starts at the audio's first frame. The cursor has already advanced past
  // scene 0's real match, so subsequent scenes are unaffected.
  matchedStartTimes[0] = 0;
  sceneMatched[0] = true;

  // Interpolate unmatched scenes between surrounding matched scenes
  for (let i = 0; i < sceneCount; i++) {
    if (matchedStartTimes[i] !== null) continue;

    // Find prev and next matched
    let prevIdx = i - 1;
    while (prevIdx >= 0 && matchedStartTimes[prevIdx] === null) prevIdx--;
    let nextIdx = i + 1;
    while (nextIdx < sceneCount && matchedStartTimes[nextIdx] === null)
      nextIdx++;

    const prevTime = prevIdx >= 0 ? (matchedStartTimes[prevIdx] as number) : 0;
    const nextTime =
      nextIdx < sceneCount
        ? (matchedStartTimes[nextIdx] as number)
        : totalFrames / fps;
    const span = nextIdx - prevIdx;
    const step = (nextTime - prevTime) / span;
    matchedStartTimes[i] = prevTime + step * (i - prevIdx);
  }

  // Convert times to frame timings
  const timings: SceneTiming[] = [];
  for (let i = 0; i < sceneCount; i++) {
    const startFrame = Math.round((matchedStartTimes[i] as number) * fps);
    const endFrame =
      i === sceneCount - 1
        ? totalFrames
        : Math.round((matchedStartTimes[i + 1] as number) * fps);

    timings.push({
      scene_index: i,
      start_frame: startFrame,
      end_frame: endFrame,
      duration_frames: endFrame - startFrame,
      matched: sceneMatched[i] ?? false,
    });
  }

  // No min/max duration redistribution. Whisper is the source of truth — if a
  // scene's matched window is short (because the paragraph was actually read
  // quickly, or because two consecutive matches landed close) we keep it as-is.
  // Synthetic boosting + cumulative rebuild was the root cause of the 2026-06-17
  // CE desync, where scene 6 was Whisper-anchored at 47.72s but rendered at
  // 45.4s because the min-duration guard had rebuilt every start_frame as a
  // running sum of doctored durations. False-positive matches must be fixed at
  // the matcher (strictConsecutiveMatch), not papered over after the fact.
  return timings;
}

/**
 * One renderable image segment within a scene.
 * Represents a group of consecutive sentences sharing one B-roll image.
 * Frame values are ABSOLUTE (matching the global Remotion timeline).
 */
export interface SentenceSegmentTiming {
  group_index: number;
  /** Absolute frame where this image segment starts */
  start_frame: number;
  /** Absolute frame where this image segment ends (exclusive) */
  end_frame: number;
  duration_frames: number;
  /** True if this segment should render as a KEY_FACT text card */
  is_key_fact: boolean;
  key_fact_text: string | null;
  /** Layout type for this sentence (from composition plan) */
  layout_type: import("@repo/contracts").LayoutType;
  /**
   * True only when every sentence grouped into this segment resolved to a
   * real Whisper word-alignment match; false if any member sentence's start
   * time was linearly interpolated because its lead words weren't found in
   * the transcript. Lets QC/downstream code tell a real cut from a guess.
   */
  matched: boolean;
}

/**
 * Compute frame-accurate timings for sentence-level image segments within one scene.
 *
 * Algorithm:
 * 1. Filter Whisper words to the scene's time range.
 * 2. For each sentence_image, extract lead words and scan forward for a 2-word match.
 *    Single-word match used as fallback for very short clauses.
 * 3. Interpolate unmatched sentences uniformly between surrounding anchors.
 * 4. Group by group_index: start = first member's start, end = last member's end.
 * 5. Clamp all frames to [sceneStartFrame, sceneEndFrame].
 *
 * @returns One SentenceSegmentTiming per unique group_index, sorted ascending.
 */
export function computeSentenceImageTimings(
  sceneStartFrame: number,
  sceneEndFrame: number,
  sentenceImages: SentenceImage[],
  wordTimestamps: WordTimestamp[],
  fps: number,
): SentenceSegmentTiming[] {
  if (sentenceImages.length === 0) return [];

  const sceneStartSec = sceneStartFrame / fps;
  const sceneEndSec = sceneEndFrame / fps;

  // Narrow Whisper words to this scene's time range (with 0.5s padding for accuracy)
  const sceneWords = wordTimestamps.filter(
    (w) => w.end > sceneStartSec - 0.5 && w.start < sceneEndSec + 0.5,
  );
  const sceneWordsNorm = sceneWords.map((w) => ({
    norm: normalizeWord(w.word),
    start: w.start,
    end: w.end,
  }));

  // Per-sentence start-time matching using flexible word matching
  const sentenceStartTimes: (number | null)[] = new Array(
    sentenceImages.length,
  ).fill(null);
  const matchDiagnostics: Array<{
    sentenceIndex: number;
    leadWords: string[];
    matched: boolean;
  }> = [];
  let whisperCursor = 0;

  for (let i = 0; i < sentenceImages.length; i++) {
    const si = sentenceImages[i]!;
    const leads = extractLeadWords(si.sentence_text, 5);
    if (leads.length < 1) {
      matchDiagnostics.push({
        sentenceIndex: i,
        leadWords: leads,
        matched: false,
      });
      continue;
    }

    const scanLimit = Math.min(whisperCursor + 200, sceneWordsNorm.length);
    const match = strictConsecutiveMatch(
      leads,
      sceneWordsNorm,
      whisperCursor,
      scanLimit,
    );
    if (match !== null) {
      sentenceStartTimes[i] = Math.max(sceneStartSec, match.matchTime);
      whisperCursor = match.matchIdx + 1;
      matchDiagnostics.push({
        sentenceIndex: i,
        leadWords: leads,
        matched: true,
      });
    } else {
      matchDiagnostics.push({
        sentenceIndex: i,
        leadWords: leads,
        matched: false,
      });
    }
  }

  // Count matches (measured before the sentence-0 pin below, mirroring
  // computeWordAlignedPacing's gate — this is a signal of raw alignment
  // quality, not of whether sentence 0's frame is "known").
  const matchedCount = matchDiagnostics.filter((d) => d.matched).length;
  const matchRate = matchedCount / sentenceImages.length;

  console.log(
    `[Sentence-Image Pacing] Matched ${matchedCount}/${sentenceImages.length} sentences (${(matchRate * 100).toFixed(1)}%)`,
  );
  matchDiagnostics.forEach(({ sentenceIndex, leadWords, matched }) => {
    console.log(
      `  Sentence ${sentenceIndex}: [${leadWords.join(", ")}] → ${matched ? "✓" : "✗"}`,
    );
  });

  // ERROR if fewer than 50% matched — no silent fallback. Mirrors the gate
  // already established by computeWordAlignedPacing in this file for the
  // same class of failure (unmatched lead words -> would otherwise be
  // silently interpolated into plausible-looking but fabricated timings).
  if (matchRate < 0.5) {
    const failedSentences = matchDiagnostics.filter((d) => !d.matched);
    const diagnosticReport = failedSentences
      .slice(0, 5) // Show first 5 failures
      .map((d) => {
        const whisperWindow = sceneWordsNorm.slice(0, 10).map((w) => w.norm);
        return `  Sentence ${d.sentenceIndex}: Lead words [${d.leadWords.join(", ")}] not found in Whisper window [${whisperWindow.join(", ")}...]`;
      })
      .join("\n");

    throw new Error(
      `Sentence alignment failed: Only ${matchedCount}/${sentenceImages.length} sentences (${(matchRate * 100).toFixed(1)}%) matched.\n` +
        `Require ≥50% match rate. Check for:\n` +
        `- Misspellings between script and TTS audio\n` +
        `- Numbers at sentence start (now filtered but may indicate mismatch)\n` +
        `- Script text not present in audio\n\n` +
        `Failed sentences (first 5):\n${diagnosticReport}`,
    );
  }

  // Per-sentence provenance for callers/QC: true = real Whisper anchor,
  // false = about to be linearly interpolated below.
  const sentenceMatched: boolean[] = matchDiagnostics.map((d) => d.matched);

  // Always pin first sentence to scene start. The matched lead-word position
  // can land mid-sentence when the sentence begins with filtered words
  // (numbers, short particles); the sentence still starts at the scene
  // boundary. Cursor already advanced past the real match so later sentences
  // are unaffected. This is a structural fact, not a guess, so it's always
  // marked matched regardless of the raw match attempt above.
  sentenceStartTimes[0] = sceneStartSec;
  sentenceMatched[0] = true;

  // Forward interpolation: fill gaps between matched anchors
  for (let i = 1; i < sentenceImages.length; i++) {
    if (sentenceStartTimes[i] !== null) continue;
    let nextMatchIdx = sentenceImages.length;
    let nextMatchTime = sceneEndSec;
    for (let k = i + 1; k < sentenceImages.length; k++) {
      if (sentenceStartTimes[k] !== null) {
        nextMatchIdx = k;
        nextMatchTime = sentenceStartTimes[k]!;
        break;
      }
    }
    const prevTime = sentenceStartTimes[i - 1]!;
    const gapCount = nextMatchIdx - (i - 1);
    const step = (nextMatchTime - prevTime) / gapCount;
    for (let k = i; k < nextMatchIdx; k++) {
      sentenceStartTimes[k] = prevTime + step * (k - (i - 1));
    }
  }

  // Convert to absolute frame numbers
  const sentenceFrameStarts: number[] = sentenceStartTimes.map((t) =>
    Math.round(
      Math.max(
        sceneStartFrame,
        Math.min(sceneEndFrame - 1, (t ?? sceneStartSec) * fps),
      ),
    ),
  );
  const sentenceFrameEnds: number[] = sentenceImages.map((_, i) =>
    i + 1 < sentenceImages.length ? sentenceFrameStarts[i + 1]! : sceneEndFrame,
  );

  // Group by group_index
  const groupMap = new Map<
    number,
    {
      startFrame: number;
      endFrame: number;
      isKeyFact: boolean;
      keyFactText: string | null;
      layoutType: import("@repo/contracts").LayoutType;
      matched: boolean;
    }
  >();

  for (let i = 0; i < sentenceImages.length; i++) {
    const si = sentenceImages[i]!;
    const gIdx = si.group_index ?? i;
    const sf = sentenceFrameStarts[i]!;
    const ef = sentenceFrameEnds[i]!;
    const isMatched = sentenceMatched[i] ?? false;

    const existing = groupMap.get(gIdx);
    if (!existing) {
      groupMap.set(gIdx, {
        startFrame: sf,
        endFrame: ef,
        isKeyFact: si.is_key_fact ?? false,
        keyFactText: si.key_fact_text ?? null,
        layoutType: si.layout_type ?? "AVATAR_PIP", // Default to AVATAR_PIP if missing
        matched: isMatched,
      });
    } else {
      existing.endFrame = Math.max(existing.endFrame, ef);
      existing.matched = existing.matched && isMatched;
    }
  }

  return [...groupMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([gIdx, seg]) => ({
      group_index: gIdx,
      start_frame: seg.startFrame,
      end_frame: Math.max(seg.startFrame + 1, seg.endFrame),
      duration_frames: Math.max(1, seg.endFrame - seg.startFrame),
      is_key_fact: seg.isKeyFact,
      key_fact_text: seg.keyFactText,
      layout_type: seg.layoutType,
      matched: seg.matched,
    }));
}

/**
 * Enhanced sentence timing that accounts for pauses using onset detection.
 *
 * This function improves upon computeSentenceImageTimings() by:
 * 1. Using Whisper timestamps for approximate sentence starts (same as original)
 * 2. Refining those starts with audio onset detection to account for pauses
 * 3. Preventing audio/video drift caused by ignoring silence between sentences
 *
 * Problem:
 * - Whisper gives word timestamps but doesn't track pauses
 * - If sentence ends at 5.0s and next starts at 6.0s (1s pause), using 5.0s
 *   for the cut causes images to change before audio actually starts
 * - This accumulates drift (~8s by end of video)
 *
 * Solution:
 * - Detect silence periods in audio using FFmpeg silencedetect
 * - Use silence_end (audio onset) as the true sentence start time
 * - Snap Whisper timestamps to nearest detected onsets
 *
 * @param audioPath Path to TTS audio file for onset detection
 * @param onsetData Precomputed silence periods from detectSilencePeriods()
 *                  Pass null to skip onset refinement (fallback to Whisper only)
 * @param ... (same parameters as computeSentenceImageTimings)
 * @returns Sentence timings with refined start frames accounting for pauses
 */
export async function computeSentenceImageTimingsWithOnsets(
  audioPath: string | null,
  onsetData: Array<{ start: number; end: number; duration: number }> | null,
  sceneStartFrame: number,
  sceneEndFrame: number,
  sentenceImages: SentenceImage[],
  wordTimestamps: WordTimestamp[],
  fps: number,
): Promise<SentenceSegmentTiming[]> {
  if (sentenceImages.length === 0) return [];

  const sceneStartSec = sceneStartFrame / fps;
  const sceneEndSec = sceneEndFrame / fps;

  // Narrow Whisper words to this scene's time range
  const sceneWords = wordTimestamps.filter(
    (w) => w.end > sceneStartSec - 0.5 && w.start < sceneEndSec + 0.5,
  );
  const sceneWordsNorm = sceneWords.map((w) => ({
    norm: normalizeWord(w.word),
    start: w.start,
    end: w.end,
  }));

  // Step 1: Match sentences to Whisper words using flexible matching
  const sentenceStartTimes: (number | null)[] = new Array(
    sentenceImages.length,
  ).fill(null);
  const matchDiagnostics: Array<{
    sentenceIndex: number;
    leadWords: string[];
    matched: boolean;
  }> = [];
  let whisperCursor = 0;

  for (let i = 0; i < sentenceImages.length; i++) {
    const si = sentenceImages[i]!;
    const leads = extractLeadWords(si.sentence_text, 5);
    if (leads.length < 1) {
      matchDiagnostics.push({
        sentenceIndex: i,
        leadWords: leads,
        matched: false,
      });
      continue;
    }

    const scanLimit = Math.min(whisperCursor + 200, sceneWordsNorm.length);
    const match = strictConsecutiveMatch(
      leads,
      sceneWordsNorm,
      whisperCursor,
      scanLimit,
    );
    if (match !== null) {
      sentenceStartTimes[i] = Math.max(sceneStartSec, match.matchTime);
      whisperCursor = match.matchIdx + 1;
      matchDiagnostics.push({
        sentenceIndex: i,
        leadWords: leads,
        matched: true,
      });
    } else {
      matchDiagnostics.push({
        sentenceIndex: i,
        leadWords: leads,
        matched: false,
      });
    }
  }

  // Count matches (measured before onset refinement / the sentence-0 pin,
  // mirroring computeWordAlignedPacing's gate and computeSentenceImageTimings
  // above — a signal of raw alignment quality against the transcript).
  const matchedCount = matchDiagnostics.filter((d) => d.matched).length;
  const matchRate = matchedCount / sentenceImages.length;

  console.log(
    `[Onset Pacing] Matched ${matchedCount}/${sentenceImages.length} sentences (${(matchRate * 100).toFixed(1)}%)`,
  );
  matchDiagnostics.forEach(({ sentenceIndex, leadWords, matched }) => {
    console.log(
      `  Sentence ${sentenceIndex}: [${leadWords.join(", ")}] → ${matched ? "✓" : "✗"}`,
    );
  });

  // ERROR if fewer than 50% matched — no silent fallback. Same gate as
  // computeWordAlignedPacing / computeSentenceImageTimings for the same
  // class of failure.
  if (matchRate < 0.5) {
    const failedSentences = matchDiagnostics.filter((d) => !d.matched);
    const diagnosticReport = failedSentences
      .slice(0, 5) // Show first 5 failures
      .map((d) => {
        const whisperWindow = sceneWordsNorm.slice(0, 10).map((w) => w.norm);
        return `  Sentence ${d.sentenceIndex}: Lead words [${d.leadWords.join(", ")}] not found in Whisper window [${whisperWindow.join(", ")}...]`;
      })
      .join("\n");

    throw new Error(
      `Sentence alignment failed: Only ${matchedCount}/${sentenceImages.length} sentences (${(matchRate * 100).toFixed(1)}%) matched.\n` +
        `Require ≥50% match rate. Check for:\n` +
        `- Misspellings between script and TTS audio\n` +
        `- Numbers at sentence start (now filtered but may indicate mismatch)\n` +
        `- Script text not present in audio\n\n` +
        `Failed sentences (first 5):\n${diagnosticReport}`,
    );
  }

  // Per-sentence provenance for callers/QC: true = real Whisper anchor,
  // false = about to be linearly interpolated below.
  const sentenceMatched: boolean[] = matchDiagnostics.map((d) => d.matched);

  // Step 2: Refine matched times with onset detection (NEW)
  if (onsetData && onsetData.length > 0) {
    console.log(
      `[Onset Pacing] Refining ${sentenceStartTimes.filter((t) => t !== null).length} matched sentence starts with ${onsetData.length} detected onsets`,
    );

    for (let i = 0; i < sentenceStartTimes.length; i++) {
      const whisperTime = sentenceStartTimes[i];
      if (whisperTime === null) continue;

      // Find nearest onset (silence_end) near this Whisper time
      let nearestOnset: number | null = null;
      let minDistance = Infinity;

      for (const silence of onsetData) {
        // Only consider onsets before or very close to the Whisper time
        // (onsets after the word start don't make sense)
        if (silence.end > whisperTime + 1.0) continue;

        const distance = Math.abs(whisperTime - silence.end);
        if (distance < minDistance && distance < 1.0) {
          // Within 1 second
          minDistance = distance;
          nearestOnset = silence.end;
        }
      }

      // If we found a nearby onset, snap to it
      if (nearestOnset !== null) {
        const original = whisperTime;
        sentenceStartTimes[i] = nearestOnset;

        console.log(
          `[Onset Pacing] Sentence ${i}: ${original.toFixed(2)}s → ${nearestOnset.toFixed(2)}s (Δ${(nearestOnset - original).toFixed(2)}s)`,
        );
      }
    }
  } else {
    console.warn(
      "[Onset Pacing] No onset data provided - using Whisper timestamps only (may cause drift)",
    );
  }

  // Step 3: Same interpolation and grouping logic as original.
  // Sentence 0's start is always structurally correct (scene boundary),
  // whether it came from a real match, an onset snap, or the fallback pin
  // below — so it's always marked matched regardless of the raw attempt.
  if (sentenceStartTimes[0] === null) sentenceStartTimes[0] = sceneStartSec;
  sentenceMatched[0] = true;

  for (let i = 1; i < sentenceImages.length; i++) {
    if (sentenceStartTimes[i] !== null) continue;
    let nextMatchIdx = sentenceImages.length;
    let nextMatchTime = sceneEndSec;
    for (let k = i + 1; k < sentenceImages.length; k++) {
      if (sentenceStartTimes[k] !== null) {
        nextMatchIdx = k;
        nextMatchTime = sentenceStartTimes[k]!;
        break;
      }
    }
    const prevTime = sentenceStartTimes[i - 1]!;
    const gapCount = nextMatchIdx - (i - 1);
    const step = (nextMatchTime - prevTime) / gapCount;
    for (let k = i; k < nextMatchIdx; k++) {
      sentenceStartTimes[k] = prevTime + step * (k - (i - 1));
    }
  }

  const sentenceFrameStarts: number[] = sentenceStartTimes.map((t) =>
    Math.round(
      Math.max(
        sceneStartFrame,
        Math.min(sceneEndFrame - 1, (t ?? sceneStartSec) * fps),
      ),
    ),
  );
  const sentenceFrameEnds: number[] = sentenceImages.map((_, i) =>
    i + 1 < sentenceImages.length ? sentenceFrameStarts[i + 1]! : sceneEndFrame,
  );

  const groupMap = new Map<
    number,
    {
      startFrame: number;
      endFrame: number;
      isKeyFact: boolean;
      keyFactText: string | null;
      layoutType: import("@repo/contracts").LayoutType;
      matched: boolean;
    }
  >();

  for (let i = 0; i < sentenceImages.length; i++) {
    const si = sentenceImages[i]!;
    const gIdx = si.group_index ?? i;
    const sf = sentenceFrameStarts[i]!;
    const ef = sentenceFrameEnds[i]!;
    const isMatched = sentenceMatched[i] ?? false;

    const existing = groupMap.get(gIdx);
    if (!existing) {
      groupMap.set(gIdx, {
        startFrame: sf,
        endFrame: ef,
        isKeyFact: si.is_key_fact ?? false,
        keyFactText: si.key_fact_text ?? null,
        layoutType: si.layout_type ?? "AVATAR_PIP",
        matched: isMatched,
      });
    } else {
      existing.endFrame = Math.max(existing.endFrame, ef);
      existing.matched = existing.matched && isMatched;
    }
  }

  return [...groupMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([gIdx, seg]) => ({
      group_index: gIdx,
      start_frame: seg.startFrame,
      end_frame: Math.max(seg.startFrame + 1, seg.endFrame),
      duration_frames: Math.max(1, seg.endFrame - seg.startFrame),
      is_key_fact: seg.isKeyFact,
      key_fact_text: seg.keyFactText,
      layout_type: seg.layoutType,
      matched: seg.matched,
    }));
}
