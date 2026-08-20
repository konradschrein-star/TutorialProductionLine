/**
 * Unit tests for Bundestag Clip Analysis Queue Payload
 *
 * Tests the schema validation for single-stream video ingestion to the
 * bundestag-clip-analysis queue.
 */

import { describe, it, expect } from "vitest";
import { BundestagClipAnalysisPayloadSchema } from "../../queue-payloads/bundestag-payloads.js";

describe("BundestagClipAnalysisPayloadSchema", () => {
  const validJobId = "550e8400-e29b-41d4-a716-446655440000";

  describe("Valid payloads", () => {
    it("accepts a minimal payload with required fields only", () => {
      const payload = {
        job_id: validJobId,
        video_file_path: "/path/to/bundestag-session-2026-05-20.mp4",
      };

      const result = BundestagClipAnalysisPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.job_id).toBe(validJobId);
        expect(result.data.video_file_path).toBe(
          "/path/to/bundestag-session-2026-05-20.mp4",
        );
        expect(result.data.metadata).toBeUndefined();
      }
    });

    it("accepts a payload with optional metadata", () => {
      const payload = {
        job_id: validJobId,
        video_file_path: "/path/to/bundestag-session.mp4",
        metadata: {
          speech_date: "2026-05-20",
          topic: "Budget Debate",
          duration_seconds: 3600,
          size_bytes: 1073741824,
        },
      };

      const result = BundestagClipAnalysisPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata).toEqual({
          speech_date: "2026-05-20",
          topic: "Budget Debate",
          duration_seconds: 3600,
          size_bytes: 1073741824,
        });
      }
    });

    it("accepts absolute file paths", () => {
      const payloads = [
        "/absolute/path/to/video.mp4",
        "C:\\Windows\\absolute\\path\\video.mp4",
      ];

      payloads.forEach((videoPath) => {
        const payload = {
          job_id: validJobId,
          video_file_path: videoPath,
        };

        const result = BundestagClipAnalysisPayloadSchema.safeParse(payload);
        expect(result.success).toBe(true);
      });
    });

    it("accepts metadata with various data types", () => {
      const payload = {
        job_id: validJobId,
        video_file_path: "/path/to/video.mp4",
        metadata: {
          string_field: "value",
          number_field: 42,
          boolean_field: true,
          null_field: null,
          array_field: [1, 2, 3],
          nested_object: { key: "value" },
        },
      };

      const result = BundestagClipAnalysisPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });

  describe("Invalid payloads", () => {
    it("rejects payload missing job_id", () => {
      const payload = {
        video_file_path: "/path/to/video.mp4",
      };

      const result = BundestagClipAnalysisPayloadSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain("job_id");
      }
    });

    it("rejects payload with invalid job_id (not UUID)", () => {
      const payload = {
        job_id: "not-a-uuid",
        video_file_path: "/path/to/video.mp4",
      };

      const result = BundestagClipAnalysisPayloadSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it("rejects payload missing video_file_path", () => {
      const payload = {
        job_id: validJobId,
      };

      const result = BundestagClipAnalysisPayloadSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain("video_file_path");
      }
    });

    it("rejects payload with empty video_file_path", () => {
      const payload = {
        job_id: validJobId,
        video_file_path: "",
      };

      const result = BundestagClipAnalysisPayloadSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain("video_file_path");
      }
    });

    it("accepts payload with whitespace-only video_file_path (pre-validated by ingestion handler)", () => {
      // Note: The ingestion handler validates and trims video_file_path before
      // dispatching to queue, so this schema doesn't need to handle it
      const payload = {
        job_id: validJobId,
        video_file_path: "   ",
      };

      const result = BundestagClipAnalysisPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("rejects payload with non-string video_file_path", () => {
      const payload = {
        job_id: validJobId,
        video_file_path: 123,
      };

      const result = BundestagClipAnalysisPayloadSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe("Compatibility with old schema", () => {
    it("rejects old multi-clip format (clips array)", () => {
      const oldPayload = {
        job_id: validJobId,
        clips: [
          {
            clip_id: "clip-1",
            local_path: "/path/to/clip1.mp4",
            camera_angle: "wide",
          },
        ],
      };

      const result = BundestagClipAnalysisPayloadSchema.safeParse(oldPayload);
      expect(result.success).toBe(false);
      // Should fail because video_file_path is required, not clips
    });
  });
});
