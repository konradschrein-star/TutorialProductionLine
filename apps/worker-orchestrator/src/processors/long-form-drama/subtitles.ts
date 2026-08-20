import { writeFile } from "node:fs/promises";
import type { WordTiming } from "./prompt-gen-utils.js";

// WrapStyle 2 = no automatic wrapping; each Dialogue line is exactly one visible line.
// Alignment 2 = center-bottom. Spacing 0. Shadow 1 for readability.
const ASS_HEADER = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Montserrat,52,&H00FFFFFF,&H000000FF,&H00000000,&HAA000000,1,0,0,0,100,100,0,0,1,3,1,2,160,160,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

function msToAssTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const centiseconds = Math.floor((ms % 1000) / 10);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

/**
 * Group word timings into single-line subtitle chunks.
 *
 * Rules:
 * - Soft max 8 words per line (room at 52pt in 1920px without wrapping).
 * - Prefer breaking AFTER sentence-ending punctuation (.!?) when possible.
 * - Never strand a 1-word orphan in the next group — when we'd hit max but
 *   only one word remains in the whole sequence, take it into this line
 *   instead of splitting. Same protection for the other break paths.
 * - Hard max 12 words to bound libass wrap risk.
 * - Large gaps between words (>600ms) trigger a break only if it won't orphan.
 */
function groupIntoLines(
  words: WordTiming[],
): Array<{ startMs: number; endMs: number; text: string }> {
  const SOFT_MAX_WORDS = 8;
  const HARD_MAX_WORDS = 12;
  const MIN_LINE_WORDS = 2;
  const MAX_GAP_MS = 600;
  const sentenceEnder = /[.!?]$/; // strict — commas/semicolons no longer force breaks

  const lines: Array<{ startMs: number; endMs: number; text: string }> = [];
  let lineWords: WordTiming[] = [];

  const flush = () => {
    if (lineWords.length === 0) return;
    const first = lineWords[0]!;
    const last = lineWords[lineWords.length - 1]!;
    lines.push({
      startMs: first.start_ms,
      endMs: last.end_ms,
      text: lineWords
        .map((w) => w.word)
        .join(" ")
        .trim(),
    });
    lineWords = [];
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const next = words[i + 1];

    lineWords.push(word);

    const isLast = i === words.length - 1;
    const bigGapAfter = next ? next.start_ms - word.end_ms > MAX_GAP_MS : false;
    const atSentenceEnd = sentenceEnder.test(word.word.trim());
    const atSoftMax = lineWords.length >= SOFT_MAX_WORDS;
    const atHardMax = lineWords.length >= HARD_MAX_WORDS;

    // Orphan = the next line would be too short to read on its own.
    const wordsRemaining = words.length - i - 1;
    const willOrphan = wordsRemaining > 0 && wordsRemaining < MIN_LINE_WORDS;

    if (isLast) {
      flush();
    } else if (atHardMax) {
      // Hard cap — break regardless; better an orphan than a wrapped line.
      flush();
    } else if (
      atSentenceEnd &&
      lineWords.length >= MIN_LINE_WORDS &&
      !willOrphan
    ) {
      // Natural sentence end — best break point.
      flush();
    } else if (atSoftMax && !willOrphan) {
      // Past soft cap and the next group will be readable — break.
      flush();
    } else if (
      bigGapAfter &&
      lineWords.length >= MIN_LINE_WORDS &&
      !willOrphan
    ) {
      // Long speech pause and the next group will be readable.
      flush();
    }
    // Otherwise keep accumulating — better a slightly long line than an orphan.
  }

  return lines;
}

export async function generateAssFile(
  wordTimings: WordTiming[],
  outputPath: string,
): Promise<void> {
  const lines = groupIntoLines(wordTimings);
  const events = lines
    .map((line, i) => {
      const nextLine = lines[i + 1];
      // Never let a cue overlap the next one — libass stacks overlapping cues
      // which causes subtitles to jump between bottom and middle positions.
      const endMs = nextLine
        ? Math.min(line.endMs + 150, nextLine.startMs - 1)
        : line.endMs + 150;
      const start = msToAssTime(line.startMs);
      const end = msToAssTime(endMs);
      return `Dialogue: 0,${start},${end},Default,,0,0,0,,${line.text}`;
    })
    .join("\n");
  await writeFile(outputPath, ASS_HEADER + events);
}
