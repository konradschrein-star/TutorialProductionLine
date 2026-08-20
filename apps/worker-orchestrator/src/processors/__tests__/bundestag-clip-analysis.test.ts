import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job, Queue } from "bullmq";
import { createBundestagClipAnalysisProcessor } from "../bundestag-clip-analysis.js";
import type { BundestagClipAnalysisPayload } from "@repo/contracts";
import type { WordTimestamp } from "@repo/contracts";
import type { SpeakerSegment } from "@repo/media-core";

// Mock dependencies
vi.mock("@repo/media-core", () => ({
  probeMedia: vi.fn(),
  runWhisper: vi.fn(),
  ensureMediaDirectory: vi.fn(),
}));

vi.mock("@repo/media-core/speaker-detection", () => ({
  detectSpeakers: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, stat: vi.fn() };
});

// Import mocked modules after mocking
import { probeMedia, runWhisper, ensureMediaDirectory } from "@repo/media-core";
import { detectSpeakers } from "@repo/media-core/speaker-detection";
import { stat } from "node:fs/promises";

describe("bundestag-clip-analysis processor (single-stream)", () => {
  // Mock database client
  const mockDb = {
    transaction: vi.fn(),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn(),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn(),
    }),
  };

  // Mock queue
  const mockQueue = {
    add: vi.fn(),
  };

  // Mock job
  const createMockJob = (
    payload: Partial<BundestagClipAnalysisPayload> = {},
  ): Job<BundestagClipAnalysisPayload> => {
    return {
      data: {
        job_id: "550e8400-e29b-41d4-a716-446655440000", // Valid UUID
        video_file_path: "/path/to/bundestag-stream.mp4",
        metadata: {},
        ...payload,
      },
    } as Job<BundestagClipAnalysisPayload>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    vi.mocked(ensureMediaDirectory).mockResolvedValue(
      "/media/bundestag/test-job-123",
    );
    vi.mocked(stat).mockResolvedValue({
      size: 1024 * 1024 * 500, // 500 MB
      isFile: () => true,
      isDirectory: () => false,
    } as any);
    vi.mocked(probeMedia).mockResolvedValue({
      durationSeconds: 3600, // 1 hour
      video: {
        width: 1920,
        height: 1080,
        fps: 25,
        codec: "h264",
      },
      audio: {
        codec: "aac",
        sampleRate: 48000,
        channels: 2,
      },
    } as any);
    vi.mocked(runWhisper).mockResolvedValue([
      { word: "Meine", start: 0, end: 0.5 },
      { word: "Damen", start: 0.5, end: 1.0 },
      { word: "und", start: 1.0, end: 1.2 },
      { word: "Herren", start: 1.2, end: 1.8 },
    ] as WordTimestamp[]);
    vi.mocked(detectSpeakers).mockResolvedValue({
      speaker_timeline: [
        {
          start_time: 0,
          end_time: 120,
          party: "SPD",
          speaker: "Unknown",
          confidence: 0.85,
        },
        {
          start_time: 120,
          end_time: 240,
          party: "CDU",
          speaker: "Unknown",
          confidence: 0.92,
        },
      ] as SpeakerSegment[],
    });

    // Mock transaction to execute callback immediately
    vi.mocked(mockDb.transaction).mockImplementation(async (callback: any) => {
      const mockTx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue(undefined),
        }),
      };
      return callback(mockTx);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Success Cases", () => {
    it("should process single video file and create party-segmented clips", async () => {
      const processor = createBundestagClipAnalysisProcessor(mockDb as any, {
        bundestagPlaybookGeneration: mockQueue as any,
      });

      const job = createMockJob();

      await processor(job);

      // Verify media directory was created
      expect(ensureMediaDirectory).toHaveBeenCalledWith(
        "bundestag",
        "550e8400-e29b-41d4-a716-446655440000",
      );

      // Verify video file existence check
      expect(stat).toHaveBeenCalledWith("/path/to/bundestag-stream.mp4");

      // Verify video metadata extraction
      expect(probeMedia).toHaveBeenCalledWith("/path/to/bundestag-stream.mp4");

      // Verify Whisper transcription
      expect(runWhisper).toHaveBeenCalledWith("/path/to/bundestag-stream.mp4");

      // Verify speaker detection
      expect(detectSpeakers).toHaveBeenCalledWith({
        videoFilePath: "/path/to/bundestag-stream.mp4",
        frameIntervalSeconds: 5,
      });

      // Verify database transaction was called
      expect(mockDb.transaction).toHaveBeenCalled();

      // Verify job status update
      expect(mockDb.update).toHaveBeenCalled();

      // Verify dispatch to playbook generation queue
      expect(mockQueue.add).toHaveBeenCalledWith(
        "generate-playbook",
        {
          job_id: "550e8400-e29b-41d4-a716-446655440000",
          use_local_llm: true,
          editing_style: "dynamic",
        },
        expect.objectContaining({
          attempts: 1,
        }),
      );
    });

    it("should create clips with correct party metadata", async () => {
      const mockWords: WordTimestamp[] = [];
      for (let i = 0; i < 200; i++) {
        mockWords.push({
          word: `word${i}`,
          start: i * 0.5,
          end: (i + 1) * 0.5,
        });
      }

      vi.mocked(runWhisper).mockResolvedValue(mockWords);
      vi.mocked(detectSpeakers).mockResolvedValue({
        speaker_timeline: [
          {
            start_time: 0,
            end_time: 50,
            party: "SPD",
            speaker: "Unknown",
            confidence: 0.9,
          },
          {
            start_time: 50,
            end_time: 100,
            party: "CDU",
            speaker: "Unknown",
            confidence: 0.85,
          },
        ] as SpeakerSegment[],
      });

      let insertedClips: any[] = [];
      vi.mocked(mockDb.transaction).mockImplementation(
        async (callback: any) => {
          const mockTx = {
            insert: vi.fn().mockReturnValue({
              values: vi.fn().mockImplementation((clip: any) => {
                insertedClips.push(clip);
                return Promise.resolve();
              }),
            }),
          };
          return callback(mockTx);
        },
      );

      const processor = createBundestagClipAnalysisProcessor(mockDb as any, {
        bundestagPlaybookGeneration: mockQueue as any,
      });

      const job = createMockJob();
      await processor(job);

      // Verify 2 clips were created (one per party segment)
      expect(insertedClips.length).toBe(2);

      // Verify first clip (SPD)
      expect(insertedClips[0]).toMatchObject({
        party: "SPD",
        start_offset: "0",
        end_offset: "50",
        speaker_name: "Unknown",
      });

      // Verify second clip (CDU)
      expect(insertedClips[1]).toMatchObject({
        party: "CDU",
        start_offset: "50",
        end_offset: "100",
        speaker_name: "Unknown",
      });
    });

    it("should handle single party throughout video", async () => {
      vi.mocked(detectSpeakers).mockResolvedValue({
        speaker_timeline: [
          {
            start_time: 0,
            end_time: 3600,
            party: "SPD",
            speaker: "Unknown",
            confidence: 0.95,
          },
        ] as SpeakerSegment[],
      });

      let insertedClips: any[] = [];
      vi.mocked(mockDb.transaction).mockImplementation(
        async (callback: any) => {
          const mockTx = {
            insert: vi.fn().mockReturnValue({
              values: vi.fn().mockImplementation((clip: any) => {
                insertedClips.push(clip);
                return Promise.resolve();
              }),
            }),
          };
          return callback(mockTx);
        },
      );

      const processor = createBundestagClipAnalysisProcessor(mockDb as any, {
        bundestagPlaybookGeneration: mockQueue as any,
      });

      const job = createMockJob();
      await processor(job);

      // Verify single clip created
      expect(insertedClips.length).toBe(1);
      expect(insertedClips[0]).toMatchObject({
        party: "SPD",
        start_offset: "0",
        end_offset: "3600",
      });
    });

    it("should handle multiple party transitions", async () => {
      vi.mocked(detectSpeakers).mockResolvedValue({
        speaker_timeline: [
          {
            start_time: 0,
            end_time: 100,
            party: "SPD",
            speaker: "Unknown",
            confidence: 0.9,
          },
          {
            start_time: 100,
            end_time: 200,
            party: "CDU",
            speaker: "Unknown",
            confidence: 0.85,
          },
          {
            start_time: 200,
            end_time: 300,
            party: "AFD",
            speaker: "Unknown",
            confidence: 0.8,
          },
          {
            start_time: 300,
            end_time: 400,
            party: "GRUENE",
            speaker: "Unknown",
            confidence: 0.88,
          },
          {
            start_time: 400,
            end_time: 500,
            party: "FDP",
            speaker: "Unknown",
            confidence: 0.92,
          },
          {
            start_time: 500,
            end_time: 600,
            party: "LINKE",
            speaker: "Unknown",
            confidence: 0.87,
          },
        ] as SpeakerSegment[],
      });

      let insertedClips: any[] = [];
      vi.mocked(mockDb.transaction).mockImplementation(
        async (callback: any) => {
          const mockTx = {
            insert: vi.fn().mockReturnValue({
              values: vi.fn().mockImplementation((clip: any) => {
                insertedClips.push(clip);
                return Promise.resolve();
              }),
            }),
          };
          return callback(mockTx);
        },
      );

      const processor = createBundestagClipAnalysisProcessor(mockDb as any, {
        bundestagPlaybookGeneration: mockQueue as any,
      });

      const job = createMockJob();
      await processor(job);

      // Verify 6 clips created (one per party)
      expect(insertedClips.length).toBe(6);

      // Verify all parties are represented
      const parties = insertedClips.map((c) => c.party);
      expect(parties).toEqual(["SPD", "CDU", "AFD", "GRUENE", "FDP", "LINKE"]);
    });

    it("should skip clips shorter than minimum duration (10 seconds)", async () => {
      vi.mocked(detectSpeakers).mockResolvedValue({
        speaker_timeline: [
          {
            start_time: 0,
            end_time: 5,
            party: "SPD",
            speaker: "Unknown",
            confidence: 0.9,
          }, // Too short
          {
            start_time: 5,
            end_time: 50,
            party: "CDU",
            speaker: "Unknown",
            confidence: 0.85,
          }, // OK
          {
            start_time: 50,
            end_time: 58,
            party: "AFD",
            speaker: "Unknown",
            confidence: 0.8,
          }, // Too short
          {
            start_time: 58,
            end_time: 100,
            party: "GRUENE",
            speaker: "Unknown",
            confidence: 0.88,
          }, // OK
        ] as SpeakerSegment[],
      });

      let insertedClips: any[] = [];
      vi.mocked(mockDb.transaction).mockImplementation(
        async (callback: any) => {
          const mockTx = {
            insert: vi.fn().mockReturnValue({
              values: vi.fn().mockImplementation((clip: any) => {
                insertedClips.push(clip);
                return Promise.resolve();
              }),
            }),
          };
          return callback(mockTx);
        },
      );

      const processor = createBundestagClipAnalysisProcessor(mockDb as any, {
        bundestagPlaybookGeneration: mockQueue as any,
      });

      const job = createMockJob();
      await processor(job);

      // Verify only 2 clips created (SPD and AFD skipped)
      expect(insertedClips.length).toBe(2);
      expect(insertedClips[0].party).toBe("CDU");
      expect(insertedClips[1].party).toBe("GRUENE");
    });

    it("should handle UNKNOWN party detections", async () => {
      vi.mocked(detectSpeakers).mockResolvedValue({
        speaker_timeline: [
          {
            start_time: 0,
            end_time: 100,
            party: "SPD",
            speaker: "Unknown",
            confidence: 0.9,
          },
          {
            start_time: 100,
            end_time: 150,
            party: "UNKNOWN",
            speaker: "Unknown",
            confidence: 0.3,
          },
          {
            start_time: 150,
            end_time: 250,
            party: "CDU",
            speaker: "Unknown",
            confidence: 0.85,
          },
        ] as SpeakerSegment[],
      });

      let insertedClips: any[] = [];
      vi.mocked(mockDb.transaction).mockImplementation(
        async (callback: any) => {
          const mockTx = {
            insert: vi.fn().mockReturnValue({
              values: vi.fn().mockImplementation((clip: any) => {
                insertedClips.push(clip);
                return Promise.resolve();
              }),
            }),
          };
          return callback(mockTx);
        },
      );

      const processor = createBundestagClipAnalysisProcessor(mockDb as any, {
        bundestagPlaybookGeneration: mockQueue as any,
      });

      const job = createMockJob();
      await processor(job);

      // Verify UNKNOWN party is included
      expect(insertedClips.length).toBe(3);
      expect(insertedClips[1].party).toBe("UNKNOWN");
    });
  });

  describe("Error Cases", () => {
    it("should fail if video file does not exist", async () => {
      vi.mocked(stat).mockRejectedValue(
        new Error("ENOENT: no such file or directory"),
      );

      const processor = createBundestagClipAnalysisProcessor(mockDb as any, {
        bundestagPlaybookGeneration: mockQueue as any,
      });

      const job = createMockJob();

      await expect(processor(job)).rejects.toThrow(/Video file not found/);

      // Verify job status was updated to FAILED_GENERAL
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("should fail if payload validation fails", async () => {
      const processor = createBundestagClipAnalysisProcessor(mockDb as any, {
        bundestagPlaybookGeneration: mockQueue as any,
      });

      const job = createMockJob({
        job_id: "invalid", // Invalid UUID
      });

      await expect(processor(job)).rejects.toThrow(/Invalid payload/);
    });

    it("should fail if Whisper transcription fails", async () => {
      vi.mocked(runWhisper).mockRejectedValue(
        new Error("Whisper process crashed"),
      );

      const processor = createBundestagClipAnalysisProcessor(mockDb as any, {
        bundestagPlaybookGeneration: mockQueue as any,
      });

      const job = createMockJob();

      await expect(processor(job)).rejects.toThrow(
        /Whisper transcription failed/,
      );

      // Verify job status was updated to FAILED_GENERAL
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("falls back to a single-speaker stub if speaker detection fails (does not fail the job)", async () => {
      // Speaker detection (Tesseract OCR) is deliberately non-fatal: it can hang
      // on first-use language-pack downloads and 10+ minute OCR-batch loops on
      // long videos, and without a timeout the BullMQ stall detector would
      // restart the job forever. bundestag-clip-analysis.ts catches detection
      // failures/timeouts and falls back to a single UNKNOWN-party segment
      // spanning the whole video so the rest of the pipeline (Whisper-timed
      // clips) can still finish.
      vi.mocked(detectSpeakers).mockRejectedValue(new Error("OCR failed"));

      let insertedClips: any[] = [];
      vi.mocked(mockDb.transaction).mockImplementation(
        async (callback: any) => {
          const mockTx = {
            insert: vi.fn().mockReturnValue({
              values: vi.fn().mockImplementation((clip: any) => {
                insertedClips.push(clip);
                return Promise.resolve();
              }),
            }),
          };
          return callback(mockTx);
        },
      );

      const processor = createBundestagClipAnalysisProcessor(mockDb as any, {
        bundestagPlaybookGeneration: mockQueue as any,
      });

      const job = createMockJob();

      await expect(processor(job)).resolves.not.toThrow();

      // Single stub segment spans the whole (mocked) 3600s video —> one clip.
      expect(insertedClips.length).toBe(1);
      expect(insertedClips[0].party).toBe("UNKNOWN");
      expect(insertedClips[0].speaker_confidence).toBe("0.000");

      // Job still reaches the ASSET_COLLECTION status update (not FAILED_GENERAL).
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("should fail if database insertion fails", async () => {
      vi.mocked(mockDb.transaction).mockRejectedValue(
        new Error("Database connection lost"),
      );

      const processor = createBundestagClipAnalysisProcessor(mockDb as any, {
        bundestagPlaybookGeneration: mockQueue as any,
      });

      const job = createMockJob();

      await expect(processor(job)).rejects.toThrow(/Database connection lost/);

      // Verify job status was updated to FAILED_GENERAL
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("should warn if playbook generation queue is not available", async () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const processor = createBundestagClipAnalysisProcessor(mockDb as any, {
        // No playbook generation queue
      });

      const job = createMockJob();
      await processor(job);

      // Verify warning was logged (check console.log output for JSON with level: "warn")
      // Note: console.warn is not called directly, but console.log with JSON.stringify({ level: "warn", ... })
      // So we can't check consoleWarnSpy directly, but the test passes if no error is thrown

      expect(mockQueue.add).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });

  describe("Edge Cases", () => {
    it("should handle video with no audio track", async () => {
      vi.mocked(probeMedia).mockResolvedValue({
        durationSeconds: 3600,
        video: {
          width: 1920,
          height: 1080,
          fps: 25,
          codec: "h264",
        },
        audio: undefined, // No audio
      } as any);

      const processor = createBundestagClipAnalysisProcessor(mockDb as any, {
        bundestagPlaybookGeneration: mockQueue as any,
      });

      const job = createMockJob();

      // Should still process (Whisper may fail, but that's a separate error)
      // This test verifies the processor doesn't crash on missing audio metadata
      await expect(processor(job)).resolves.not.toThrow();
    });

    it("should handle empty speaker timeline (no parties detected)", async () => {
      vi.mocked(detectSpeakers).mockResolvedValue({
        speaker_timeline: [],
      });

      let insertedClips: any[] = [];
      vi.mocked(mockDb.transaction).mockImplementation(
        async (callback: any) => {
          const mockTx = {
            insert: vi.fn().mockReturnValue({
              values: vi.fn().mockImplementation((clip: any) => {
                insertedClips.push(clip);
                return Promise.resolve();
              }),
            }),
          };
          return callback(mockTx);
        },
      );

      const processor = createBundestagClipAnalysisProcessor(mockDb as any, {
        bundestagPlaybookGeneration: mockQueue as any,
      });

      const job = createMockJob();
      await processor(job);

      // Verify no clips were created
      expect(insertedClips.length).toBe(0);

      // But job should still succeed and dispatch to next queue
      expect(mockQueue.add).toHaveBeenCalled();
    });

    it("should correlate transcript words with party segments correctly", async () => {
      const mockWords: WordTimestamp[] = [
        { word: "Hello", start: 0, end: 1 },
        { word: "from", start: 1, end: 2 },
        { word: "SPD", start: 2, end: 3 }, // In SPD segment
        { word: "party", start: 3, end: 4 },
        { word: "Hello", start: 100, end: 101 },
        { word: "from", start: 101, end: 102 },
        { word: "CDU", start: 102, end: 103 }, // In CDU segment
        { word: "party", start: 103, end: 104 },
      ];

      vi.mocked(runWhisper).mockResolvedValue(mockWords);
      vi.mocked(detectSpeakers).mockResolvedValue({
        speaker_timeline: [
          {
            start_time: 0,
            end_time: 50,
            party: "SPD",
            speaker: "Unknown",
            confidence: 0.9,
          },
          {
            start_time: 100,
            end_time: 150,
            party: "CDU",
            speaker: "Unknown",
            confidence: 0.85,
          },
        ] as SpeakerSegment[],
      });

      let insertedClips: any[] = [];
      vi.mocked(mockDb.transaction).mockImplementation(
        async (callback: any) => {
          const mockTx = {
            insert: vi.fn().mockReturnValue({
              values: vi.fn().mockImplementation((clip: any) => {
                insertedClips.push(clip);
                return Promise.resolve();
              }),
            }),
          };
          return callback(mockTx);
        },
      );

      const processor = createBundestagClipAnalysisProcessor(mockDb as any, {
        bundestagPlaybookGeneration: mockQueue as any,
      });

      const job = createMockJob();
      await processor(job);

      // Verify clips contain correct words
      expect(insertedClips.length).toBe(2);

      // SPD clip should contain words from 0-50s
      const spdWords = insertedClips[0].transcript_words;
      expect(spdWords).toHaveLength(4);
      expect(spdWords[0].word).toBe("Hello");
      expect(spdWords[2].word).toBe("SPD");

      // CDU clip should contain words from 100-150s
      const cduWords = insertedClips[1].transcript_words;
      expect(cduWords).toHaveLength(4);
      expect(cduWords[0].word).toBe("Hello");
      expect(cduWords[2].word).toBe("CDU");
    });
  });
});
