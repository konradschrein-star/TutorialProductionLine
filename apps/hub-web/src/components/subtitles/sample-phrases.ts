// Canned sample word-timings for the live subtitle preview. Each is a realistic
// WordTimestamp[] (seconds) over ~4-8s so the @remotion/player preview shows the
// same segmentation the real render would produce. Consumed by LivePreview via
// buildCaptionPlan(SAMPLE_WORDS[key], config).

import type { WordTimestamp } from "@repo/media-core/subtitles/remotion";

export type SamplePhraseKey = "short" | "long" | "punctuation" | "multiSpeaker";

/**
 * A sample word may carry a 0-based `speakerIndex` (multiSpeaker sample only).
 * Registry ids are user-generated (Task 9a), so the sample can't hardcode a
 * real speakerId — LivePreview maps `speakerIndex` -> `config.speakers.registry
 * [speakerIndex]?.id` at preview time and only then produces a real
 * WordTimestamp.speakerId for buildCaptionPlan.
 */
export interface SampleWord extends WordTimestamp {
  speakerIndex?: number;
}

export interface SamplePhrase {
  key: SamplePhraseKey;
  label: string;
  words: SampleWord[];
}

/**
 * Build a sequence of evenly-timed words from a plain sentence. Each word gets
 * `dur` seconds; a small inter-word gap keeps timings realistic without gaps
 * large enough to force a chunk break (>600ms). `speakerIndex`, when given, is
 * stamped on every word (used to build the multi-speaker dialogue sample).
 */
function timeline(
  sentence: string,
  startAt = 0.2,
  dur = 0.34,
  speakerIndex?: number,
): SampleWord[] {
  const tokens = sentence.split(/\s+/).filter(Boolean);
  const out: SampleWord[] = [];
  let t = startAt;
  for (const word of tokens) {
    const start = t;
    const end = t + dur;
    out.push({
      word,
      start,
      end,
      ...(speakerIndex !== undefined ? { speakerIndex } : {}),
    });
    t = end + 0.06; // 60ms gap — well under the 600ms silence threshold
  }
  return out;
}

/**
 * Two-speaker dialogue: first clause is speakerIndex 0, second is speakerIndex
 * 1, separated by a pause under the large-silence threshold so it still reads
 * as one flowing exchange in the preview.
 */
function dialogue(): SampleWord[] {
  const first = timeline("So what do you think?", 0.2, 0.34, 0);
  const gapStart = first[first.length - 1]!.end + 0.4;
  const second = timeline(
    "Well, I think it looks incredible, honestly the best yet.",
    gapStart,
    0.34,
    1,
  );
  return [...first, ...second];
}

export const SAMPLE_PHRASES: SamplePhrase[] = [
  {
    key: "short",
    label: "Short",
    words: timeline("This is a quick caption preview"),
  },
  {
    key: "long",
    label: "Long",
    words: timeline(
      "The quick brown fox jumps over the lazy dog while everyone watches in total silence",
    ),
  },
  {
    key: "punctuation",
    label: "Punctuation",
    words: timeline(
      "Wait, really? That is amazing! I cannot believe it worked... honestly, wow.",
    ),
  },
  {
    key: "multiSpeaker",
    label: "Dialogue",
    words: dialogue(),
  },
];

export const SAMPLE_PHRASE_MAP: Record<SamplePhraseKey, SamplePhrase> =
  Object.fromEntries(SAMPLE_PHRASES.map((p) => [p.key, p])) as Record<
    SamplePhraseKey,
    SamplePhrase
  >;
