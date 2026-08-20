/**
 * Whisper Runner Tests
 *
 * Tests for runWhisper - executes faster-whisper or openai-whisper to extract
 * word-level timestamps from audio files.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import type { WordTimestamp } from "@repo/contracts";

// Mock child_process
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

// Mock fs/promises
const mockReadFile = vi.fn();
const mockAccess = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: (...args: any[]) => mockReadFile(...args),
  access: (...args: any[]) => mockAccess(...args),
}));

import { runWhisper } from "../whisper/runner.js";
import { spawn } from "node:child_process";

const mockSpawn = vi.mocked(spawn);

/**
 * Create a mock process that auto-emits "close" after the next tick.
 * runWhisper awaits access() before spawning, so we must defer the close
 * event to ensure the spawn listener is registered first.
 */
function makeAutoProcess(exitCode = 0) {
  const proc = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
  });
  mockSpawn.mockImplementation(() => {
    setImmediate(() => proc.emit("close", exitCode));
    return proc as any;
  });
  return proc;
}

describe("runWhisper", () => {
  let mockProcess: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcess = makeAutoProcess(0);
  });

  describe("faster-whisper implementation", () => {
    beforeEach(() => {
      mockAccess.mockResolvedValue(undefined); // faster-whisper script exists
    });

    it("uses faster-whisper when available", async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          words: [
            { word: "Hello", start: 0.0, end: 0.5 },
            { word: "world", start: 0.5, end: 1.0 },
          ],
        }),
      );

      const result = await runWhisper("/tmp/audio.mp3");

      expect(mockSpawn).toHaveBeenCalledWith(
        "python3",
        expect.arrayContaining([
          expect.stringContaining("faster_whisper_cli.py"),
          "/tmp/audio.mp3",
          "--model",
          "base",
        ]),
      );
      expect(result).toEqual([
        { word: "Hello", start: 0.0, end: 0.5 },
        { word: "world", start: 0.5, end: 1.0 },
      ]);
    });

    it("includes output_dir argument", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ words: [] }));

      await runWhisper("/tmp/render-123/audio.mp3");

      expect(mockSpawn).toHaveBeenCalledWith(
        "python3",
        expect.arrayContaining(["--output_dir", "/tmp/render-123"]),
      );
    });

    it("parses words from root level", async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          words: [
            { word: "First", start: 0.0, end: 1.0 },
            { word: "Second", start: 1.0, end: 2.0 },
          ],
        }),
      );

      const result = await runWhisper("/tmp/audio.mp3");

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ word: "First", start: 0.0, end: 1.0 });
      expect(result[1]).toEqual({ word: "Second", start: 1.0, end: 2.0 });
    });
  });

  describe("openai-whisper fallback", () => {
    beforeEach(() => {
      mockAccess.mockRejectedValue(new Error("ENOENT")); // faster-whisper not available
    });

    it("uses openai-whisper when faster-whisper not available", async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          segments: [
            {
              words: [
                { word: "Hello", start: 0.0, end: 0.5 },
                { word: "world", start: 0.5, end: 1.0 },
              ],
            },
          ],
        }),
      );

      const result = await runWhisper("/tmp/audio.mp3");

      expect(mockSpawn).toHaveBeenCalledWith("whisper", expect.any(Array));
      expect(result).toEqual([
        { word: "Hello", start: 0.0, end: 0.5 },
        { word: "world", start: 0.5, end: 1.0 },
      ]);
    });

    it("includes correct openai-whisper arguments", async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({ segments: [{ words: [] }] }),
      );

      await runWhisper("/tmp/audio.mp3");

      expect(mockSpawn).toHaveBeenCalledWith("whisper", [
        "/tmp/audio.mp3",
        "--model",
        "base",
        "--output_format",
        "json",
        "--word_timestamps",
        "True",
        "--output_dir",
        "/tmp",
      ]);
    });

    it("parses words from segments", async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          segments: [
            {
              words: [
                { word: "First", start: 0.0, end: 1.0 },
                { word: "Second", start: 1.0, end: 2.0 },
              ],
            },
            {
              words: [{ word: "Third", start: 2.0, end: 3.0 }],
            },
          ],
        }),
      );

      const result = await runWhisper("/tmp/audio.mp3");

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ word: "First", start: 0.0, end: 1.0 });
      expect(result[1]).toEqual({ word: "Second", start: 1.0, end: 2.0 });
      expect(result[2]).toEqual({ word: "Third", start: 2.0, end: 3.0 });
    });
  });

  describe("JSON output parsing", () => {
    beforeEach(() => {
      mockAccess.mockResolvedValue(undefined);
    });

    it("reads JSON output file based on input filename", async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({ words: [{ word: "Test", start: 0, end: 1 }] }),
      );

      await runWhisper("/tmp/render-123/my-audio.mp3");

      expect(mockReadFile).toHaveBeenCalledWith(
        join("/tmp/render-123", "my-audio.json"),
        "utf-8",
      );
    });

    it("handles various audio file extensions", async () => {
      const testCases = [
        { input: "/tmp/audio.mp3", expected: join("/tmp", "audio.json") },
        { input: "/tmp/audio.wav", expected: join("/tmp", "audio.json") },
        { input: "/tmp/audio.m4a", expected: join("/tmp", "audio.json") },
        { input: "/tmp/audio.flac", expected: join("/tmp", "audio.json") },
      ];

      for (const { input, expected } of testCases) {
        vi.clearAllMocks();
        mockAccess.mockResolvedValue(undefined);
        mockReadFile.mockResolvedValue(JSON.stringify({ words: [] }));
        makeAutoProcess(0);

        await runWhisper(input);

        expect(mockReadFile).toHaveBeenCalledWith(expected, "utf-8");
      }
    });

    it("handles JSON with no words", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ words: [] }));

      const result = await runWhisper("/tmp/audio.mp3");

      expect(result).toEqual([]);
    });

    it("handles segments with no words array", async () => {
      mockAccess.mockRejectedValue(new Error("ENOENT"));
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          segments: [
            { text: "No words array" },
            { words: [{ word: "Test", start: 0, end: 1 }] },
          ],
        }),
      );

      const result = await runWhisper("/tmp/audio.mp3");

      expect(result).toEqual([{ word: "Test", start: 0, end: 1 }]);
    });
  });

  describe("stderr logging", () => {
    beforeEach(() => {
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue(JSON.stringify({ words: [] }));
    });

    it("logs stderr progress output", async () => {
      // Override auto-emit so we can emit stderr data first
      const proc = Object.assign(new EventEmitter(), {
        stderr: new EventEmitter(),
      });
      mockSpawn.mockImplementation(() => {
        setImmediate(() => {
          proc.stderr.emit(
            "data",
            Buffer.from("[whisper] Detected language: en\n"),
          );
          proc.stderr.emit("data", Buffer.from("[whisper] Processing...\n"));
          proc.emit("close", 0);
        });
        return proc as any;
      });

      await runWhisper("/tmp/audio.mp3");

      // Stderr is logged but doesn't affect result
      expect(mockReadFile).toHaveBeenCalled();
    });

    it("accumulates stderr for error reporting", async () => {
      mockReadFile.mockRejectedValue(new Error("File not found"));

      const proc = Object.assign(new EventEmitter(), {
        stderr: new EventEmitter(),
      });
      mockSpawn.mockImplementation(() => {
        setImmediate(() => {
          proc.stderr.emit("data", Buffer.from("Error line 1\n"));
          proc.stderr.emit("data", Buffer.from("Error line 2\n"));
          proc.emit("close", 1);
        });
        return proc as any;
      });

      await expect(runWhisper("/tmp/audio.mp3")).rejects.toThrow();
    });
  });

  describe("error handling", () => {
    beforeEach(() => {
      mockAccess.mockResolvedValue(undefined);
    });

    it("rejects when JSON parsing fails with non-zero exit code", async () => {
      mockReadFile.mockRejectedValue(new Error("File not found"));

      const proc = Object.assign(new EventEmitter(), {
        stderr: new EventEmitter(),
      });
      mockSpawn.mockImplementation(() => {
        setImmediate(() => {
          proc.stderr.emit("data", Buffer.from("Whisper error"));
          proc.emit("close", 1);
        });
        return proc as any;
      });

      await expect(runWhisper("/tmp/audio.mp3")).rejects.toThrow(
        "Whisper failed with code 1: Whisper error",
      );
    });

    it("rejects when JSON is invalid", async () => {
      mockReadFile.mockResolvedValue("invalid json {{{");

      await expect(runWhisper("/tmp/audio.mp3")).rejects.toThrow(
        "Failed to parse Whisper JSON",
      );
    });

    it("accepts exit code null (killed by signal) if JSON is valid", async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({ words: [{ word: "Test", start: 0, end: 1 }] }),
      );

      const proc = Object.assign(new EventEmitter(), {
        stderr: new EventEmitter(),
      });
      mockSpawn.mockImplementation(() => {
        setImmediate(() => proc.emit("close", null));
        return proc as any;
      });

      const result = await runWhisper("/tmp/audio.mp3");

      expect(result).toEqual([{ word: "Test", start: 0, end: 1 }]);
    });

    it("rejects on JSON read failure with null exit code", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));

      const proc = Object.assign(new EventEmitter(), {
        stderr: new EventEmitter(),
      });
      mockSpawn.mockImplementation(() => {
        setImmediate(() => proc.emit("close", null));
        return proc as any;
      });

      await expect(runWhisper("/tmp/audio.mp3")).rejects.toThrow(
        "Failed to parse Whisper JSON",
      );
    });

    it("handles various failure scenarios", async () => {
      const testCases = [
        { code: 1, stderr: "Audio file corrupted" },
        { code: 2, stderr: "Model not found" },
        { code: 127, stderr: "Python not found" },
      ];

      for (const { code, stderr } of testCases) {
        vi.clearAllMocks();
        mockAccess.mockResolvedValue(undefined);
        mockReadFile.mockRejectedValue(new Error("No output"));

        const proc = Object.assign(new EventEmitter(), {
          stderr: new EventEmitter(),
        });
        mockSpawn.mockImplementation(() => {
          setImmediate(() => {
            proc.stderr.emit("data", Buffer.from(stderr));
            proc.emit("close", code);
          });
          return proc as any;
        });

        await expect(runWhisper("/tmp/audio.mp3")).rejects.toThrow(stderr);
      }
    });
  });

  describe("various audio paths", () => {
    beforeEach(() => {
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue(JSON.stringify({ words: [] }));
    });

    it("handles different audio file paths", async () => {
      const testCases = [
        "/tmp/render-123/tts-audio.mp3",
        "/var/tmp/recording.wav",
        "/home/user/content/voice.m4a",
      ];

      for (const audioPath of testCases) {
        vi.clearAllMocks();
        mockAccess.mockResolvedValue(undefined);
        mockReadFile.mockResolvedValue(JSON.stringify({ words: [] }));
        makeAutoProcess(0);

        await runWhisper(audioPath);

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          expect.arrayContaining([audioPath]),
        );
      }
    });
  });

  describe("model selection", () => {
    beforeEach(() => {
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue(JSON.stringify({ words: [] }));
    });

    it("uses base model by default", async () => {
      await runWhisper("/tmp/audio.mp3");

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(["--model", "base"]),
      );
    });
  });
});
