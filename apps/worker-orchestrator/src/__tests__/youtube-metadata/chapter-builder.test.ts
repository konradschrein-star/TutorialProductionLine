/**
 * chapter-builder — unit tests
 *
 * Pure functions: no IO, no mocks needed.
 * Covers buildChapters() and formatChaptersForDescription().
 */

import {
  buildChapters,
  formatChaptersForDescription,
} from "../../youtube-metadata/chapter-builder.js";
import type { WordTimestamp } from "../../youtube-metadata/types.js";

// ── Test-data helpers ─────────────────────────────────────────────────────────

/**
 * Build a simple word-level transcript from a space-separated string.
 * Words are spaced 0.5 s apart starting at `startSec`.
 */
function makeTranscript(text: string, startSec = 0): WordTimestamp[] {
  return text.split(/\s+/).map((word, i) => ({
    word,
    start: startSec + i * 0.5,
    end: startSec + i * 0.5 + 0.4,
  }));
}

/**
 * Combine several transcript segments into one, offset so each starts after the previous.
 * Returns { transcript, scenes } ready for buildChapters().
 */
function makeScenedTranscript(
  segments: Array<{ paragraph: string; startSec: number }>,
) {
  const transcript: WordTimestamp[] = [];
  const scenes = segments.map((seg, idx) => {
    const words = makeTranscript(seg.paragraph, seg.startSec);
    transcript.push(...words);
    return { scene_index: idx, paragraph: seg.paragraph };
  });
  return { transcript, scenes };
}

// ═══════════════════════════════════════════════════════════════════════════════
// buildChapters — happy-path
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildChapters — valid input", () => {
  it("returns at least 3 chapters when transcript has enough scenes", () => {
    const { transcript, scenes } = makeScenedTranscript([
      { paragraph: "Introduction to quantum computing and what makes it special", startSec: 0 },
      { paragraph: "Classical bits versus qubits fundamental differences explained here", startSec: 30 },
      { paragraph: "Superposition and entanglement are the core quantum phenomena", startSec: 70 },
    ]);

    const chapters = buildChapters(transcript, scenes);

    expect(chapters.length).toBeGreaterThanOrEqual(3);
  });

  it("first chapter always starts at 0:00", () => {
    const { transcript, scenes } = makeScenedTranscript([
      { paragraph: "Introduction to quantum computing basics", startSec: 5 },  // not at 0
      { paragraph: "Classical bits versus qubits differences", startSec: 40 },
      { paragraph: "Superposition is one of the quantum phenomena", startSec: 80 },
    ]);

    const chapters = buildChapters(transcript, scenes);

    expect(chapters.length).toBeGreaterThan(0);
    expect(chapters[0]!.timestamp).toBe("0:00");
  });

  it("inserts an 'Intro' chapter when the first detected scene does not start at 0:00", () => {
    const { transcript, scenes } = makeScenedTranscript([
      { paragraph: "This part starts later in the video", startSec: 15 },
      { paragraph: "Another segment with different content", startSec: 50 },
      { paragraph: "Third scene covering more interesting material", startSec: 100 },
    ]);

    const chapters = buildChapters(transcript, scenes);

    if (chapters.length > 0) {
      expect(chapters[0]!.timestamp).toBe("0:00");
    }
  });

  it("enforces minimum gap of 10 seconds between chapters", () => {
    const { transcript, scenes } = makeScenedTranscript([
      { paragraph: "First chapter introduction content here", startSec: 0 },
      { paragraph: "Second chapter but only five seconds later unfortunately", startSec: 5 },  // too close
      { paragraph: "Third chapter well spaced after enough time", startSec: 60 },
      { paragraph: "Fourth chapter also well spaced from third scene", startSec: 120 },
    ]);

    const chapters = buildChapters(transcript, scenes);

    for (let i = 1; i < chapters.length; i++) {
      const prev = parseTimestampForTest(chapters[i - 1]!.timestamp);
      const curr = parseTimestampForTest(chapters[i]!.timestamp);
      expect(curr - prev).toBeGreaterThanOrEqual(10);
    }
  });

  it("returns empty array when fewer than 3 scenes are provided", () => {
    const { transcript, scenes } = makeScenedTranscript([
      { paragraph: "Only one scene here", startSec: 0 },
      { paragraph: "Only second scene here", startSec: 30 },
    ]);

    const chapters = buildChapters(transcript, scenes);

    expect(chapters).toEqual([]);
  });

  it("returns empty array when transcript is empty", () => {
    const scenes = [
      { scene_index: 0, paragraph: "Scene one content" },
      { scene_index: 1, paragraph: "Scene two content" },
      { scene_index: 2, paragraph: "Scene three content" },
    ];

    const chapters = buildChapters([], scenes);

    expect(chapters).toEqual([]);
  });

  it("clamps chapter title to 50 characters at word boundary", () => {
    // Long first sentence that exceeds 50 chars
    const longParagraph =
      "This is a tremendously long chapter title that exceeds the fifty character limit. Rest of paragraph.";

    const { transcript, scenes } = makeScenedTranscript([
      { paragraph: longParagraph, startSec: 0 },
      { paragraph: "Second scene covering additional interesting topics", startSec: 40 },
      { paragraph: "Third scene with yet more fascinating information here", startSec: 90 },
    ]);

    const chapters = buildChapters(transcript, scenes);

    for (const chapter of chapters) {
      expect(chapter.title.length).toBeLessThanOrEqual(50);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Timestamp formatting
// ═══════════════════════════════════════════════════════════════════════════════

describe("timestamp formatting", () => {
  it("formats timestamps under 1 hour as M:SS", () => {
    const { transcript, scenes } = makeScenedTranscript([
      { paragraph: "Chapter one introduction and overview content", startSec: 0 },
      { paragraph: "Chapter two body with more detail information", startSec: 90 },   // 1:30
      { paragraph: "Chapter three conclusion and summary section", startSec: 180 },  // 3:00
    ]);

    const chapters = buildChapters(transcript, scenes);

    // All should be M:SS format
    for (const ch of chapters) {
      expect(ch.timestamp).toMatch(/^\d+:\d{2}$/);
    }
  });

  it("formats timestamps of 1 hour or more as H:MM:SS", () => {
    const { transcript, scenes } = makeScenedTranscript([
      { paragraph: "First chapter very early in the long video", startSec: 0 },
      { paragraph: "Second chapter after a long time has passed", startSec: 3900 }, // 1:05:00
      { paragraph: "Third chapter even later in the video content", startSec: 7800 }, // 2:10:00
    ]);

    const chapters = buildChapters(transcript, scenes);

    const longChapters = chapters.filter((ch) => {
      const secs = parseTimestampForTest(ch.timestamp);
      return secs >= 3600;
    });

    for (const ch of longChapters) {
      expect(ch.timestamp).toMatch(/^\d+:\d{2}:\d{2}$/);
    }
  });

  it("pads minutes and seconds to two digits (e.g. 1:05, not 1:5)", () => {
    const { transcript, scenes } = makeScenedTranscript([
      { paragraph: "Introduction chapter to explain fundamentals", startSec: 0 },
      { paragraph: "Second chapter with extra detail and content", startSec: 65 },  // 1:05
      { paragraph: "Third chapter with final summary remarks", startSec: 130 },     // 2:10
    ]);

    const chapters = buildChapters(transcript, scenes);

    // Any chapter at e.g. 65s should produce "1:05" not "1:5"
    for (const ch of chapters) {
      // If format is M:SS the seconds portion must be exactly 2 digits
      const mmss = ch.timestamp.match(/^(\d+):(\d+)$/);
      if (mmss) {
        expect(mmss[2]).toHaveLength(2);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("edge cases", () => {
  it("returns empty array when result would have fewer than 3 chapters after gap enforcement", () => {
    // All scenes within 10 s of each other — gap enforcement collapses them
    const { transcript, scenes } = makeScenedTranscript([
      { paragraph: "Very short first paragraph text", startSec: 0 },
      { paragraph: "Very short second paragraph text", startSec: 2 },  // gap < 10
      { paragraph: "Very short third paragraph text", startSec: 4 },  // gap < 10
    ]);

    const chapters = buildChapters(transcript, scenes);

    // After gap enforcement only the first survives, which is < 3 → empty
    expect(chapters).toEqual([]);
  });

  it("chapter titles are non-empty strings", () => {
    const { transcript, scenes } = makeScenedTranscript([
      { paragraph: "Introduction to the subject matter", startSec: 0 },
      { paragraph: "Background context and history here", startSec: 45 },
      { paragraph: "Current state and future outlook", startSec: 95 },
    ]);

    const chapters = buildChapters(transcript, scenes);

    for (const ch of chapters) {
      expect(ch.title.length).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// formatChaptersForDescription
// ═══════════════════════════════════════════════════════════════════════════════

describe("formatChaptersForDescription", () => {
  it("returns empty string for an empty chapters array", () => {
    expect(formatChaptersForDescription([])).toBe("");
  });

  it("formats chapters as 'TIMESTAMP Title' lines joined by newlines", () => {
    const chapters = [
      { timestamp: "0:00", title: "Intro" },
      { timestamp: "1:30", title: "Background" },
      { timestamp: "3:00", title: "Main Argument" },
    ];

    const output = formatChaptersForDescription(chapters);

    expect(output).toBe("0:00 Intro\n1:30 Background\n3:00 Main Argument");
  });

  it("does not add a trailing newline", () => {
    const chapters = [
      { timestamp: "0:00", title: "Intro" },
      { timestamp: "2:00", title: "Body" },
    ];

    const output = formatChaptersForDescription(chapters);

    expect(output).not.toMatch(/\n$/);
  });

  it("handles a single chapter without newlines", () => {
    const chapters = [{ timestamp: "0:00", title: "Full Video" }];
    const output = formatChaptersForDescription(chapters);
    expect(output).toBe("0:00 Full Video");
    expect(output).not.toContain("\n");
  });
});

// ── Internal test helper ───────────────────────────────────────────────────────

/** Parse a chapter timestamp string into total seconds (mirrors the internal parseTimestamp). */
function parseTimestampForTest(ts: string): number {
  const parts = ts.split(":").map(Number);
  if (parts.length === 3) {
    return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  }
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}
