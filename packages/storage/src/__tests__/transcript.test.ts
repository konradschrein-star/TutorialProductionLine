import { describe, it, expect } from "vitest";
import {
  buildTranscriptDoc,
  transcriptToSrt,
  formatSrtTimestamp,
  wordCount,
  TranscriptUnavailableError,
} from "../transcript.js";

describe("buildTranscriptDoc", () => {
  it("builds a word-level transcript from whisper timings", () => {
    const doc = buildTranscriptDoc({
      jobId: "j1",
      language: "en",
      words: [
        { word: "why", start: 0.1, end: 0.3 },
        { word: "cats", start: 0.3, end: 0.6 },
      ],
    });
    expect(doc.source).toBe("whisper_word_timestamps");
    expect(doc.text).toBe("why cats");
    expect(doc.words).toHaveLength(2);
    expect(doc.duration_seconds).toBe(0.6);
  });

  it("builds a script-exact transcript for tutorials (no timings)", () => {
    const doc = buildTranscriptDoc({
      jobId: "t1",
      language: "en",
      scriptText: "Open the terminal and type ls.",
    });
    expect(doc.source).toBe("tts_script_exact");
    expect(doc.text).toBe("Open the terminal and type ls.");
    expect(doc.words).toBeUndefined();
  });

  it("prefers word timings over script when both exist", () => {
    const doc = buildTranscriptDoc({
      jobId: "j2",
      language: "en",
      words: [{ word: "hi", start: 0, end: 0.2 }],
      scriptText: "different text",
    });
    expect(doc.source).toBe("whisper_word_timestamps");
  });

  it("THROWS rather than emit an empty transcript", () => {
    expect(() =>
      buildTranscriptDoc({ jobId: "empty", language: "en" }),
    ).toThrow(TranscriptUnavailableError);
    expect(() =>
      buildTranscriptDoc({ jobId: "empty", language: "en", scriptText: "  " }),
    ).toThrow(TranscriptUnavailableError);
  });

  it("ignores malformed word entries", () => {
    const doc = buildTranscriptDoc({
      jobId: "j3",
      language: "en",
      // @ts-expect-error deliberately malformed
      words: [{ word: "ok", start: 0, end: 1 }, { nope: true }],
    });
    expect(doc.words).toHaveLength(1);
  });
});

describe("transcriptToSrt", () => {
  it("chunks words into cues", () => {
    const doc = buildTranscriptDoc({
      jobId: "j",
      language: "en",
      words: Array.from({ length: 25 }, (_, i) => ({
        word: `w${i}`,
        start: i,
        end: i + 0.5,
      })),
    });
    const srt = transcriptToSrt(doc, { maxWords: 10, maxSeconds: 100 });
    expect(srt).not.toBeNull();
    // 25 words / 10 per cue => 3 cues
    expect(srt!.trim().split(/\n\n/).length).toBe(3);
    expect(srt).toContain("00:00:00,000 -->");
  });

  it("returns null for a script-only transcript (no timings to render)", () => {
    const doc = buildTranscriptDoc({
      jobId: "t",
      language: "en",
      scriptText: "no timings here",
    });
    expect(transcriptToSrt(doc)).toBeNull();
  });

  it("uses sentence timings when present", () => {
    const doc = buildTranscriptDoc({
      jobId: "j",
      language: "en",
      words: [{ word: "hi", start: 0, end: 1 }],
      sentences: [
        { text: "Hello there.", start: 0, end: 2 },
        { text: "General Kenobi.", start: 2, end: 4 },
      ],
    });
    const srt = transcriptToSrt(doc);
    expect(srt).toContain("Hello there.");
    expect(srt).toContain("General Kenobi.");
  });
});

describe("formatSrtTimestamp", () => {
  it("formats HH:MM:SS,mmm", () => {
    expect(formatSrtTimestamp(0)).toBe("00:00:00,000");
    expect(formatSrtTimestamp(3661.5)).toBe("01:01:01,500");
    expect(formatSrtTimestamp(-5)).toBe("00:00:00,000");
  });
});

describe("wordCount", () => {
  it("counts words array when present", () => {
    const doc = buildTranscriptDoc({
      jobId: "j",
      language: "en",
      words: [
        { word: "a", start: 0, end: 1 },
        { word: "b", start: 1, end: 2 },
      ],
    });
    expect(wordCount(doc)).toBe(2);
  });
  it("counts script text words otherwise", () => {
    const doc = buildTranscriptDoc({
      jobId: "j",
      language: "en",
      scriptText: "one two three",
    });
    expect(wordCount(doc)).toBe(3);
  });
});
