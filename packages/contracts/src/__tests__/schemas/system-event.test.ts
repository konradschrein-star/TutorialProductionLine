/**
 * System Event Schema Tests
 *
 * Tests for the SystemEventSchema Zod schema.
 * Used for PostgreSQL LISTEN/NOTIFY → SSE realtime updates.
 */

import { describe, it, expect } from "vitest";
import { SystemEventSchema } from "../../schemas/system-event.js";

describe("SystemEventSchema", () => {
  describe("valid events", () => {
    it("validates a complete system event with job_id", () => {
      const event = {
        event_type: "job.status_changed",
        job_id: "550e8400-e29b-41d4-a716-446655440000",
        payload: {
          from: "PENDING",
          to: "SCRIPT_GENERATION",
          timestamp: "2026-04-17T10:30:00Z",
        },
        timestamp: "2026-04-17T10:30:00.123Z",
      };

      const result = SystemEventSchema.safeParse(event);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(event);
      }
    });

    it("validates a system-wide event with null job_id", () => {
      const event = {
        event_type: "worker.started",
        job_id: null,
        payload: {
          worker_type: "render",
          instance_id: "worker-001",
        },
        timestamp: "2026-04-17T10:30:00.123Z",
      };

      const result = SystemEventSchema.safeParse(event);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(event);
      }
    });

    it("validates events with empty payload", () => {
      const event = {
        event_type: "system.heartbeat",
        job_id: null,
        payload: {},
        timestamp: "2026-04-17T10:30:00.123Z",
      };

      const result = SystemEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it("validates events with complex nested payload", () => {
      const event = {
        event_type: "job.error",
        job_id: "550e8400-e29b-41d4-a716-446655440000",
        payload: {
          error: {
            code: "RENDER_FAILED",
            message: "FFmpeg process exited with code 1",
            details: {
              command: "ffmpeg -i input.mp4 output.mp4",
              exit_code: 1,
              stderr: "Error: invalid codec",
            },
          },
          retry_count: 2,
          will_retry: true,
        },
        timestamp: "2026-04-17T10:30:00.123Z",
      };

      const result = SystemEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it("validates events with various payload value types", () => {
      const event = {
        event_type: "test.event",
        job_id: null,
        payload: {
          string_val: "hello",
          number_val: 42,
          boolean_val: true,
          null_val: null,
          array_val: [1, 2, 3],
          object_val: { nested: "value" },
        },
        timestamp: "2026-04-17T10:30:00.123Z",
      };

      const result = SystemEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });
  });

  describe("invalid events", () => {
    it("rejects event with missing event_type", () => {
      const event = {
        job_id: null,
        payload: {},
        timestamp: "2026-04-17T10:30:00.123Z",
      };

      const result = SystemEventSchema.safeParse(event);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0]?.path).toContain("event_type");
      }
    });

    it("rejects event with empty event_type", () => {
      const event = {
        event_type: "",
        job_id: null,
        payload: {},
        timestamp: "2026-04-17T10:30:00.123Z",
      };

      const result = SystemEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });

    it("rejects event with missing job_id field", () => {
      const event = {
        event_type: "test",
        payload: {},
        timestamp: "2026-04-17T10:30:00.123Z",
      };

      const result = SystemEventSchema.safeParse(event);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0]?.path).toContain("job_id");
      }
    });

    it("rejects event with invalid UUID format for job_id", () => {
      const event = {
        event_type: "test",
        job_id: "not-a-valid-uuid",
        payload: {},
        timestamp: "2026-04-17T10:30:00.123Z",
      };

      const result = SystemEventSchema.safeParse(event);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0]?.path).toContain("job_id");
      }
    });

    it("rejects event with missing payload", () => {
      const event = {
        event_type: "test",
        job_id: null,
        timestamp: "2026-04-17T10:30:00.123Z",
      };

      const result = SystemEventSchema.safeParse(event);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0]?.path).toContain("payload");
      }
    });

    it("rejects event with non-object payload", () => {
      const event = {
        event_type: "test",
        job_id: null,
        payload: "not an object",
        timestamp: "2026-04-17T10:30:00.123Z",
      };

      const result = SystemEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });

    it("rejects event with missing timestamp", () => {
      const event = {
        event_type: "test",
        job_id: null,
        payload: {},
      };

      const result = SystemEventSchema.safeParse(event);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0]?.path).toContain("timestamp");
      }
    });

    it("rejects event with invalid ISO 8601 timestamp", () => {
      const event = {
        event_type: "test",
        job_id: null,
        payload: {},
        timestamp: "not-a-valid-timestamp",
      };

      const result = SystemEventSchema.safeParse(event);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0]?.path).toContain("timestamp");
      }
    });

    it("rejects event with invalid timestamp format (missing Z or timezone)", () => {
      const event = {
        event_type: "test",
        job_id: null,
        payload: {},
        timestamp: "2026-04-17T10:30:00",
      };

      const result = SystemEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("accepts valid UUID in various formats", () => {
      const validUUIDs = [
        "550e8400-e29b-41d4-a716-446655440000",
        "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
        "00000000-0000-0000-0000-000000000000",
      ];

      validUUIDs.forEach((uuid) => {
        const event = {
          event_type: "test",
          job_id: uuid,
          payload: {},
          timestamp: "2026-04-17T10:30:00.123Z",
        };

        const result = SystemEventSchema.safeParse(event);
        expect(result.success).toBe(true);
      });
    });

    it("accepts timestamps with milliseconds precision", () => {
      const event = {
        event_type: "test",
        job_id: null,
        payload: {},
        timestamp: "2026-04-17T10:30:00.123456Z",
      };

      const result = SystemEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it("rejects timestamps with timezone offsets (Zod requires UTC)", () => {
      const event = {
        event_type: "test",
        job_id: null,
        payload: {},
        timestamp: "2026-04-17T10:30:00.123+02:00",
      };

      const result = SystemEventSchema.safeParse(event);
      // Zod's .datetime() validator requires UTC (Z suffix)
      expect(result.success).toBe(false);
    });
  });
});
