import { describe, it, expect } from "vitest";
import {
  ErrorDetailSchema,
  buildErrorDetail,
} from "../schemas/error-detail.js";

describe("ErrorDetailSchema", () => {
  it("validates a correct structured error detail with all fields", () => {
    const valid = {
      code: "RENDER_TIMEOUT",
      message: "FFmpeg render exceeded 30-minute limit",
      category: "render" as const,
      context: { jobId: "abc-123", durationMs: 1800000 },
      retryable: true,
      timestamp: "2026-04-05T12:00:00.000Z",
    };

    const result = ErrorDetailSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(valid);
    }
  });

  it("validates without optional context field", () => {
    const valid = {
      code: "ASSET_MISSING",
      message: "Required thumbnail not found in R2",
      category: "asset_management" as const,
      retryable: false,
      timestamp: "2026-04-05T12:00:00.000Z",
    };

    const result = ErrorDetailSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const incomplete = { code: "FOO" };

    const result = ErrorDetailSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it("rejects invalid category", () => {
    const invalid = {
      code: "X",
      message: "msg",
      category: "not_a_category",
      retryable: true,
      timestamp: "2026-04-05T12:00:00.000Z",
    };

    const result = ErrorDetailSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects invalid timestamp format", () => {
    const invalid = {
      code: "X",
      message: "msg",
      category: "render",
      retryable: true,
      timestamp: "not-a-datetime",
    };

    const result = ErrorDetailSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe("buildErrorDetail", () => {
  it("produces valid schema output", () => {
    const detail = buildErrorDetail({
      code: "ELEVENLABS_RATE_LIMIT",
      message: "TTS API returned 429",
      category: "external_service",
      context: { statusCode: 429 },
      retryable: true,
    });

    const result = ErrorDetailSchema.safeParse(detail);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe("ELEVENLABS_RATE_LIMIT");
      expect(result.data.category).toBe("external_service");
      expect(result.data.retryable).toBe(true);
      expect(result.data.timestamp).toBeDefined();
    }
  });

  it("produces valid output without optional context", () => {
    const detail = buildErrorDetail({
      code: "UNKNOWN_FAILURE",
      message: "Something went wrong",
      category: "unknown",
      retryable: false,
    });

    const result = ErrorDetailSchema.safeParse(detail);
    expect(result.success).toBe(true);
  });
});
