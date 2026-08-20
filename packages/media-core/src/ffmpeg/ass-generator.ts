import { writeFile } from "node:fs/promises";
import type { WhisperWord } from "../whisper/types.js";

// ASS color format: &HAABBGGRR& (alpha, blue, green, red)
const LIME_ASS = "&H0000FFAA&"; // #AAFF00
const WHITE_ASS = "&H00FFFFFF&"; // #FFFFFF
const YELLOW_ASS = "&H0000FFFF&"; // #FFFF00
const BLACK_ASS = "&H00000000&"; // #000000
const WHITE_OUTLINE = "&H00FFFFFF&";
const BLACK_OUTLINE = "&H00000000&";

export type SubtitleColorScheme = "white_black" | "yellow_black" | "black";

interface ColorPalette {
  primary: string; // base text color (non-highlighted words)
  karaoke: string; // color of the currently highlighted word
  outline: string; // text outline color
}

const COLOR_SCHEMES: Record<SubtitleColorScheme, ColorPalette> = {
  white_black: {
    primary: WHITE_ASS,
    karaoke: LIME_ASS,
    outline: BLACK_OUTLINE,
  },
  yellow_black: {
    primary: YELLOW_ASS,
    karaoke: WHITE_ASS,
    outline: BLACK_OUTLINE,
  },
  black: { primary: BLACK_ASS, karaoke: LIME_ASS, outline: WHITE_OUTLINE },
};

export interface ASSCaptionOptions {
  /** Words to show per display window. Default: 6 */
  windowSize?: number;
  /** Font family. Default: "Arial" */
  fontFamily?: string;
  /** Font size in points. Default: 72 */
  fontSize?: number;
  /** Color scheme. Default: "white_black" */
  colorScheme?: SubtitleColorScheme;
  /** Vertical position from bottom as percentage. Default: 15 */
  verticalOffsetPercent?: number;
  /** Outline width in pixels. Default: 4 */
  outlineWidth?: number;
  /** Output resolution width. Default: 1920 */
  width?: number;
  /** Output resolution height. Default: 1080 */
  height?: number;
  /**
   * Visual cut times in seconds. Subtitle blocks are forced to split at these
   * boundaries so no words from the next scene appear in the previous block.
   */
  sceneCutTimes?: number[];
}

/**
 * Generate an ASS subtitle file from Whisper word timestamps.
 *
 * Words are grouped into static blocks (size = windowSize). Each block
 * stays on screen, with the current word highlighted using karaoke-style
 * timing. Subtitle blocks never span visual image transitions.
 */
export async function generateASSFile(
  words: WhisperWord[],
  outputPath: string,
  options?: ASSCaptionOptions,
): Promise<void> {
  const content = buildASSContent(words, options);
  await writeFile(outputPath, content, "utf-8");
}

// ─── Internal ────────────────────────────────────────────────────────────────

function buildASSContent(
  words: WhisperWord[],
  options?: ASSCaptionOptions,
): string {
  const windowSize = options?.windowSize ?? 6;
  const fontFamily = options?.fontFamily ?? "Arial";
  const fontSize = options?.fontSize ?? 72;
  const colorScheme = options?.colorScheme ?? "white_black";
  const verticalOffsetPercent = options?.verticalOffsetPercent ?? 15;
  const outlineWidth = options?.outlineWidth ?? 4;
  const width = options?.width ?? 1920;
  const height = options?.height ?? 1080;
  const sceneCutTimes = options?.sceneCutTimes ?? [];
  const palette = COLOR_SCHEMES[colorScheme];

  const lines: string[] = [
    buildASSHeader(
      width,
      height,
      fontSize,
      fontFamily,
      outlineWidth,
      verticalOffsetPercent,
      palette,
    ),
    ...buildDialogues(words, windowSize, sceneCutTimes, palette),
    "",
  ];

  return lines.join("\n");
}

function buildASSHeader(
  width: number,
  height: number,
  fontSize: number,
  fontFamily: string,
  outlineWidth: number,
  verticalOffsetPercent: number,
  palette: ColorPalette,
): string {
  const marginV = Math.round((verticalOffsetPercent / 100) * height);

  return (
    `[Script Info]\n` +
    `ScriptType: v4.00+\n` +
    `Collisions: Normal\n` +
    `PlayResX: ${width}\n` +
    `PlayResY: ${height}\n` +
    `Timer: 100.0000\n` +
    `\n` +
    `[V4+ Styles]\n` +
    `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Default,${fontFamily},${fontSize},${palette.primary},${palette.karaoke},${palette.outline},&HA0000000,-1,0,0,0,100,100,0,0,1,${outlineWidth},2,2,80,80,${marginV},1\n` +
    `\n` +
    `[Events]\n` +
    `Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`
  );
}

function buildDialogues(
  words: WhisperWord[],
  windowSize: number,
  cutTimes: number[],
  palette: ColorPalette,
): string[] {
  if (words.length === 0) return [];

  // Determine which word indices must end a block (forced cuts).
  // For each cut time, find the last word whose start is before the cut —
  // that word is the final word of its subtitle block.
  const forcedSplitAfter = new Set<number>();
  for (const cut of cutTimes) {
    for (let i = words.length - 1; i >= 0; i--) {
      if (words[i]!.start < cut) {
        if (i < words.length - 1) forcedSplitAfter.add(i);
        break;
      }
    }
  }

  const dialogues: string[] = [];
  let blockStart = 0;

  while (blockStart < words.length) {
    // Advance until windowSize OR a forced split, whichever comes first
    let blockEnd = blockStart;
    let count = 0;
    while (blockEnd < words.length) {
      count++;
      const isForced = forcedSplitAfter.has(blockEnd);
      blockEnd++;
      if (isForced || count >= windowSize) break;
    }

    const blockWords = words.slice(blockStart, blockEnd);
    const startTime = blockWords[0]!.start;
    const endTime = blockWords[blockWords.length - 1]!.end;

    if (endTime > startTime) {
      const textParts: string[] = [];

      for (let i = 0; i < blockWords.length; i++) {
        const word = blockWords[i]!;
        const durationCs = Math.max(
          1,
          Math.round((word.end - word.start) * 100),
        );

        if (i === 0) {
          // First word starts highlighted, then resets to primary color
          textParts.push(
            `{\\c${palette.karaoke}\\k${durationCs}}${word.word}{\\c${palette.primary}}`,
          );
        } else {
          textParts.push(`{\\k${durationCs}}${word.word}`);
        }
      }

      dialogues.push(
        `Dialogue: 0,${formatTime(startTime)},${formatTime(endTime)},Default,,0,0,0,,{\\an2}${textParts.join(" ")}`,
      );
    }

    blockStart = blockEnd;
  }

  return dialogues;
}

/** Format seconds as H:MM:SS.CC (ASS centisecond precision). */
function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.round((seconds % 1) * 100);
  return (
    `${h}:` +
    `${String(m).padStart(2, "0")}:` +
    `${String(s).padStart(2, "0")}.` +
    `${String(cs).padStart(2, "0")}`
  );
}
