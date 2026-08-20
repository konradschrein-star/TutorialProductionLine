/**
 * YouTube Chapter Builder
 *
 * Pure function — no IO, no side effects.
 *
 * Converts word-level Whisper timestamps + scene data into YouTube chapter
 * markers ready for embedding in a video description.
 *
 * Phase 2 status: fully implemented, not yet wired into the pipeline.
 * Activation requires word_timestamps to be reliably populated in
 * assembly_manifest by the render worker (already the case for V2 renders).
 *
 * YouTube chapter requirements:
 * - First chapter must start at 0:00
 * - Minimum 3 chapters total
 * - Each chapter must be at least 10 seconds long
 * - Format in description: "0:00 Chapter Title"
 */

import type { WordTimestamp, YouTubeChapter } from "./types.js";
import { normalizeWord } from "@repo/domain";

interface SceneForChapter {
  scene_index: number;
  paragraph: string;
}

const MIN_CHAPTERS = 3;
const MIN_CHAPTER_GAP_SECONDS = 10;
const CHAPTER_TITLE_MAX_CHARS = 50;
const WORD_MATCH_LOOKAHEAD = 5; // number of meaningful words to match per scene

/**
 * Build YouTube chapter markers from word-level transcript and scenes.
 *
 * Returns an empty array if the input doesn't meet YouTube's requirements
 * (fewer than 3 chapters, insufficient transcript data, etc.).
 */
export function buildChapters(
  transcript: WordTimestamp[],
  scenes: SceneForChapter[],
): YouTubeChapter[] {
  if (transcript.length === 0 || scenes.length < MIN_CHAPTERS) {
    return [];
  }

  const chapters: YouTubeChapter[] = [];

  for (const scene of scenes) {
    const startSeconds = findSceneStartSeconds(transcript, scene.paragraph);
    if (startSeconds === null) continue;

    // Enforce minimum gap from previous chapter
    const prev = chapters[chapters.length - 1];
    if (prev !== undefined) {
      const prevSeconds = parseTimestamp(prev.timestamp);
      if (startSeconds - prevSeconds < MIN_CHAPTER_GAP_SECONDS) continue;
    }

    const title = extractChapterTitle(scene.paragraph);
    chapters.push({
      timestamp: formatTimestamp(startSeconds),
      title,
    });
  }

  // YouTube requires the first chapter to start at 0:00
  if (chapters.length > 0 && chapters[0]!.timestamp !== "0:00") {
    chapters.unshift({ timestamp: "0:00", title: "Intro" });
  }

  // Drop the list entirely if we can't meet the 3-chapter minimum
  if (chapters.length < MIN_CHAPTERS) {
    return [];
  }

  return chapters;
}

/**
 * Format a chapters list for embedding in a YouTube description.
 * Returns an empty string if chapters is empty.
 */
export function formatChaptersForDescription(
  chapters: YouTubeChapter[],
): string {
  if (chapters.length === 0) return "";
  return chapters.map((c) => `${c.timestamp} ${c.title}`).join("\n");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Find the start timestamp in seconds for the given paragraph by matching
 * its first meaningful words against the Whisper transcript.
 */
function findSceneStartSeconds(
  transcript: WordTimestamp[],
  paragraph: string,
): number | null {
  const targetWords = extractMeaningfulWords(paragraph).slice(
    0,
    WORD_MATCH_LOOKAHEAD,
  );
  if (targetWords.length === 0) return null;

  let bestIdx = -1;
  let bestScore = 0;

  for (let i = 0; i <= transcript.length - targetWords.length; i++) {
    let score = 0;
    for (let j = 0; j < targetWords.length; j++) {
      const tw = normalizeWord(transcript[i + j]?.word ?? "");
      if (tw === targetWords[j]) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
    // Early exit on perfect match
    if (score === targetWords.length) break;
  }

  // Require at least half the target words to match
  if (bestScore < Math.ceil(targetWords.length / 2)) return null;

  return transcript[bestIdx]?.start ?? null;
}

function extractMeaningfulWords(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normalizeWord)
    .filter((w) => w.length > 3); // skip short filler words
}

function extractChapterTitle(paragraph: string): string {
  // Use the first sentence, clamped to CHAPTER_TITLE_MAX_CHARS
  const firstSentence = paragraph.split(/[.!?]/)[0]?.trim() ?? "";
  if (firstSentence.length <= CHAPTER_TITLE_MAX_CHARS) return firstSentence;

  // Truncate at word boundary
  const truncated = firstSentence.slice(0, CHAPTER_TITLE_MAX_CHARS).trimEnd();
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > CHAPTER_TITLE_MAX_CHARS * 0.6
    ? truncated.slice(0, lastSpace).trimEnd()
    : truncated;
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function parseTimestamp(ts: string): number {
  const parts = ts.split(":").map(Number);
  if (parts.length === 3) {
    return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  }
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}
