import type { WordTimestamp, ChunkerOptions } from "../types.js";
import type { RemotionSubtitleConfig } from "@repo/db";

/**
 * Build WordTimestamp[] from a list of tokens. By default each word is 0.4s
 * long with a 0.1s gap (0.5s stride). Pass explicit timings via the 2-tuple
 * form when a test needs custom gaps.
 */
export function mkWords(
  tokens: string[],
  opts: { stride?: number; dur?: number; startOffset?: number } = {},
): WordTimestamp[] {
  const stride = opts.stride ?? 0.5;
  const dur = opts.dur ?? 0.4;
  const startOffset = opts.startOffset ?? 0;
  return tokens.map((word, i) => ({
    word,
    start: startOffset + i * stride,
    end: startOffset + i * stride + dur,
  }));
}

/** Build words with explicit [word, start, end] triples. */
export function mkWordsExact(
  triples: Array<[string, number, number]>,
): WordTimestamp[] {
  return triples.map(([word, start, end]) => ({ word, start, end }));
}

export const defaultChunkerOptions: ChunkerOptions = {
  wordsPerChunk: 4,
  oneWordMode: { pairShortWords: false, shortWordMaxLen: 3 },
  punctuationMode: "all",
  textCase: "asIs",
  breakLines: false,
  maxLines: 2,
  gapFree: false,
  smartSplit: false,
  largeSilenceThresholdMs: 600,
};

export function makeChunkerOptions(
  overrides: Partial<ChunkerOptions> = {},
): ChunkerOptions {
  return {
    ...defaultChunkerOptions,
    ...overrides,
    oneWordMode: {
      ...defaultChunkerOptions.oneWordMode,
      ...(overrides.oneWordMode ?? {}),
    },
  };
}

/** A full RemotionSubtitleConfig for plan-level tests, tweakable via overrides. */
export function makeRemotionConfig(
  overrides: Partial<RemotionSubtitleConfig> = {},
): RemotionSubtitleConfig {
  const base: RemotionSubtitleConfig = {
    schemaVersion: 2,
    fontId: null,
    fontFamily: "Inter",
    fontWeight: 700,
    textCase: "asIs",
    fontSize: 64,
    fontColor: "#FFFFFF",
    stroke: { color: "#000000", width: 8 },
    shadow: {
      color: "#000000",
      blur: 0,
      strength: 0,
      size: 0,
      offsetX: 0,
      offsetY: 0,
      curve: "linear",
    },
    secondaryFont: null,
    wordsPerChunk: 4,
    oneWordMode: { pairShortWords: false, shortWordMaxLen: 3 },
    positionX: 50,
    positionY: 50,
    positionPreset: "bottom",
    alignment: "center",
    maxWidthPercent: 82,
    safeMarginPercent: 10,
    sizeMode: "canvasRelative",
    punctuationMode: "all",
    breakLines: false,
    maxLines: 2,
    gapFree: false,
    smartSplit: false,
    keyword: {
      enabled: false,
      wordClasses: ["noun", "verb"],
      aggressiveness: 40,
      colors: ["#FFD400", "#00E0FF", "#FF3D71"],
      bold: true,
      italic: false,
      background: null,
    },
    animation: {
      enabled: true,
      caption: "none",
      word: "fadeInFast",
      variants: false,
      durationFrames: 6,
      activeWordScale: 1.1,
      activeWordColor: null,
    },
    background: {
      enabled: false,
      color: "#000000",
      radius: 8,
      paddingX: 12,
      paddingY: 8,
    },
    videoBackgroundColor: null,
    speakers: null,
  };
  return { ...base, ...overrides };
}
