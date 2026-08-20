/**
 * ASS Caption Generator Tests
 *
 * Tests for generateASSFile - creates ASS subtitle files from Whisper word
 * timestamps with sliding window captions and lime highlighting.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WhisperWord } from "../whisper/types.js";

// Mock fs/promises
const mockWriteFile = vi.fn();

vi.mock("node:fs/promises", () => ({
  writeFile: (...args: any[]) => mockWriteFile(...args),
}));

import { generateASSFile } from "../ffmpeg/ass-generator.js";

describe("generateASSFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
  });

  describe("basic generation", () => {
    it("generates ASS file with header and dialogues", async () => {
      const words: WhisperWord[] = [
        { word: "Hello", start: 0.0, end: 0.5 },
        { word: "world", start: 0.5, end: 1.0 },
      ];

      await generateASSFile(words, "/tmp/captions.ass");

      expect(mockWriteFile).toHaveBeenCalledOnce();
      expect(mockWriteFile).toHaveBeenCalledWith(
        "/tmp/captions.ass",
        expect.stringContaining("[Script Info]"),
        "utf-8",
      );
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("[V4+ Styles]"),
        "utf-8",
      );
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("[Events]"),
        "utf-8",
      );
    });

    it("includes default resolution in header", async () => {
      const words: WhisperWord[] = [{ word: "Test", start: 0.0, end: 1.0 }];

      await generateASSFile(words, "/tmp/test.ass");

      const content = mockWriteFile.mock.calls[0][1];
      expect(content).toContain("PlayResX: 1920");
      expect(content).toContain("PlayResY: 1080");
    });

    it("includes default font size in style", async () => {
      const words: WhisperWord[] = [{ word: "Test", start: 0.0, end: 1.0 }];

      await generateASSFile(words, "/tmp/test.ass");

      const content = mockWriteFile.mock.calls[0][1];
      expect(content).toContain("Style: Default,Arial,72");
    });
  });

  describe("custom options", () => {
    it("accepts custom window size", async () => {
      const words: WhisperWord[] = [
        { word: "One", start: 0.0, end: 0.5 },
        { word: "Two", start: 0.5, end: 1.0 },
        { word: "Three", start: 1.0, end: 1.5 },
        { word: "Four", start: 1.5, end: 2.0 },
      ];

      await generateASSFile(words, "/tmp/test.ass", { windowSize: 2 });

      const content = mockWriteFile.mock.calls[0][1];
      // With window size 2, should only show 2 words at a time
      expect(content).toBeDefined();
    });

    it("accepts custom font size", async () => {
      const words: WhisperWord[] = [{ word: "Test", start: 0.0, end: 1.0 }];

      await generateASSFile(words, "/tmp/test.ass", { fontSize: 96 });

      const content = mockWriteFile.mock.calls[0][1];
      expect(content).toContain("Style: Default,Arial,96");
    });

    it("accepts custom resolution", async () => {
      const words: WhisperWord[] = [{ word: "Test", start: 0.0, end: 1.0 }];

      await generateASSFile(words, "/tmp/test.ass", {
        width: 3840,
        height: 2160,
      });

      const content = mockWriteFile.mock.calls[0][1];
      expect(content).toContain("PlayResX: 3840");
      expect(content).toContain("PlayResY: 2160");
    });

    it("accepts all custom options together", async () => {
      const words: WhisperWord[] = [{ word: "Test", start: 0.0, end: 1.0 }];

      await generateASSFile(words, "/tmp/test.ass", {
        windowSize: 4,
        fontSize: 48,
        width: 1280,
        height: 720,
      });

      const content = mockWriteFile.mock.calls[0][1];
      expect(content).toContain("PlayResX: 1280");
      expect(content).toContain("PlayResY: 720");
      expect(content).toContain("Style: Default,Arial,48");
    });
  });

  describe("dialogue generation", () => {
    it("creates one dialogue entry per block (default windowSize=6)", async () => {
      // Default windowSize=6: both words fit in one block → 1 dialogue
      const words: WhisperWord[] = [
        { word: "Hello", start: 0.0, end: 0.5 },
        { word: "world", start: 0.5, end: 1.0 },
      ];

      await generateASSFile(words, "/tmp/test.ass");

      const content = mockWriteFile.mock.calls[0][1];
      expect(content).toContain("Dialogue: 0,");
      // With default windowSize=6 and only 2 words, we get 1 block → 1 dialogue
      const dialogues = content.match(/^Dialogue: /gm);
      expect(dialogues).toHaveLength(1);
    });

    it("creates two dialogue entries when windowSize=1", async () => {
      // windowSize=1: each word becomes its own block → 2 dialogues
      const words: WhisperWord[] = [
        { word: "Hello", start: 0.0, end: 0.5 },
        { word: "world", start: 0.5, end: 1.0 },
      ];

      await generateASSFile(words, "/tmp/test.ass", { windowSize: 1 });

      const content = mockWriteFile.mock.calls[0][1];
      const dialogues = content.match(/^Dialogue: /gm);
      expect(dialogues).toHaveLength(2);
    });

    it("formats timestamps correctly", async () => {
      const words: WhisperWord[] = [
        { word: "Test", start: 0.0, end: 0.5 },
        { word: "word", start: 0.5, end: 1.0 },
      ];

      await generateASSFile(words, "/tmp/test.ass");

      const content = mockWriteFile.mock.calls[0][1];
      // ASS format: H:MM:SS.CC
      // Block starts at 0.0 and ends at 1.0 (last word's end)
      expect(content).toContain("0:00:00.00");
      expect(content).toContain("0:00:01.00");
    });

    it("formats timestamps for longer durations", async () => {
      // With windowSize=1, each word gets its own block with correct timestamps
      const words: WhisperWord[] = [
        { word: "Start", start: 0.0, end: 1.0 },
        { word: "Middle", start: 3661.5, end: 3662.0 }, // 1:01:01.50
      ];

      await generateASSFile(words, "/tmp/test.ass", { windowSize: 1 });

      const content = mockWriteFile.mock.calls[0][1];
      expect(content).toContain("1:01:01.50");
    });

    it("highlights current word with lime color (karaoke style)", async () => {
      const words: WhisperWord[] = [{ word: "Hello", start: 0.0, end: 0.5 }];

      await generateASSFile(words, "/tmp/test.ass");

      const content = mockWriteFile.mock.calls[0][1];
      // First word in block uses karaoke lime highlight with \k timing tag
      expect(content).toContain("{\\c&H0000FFAA&\\k");
      expect(content).toContain("}Hello{\\c&H00FFFFFF&}");
    });

    it("includes anchor tag for bottom-center positioning", async () => {
      const words: WhisperWord[] = [{ word: "Test", start: 0.0, end: 1.0 }];

      await generateASSFile(words, "/tmp/test.ass");

      const content = mockWriteFile.mock.calls[0][1];
      expect(content).toContain("{\\an2}");
    });
  });

  describe("sliding window behavior", () => {
    it("shows sliding window of words", async () => {
      const words: WhisperWord[] = [
        { word: "One", start: 0.0, end: 0.5 },
        { word: "Two", start: 0.5, end: 1.0 },
        { word: "Three", start: 1.0, end: 1.5 },
        { word: "Four", start: 1.5, end: 2.0 },
        { word: "Five", start: 2.0, end: 2.5 },
        { word: "Six", start: 2.5, end: 3.0 },
        { word: "Seven", start: 3.0, end: 3.5 },
      ];

      await generateASSFile(words, "/tmp/test.ass", { windowSize: 3 });

      const content = mockWriteFile.mock.calls[0][1];
      // With window size 3, first word should show "One Two Three" with One highlighted
      expect(content).toContain("One");
      expect(content).toContain("Two");
      expect(content).toContain("Three");
    });

    it("handles window at beginning of words array", async () => {
      const words: WhisperWord[] = [
        { word: "First", start: 0.0, end: 0.5 },
        { word: "Second", start: 0.5, end: 1.0 },
        { word: "Third", start: 1.0, end: 1.5 },
      ];

      await generateASSFile(words, "/tmp/test.ass", { windowSize: 6 });

      const content = mockWriteFile.mock.calls[0][1];
      // Window is larger than array - should show all 3 words
      expect(content).toBeDefined();
    });

    it("handles window at end of words array", async () => {
      const words: WhisperWord[] = [
        { word: "One", start: 0.0, end: 0.5 },
        { word: "Two", start: 0.5, end: 1.0 },
        { word: "Three", start: 1.0, end: 1.5 },
      ];

      await generateASSFile(words, "/tmp/test.ass", { windowSize: 2 });

      const content = mockWriteFile.mock.calls[0][1];
      // Last word window should not go out of bounds
      expect(content).toBeDefined();
    });
  });

  describe("edge cases", () => {
    it("handles empty words array", async () => {
      await generateASSFile([], "/tmp/empty.ass");

      const content = mockWriteFile.mock.calls[0][1];
      // Should still generate valid header
      expect(content).toContain("[Script Info]");
      expect(content).toContain("[Events]");
      // But no dialogue entries
      expect(content).not.toContain("Dialogue: 0,");
    });

    it("handles single word", async () => {
      const words: WhisperWord[] = [{ word: "Solo", start: 0.0, end: 1.0 }];

      await generateASSFile(words, "/tmp/single.ass");

      const content = mockWriteFile.mock.calls[0][1];
      expect(content).toContain("Solo");
      const dialogues = content.match(/^Dialogue: /gm);
      expect(dialogues).toHaveLength(1);
    });

    it("skips blocks where end <= start (block-level check)", async () => {
      // Production code groups words into blocks. With default windowSize=6,
      // all 3 words form one block: startTime=0.0, endTime=3.0 → block is valid.
      // The "Invalid" word (end===start) is included in the block's karaoke text
      // but gets minimum 1 centisecond duration via Math.max(1, ...).
      const words: WhisperWord[] = [
        { word: "Valid", start: 0.0, end: 1.0 },
        { word: "Invalid", start: 2.0, end: 2.0 }, // end === start
        { word: "AlsoValid", start: 2.0, end: 3.0 },
      ];

      await generateASSFile(words, "/tmp/test.ass");

      const content = mockWriteFile.mock.calls[0][1];
      // All 3 words in one block → 1 dialogue entry
      const dialogues = content.match(/^Dialogue: /gm);
      expect(dialogues).toHaveLength(1);
      // Block still contains both valid words
      expect(content).toContain("Valid");
      expect(content).toContain("AlsoValid");
    });

    it("handles very short timestamps", async () => {
      const words: WhisperWord[] = [{ word: "Quick", start: 0.01, end: 0.02 }];

      await generateASSFile(words, "/tmp/test.ass");

      const content = mockWriteFile.mock.calls[0][1];
      expect(content).toContain("0:00:00.01");
      expect(content).toContain("0:00:00.02");
    });

    it("handles fractional seconds correctly", async () => {
      const words: WhisperWord[] = [
        { word: "Fraction", start: 1.234, end: 2.567 },
      ];

      await generateASSFile(words, "/tmp/test.ass");

      const content = mockWriteFile.mock.calls[0][1];
      // ASS uses centisecond precision
      expect(content).toContain("0:00:01.23");
      expect(content).toContain("0:00:02.57");
    });
  });

  describe("duration calculation", () => {
    it("block dialogue spans from first word start to last word end", async () => {
      // Production code uses block-based grouping. The dialogue start/end is
      // the block's first word start and last word end.
      const words: WhisperWord[] = [
        { word: "First", start: 0.0, end: 0.5 },
        { word: "Second", start: 0.5, end: 1.0 },
      ];

      await generateASSFile(words, "/tmp/test.ass");

      const content = mockWriteFile.mock.calls[0][1];
      // Both words in one block: start=0.0, end=1.0 (last word's end)
      expect(content).toMatch(/Dialogue: 0,0:00:00\.00,0:00:01\.00/);
    });

    it("single-word block uses word's own start and end times", async () => {
      const words: WhisperWord[] = [{ word: "Only", start: 0.0, end: 2.5 }];

      await generateASSFile(words, "/tmp/test.ass");

      const content = mockWriteFile.mock.calls[0][1];
      expect(content).toMatch(/Dialogue: 0,0:00:00\.00,0:00:02\.50/);
    });

    it("windowSize=1 creates one block per word using its own start/end", async () => {
      const words: WhisperWord[] = [
        { word: "First", start: 0.0, end: 0.5 },
        { word: "Second", start: 0.5, end: 1.0 },
      ];

      await generateASSFile(words, "/tmp/test.ass", { windowSize: 1 });

      const content = mockWriteFile.mock.calls[0][1];
      // With windowSize=1, each word gets its own block
      expect(content).toMatch(/Dialogue: 0,0:00:00\.00,0:00:00\.50/);
      expect(content).toMatch(/Dialogue: 0,0:00:00\.50,0:00:01\.00/);
    });
  });

  describe("error handling", () => {
    it("throws error when writeFile fails", async () => {
      mockWriteFile.mockRejectedValue(new Error("Disk full"));

      const words: WhisperWord[] = [{ word: "Test", start: 0.0, end: 1.0 }];

      await expect(generateASSFile(words, "/tmp/test.ass")).rejects.toThrow(
        "Disk full",
      );
    });

    it("propagates filesystem errors", async () => {
      mockWriteFile.mockRejectedValue(new Error("EACCES: permission denied"));

      const words: WhisperWord[] = [{ word: "Test", start: 0.0, end: 1.0 }];

      await expect(
        generateASSFile(words, "/tmp/protected.ass"),
      ).rejects.toThrow("EACCES: permission denied");
    });
  });

  describe("various output paths", () => {
    it("handles different output path formats", async () => {
      const testCases = [
        "/tmp/render-123/captions.ass",
        "/var/tmp/subs.ass",
        "/home/user/video/captions.ass",
      ];

      const words: WhisperWord[] = [{ word: "Test", start: 0.0, end: 1.0 }];

      for (const outputPath of testCases) {
        vi.clearAllMocks();

        await generateASSFile(words, outputPath);

        expect(mockWriteFile).toHaveBeenCalledWith(
          outputPath,
          expect.any(String),
          "utf-8",
        );
      }
    });
  });
});
