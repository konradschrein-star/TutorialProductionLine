import { describe, it, expect } from "vitest";
import {
  classifyHttpError,
  classifyThrown,
  isRetryable,
  parseRetryAfterMs,
} from "../errors.js";

function googleError(code: number, reason?: string, message = "boom"): string {
  return JSON.stringify({
    error: {
      code,
      message,
      ...(reason !== undefined ? { errors: [{ reason, message }] } : {}),
    },
  });
}

describe("parseRetryAfterMs", () => {
  it("parses a seconds value", () => {
    expect(parseRetryAfterMs("30")).toBe(30_000);
  });

  it("parses an HTTP-date relative to now", () => {
    const now = Date.parse("2026-07-28T12:00:00Z");
    expect(parseRetryAfterMs("Tue, 28 Jul 2026 12:00:45 GMT", now)).toBe(
      45_000,
    );
  });

  it("clamps a date in the past to 0 rather than going negative", () => {
    const now = Date.parse("2026-07-28T12:00:00Z");
    expect(parseRetryAfterMs("Tue, 28 Jul 2026 11:59:00 GMT", now)).toBe(0);
  });

  it("returns undefined for absent or junk values", () => {
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
    expect(parseRetryAfterMs("  ")).toBeUndefined();
    expect(parseRetryAfterMs("soon-ish")).toBeUndefined();
  });
});

describe("classifyHttpError", () => {
  it("treats 429 as retryable rate limiting", () => {
    const err = classifyHttpError({ status: 429, bodyText: googleError(429) });
    expect(err.kind).toBe("rate_limited");
    expect(isRetryable(err.kind)).toBe(true);
  });

  it("splits 403 rateLimitExceeded from 403 storageQuotaExceeded", () => {
    const rate = classifyHttpError({
      status: 403,
      bodyText: googleError(403, "userRateLimitExceeded"),
    });
    expect(rate.kind).toBe("rate_limited");
    expect(isRetryable(rate.kind)).toBe(true);

    const full = classifyHttpError({
      status: 403,
      bodyText: googleError(403, "storageQuotaExceeded"),
    });
    expect(full.kind).toBe("quota_exceeded");
    // A full Drive must never be retried - that is an infinite loop.
    expect(isRetryable(full.kind)).toBe(false);
  });

  it("treats a reasonless 403 as throttling (Google's common case)", () => {
    const err = classifyHttpError({ status: 403, bodyText: "{}" });
    expect(err.kind).toBe("rate_limited");
  });

  it("treats a 403 with a permission reason as auth, not throttling", () => {
    const err = classifyHttpError({
      status: 403,
      bodyText: googleError(403, "insufficientFilePermissions"),
    });
    expect(err.kind).toBe("auth");
    expect(isRetryable(err.kind)).toBe(false);
  });

  it("classifies 401 as auth and 404 as not_found", () => {
    expect(classifyHttpError({ status: 401, bodyText: "" }).kind).toBe("auth");
    expect(classifyHttpError({ status: 404, bodyText: "" }).kind).toBe(
      "not_found",
    );
  });

  it("classifies 5xx as retryable server errors", () => {
    for (const status of [500, 502, 503, 504]) {
      const err = classifyHttpError({ status, bodyText: "" });
      expect(err.kind).toBe("server");
      expect(isRetryable(err.kind)).toBe(true);
    }
  });

  it("classifies other 4xx as non-retryable bad requests", () => {
    const err = classifyHttpError({ status: 400, bodyText: googleError(400) });
    expect(err.kind).toBe("bad_request");
    expect(isRetryable(err.kind)).toBe(false);
  });

  it("carries the Retry-After through to the error", () => {
    const err = classifyHttpError({
      status: 429,
      bodyText: "",
      retryAfterHeader: "12",
    });
    expect(err.retryAfterMs).toBe(12_000);
  });

  it("survives a non-JSON body without throwing", () => {
    const err = classifyHttpError({
      status: 502,
      bodyText: "<html>bad gateway",
    });
    expect(err.kind).toBe("server");
    expect(err.message).toContain("bad gateway");
  });

  it("surfaces Google's message rather than a generic one", () => {
    const err = classifyHttpError({
      status: 403,
      bodyText: googleError(
        403,
        "storageQuotaExceeded",
        "The user has exceeded their Drive storage quota.",
      ),
    });
    expect(err.message).toContain("exceeded their Drive storage quota");
    expect(err.reason).toBe("storageQuotaExceeded");
  });
});

describe("classifyThrown", () => {
  it("maps filesystem errno codes to local_file (never retried)", () => {
    for (const code of ["ENOENT", "EACCES", "EISDIR", "EPERM"]) {
      const err = Object.assign(new Error("nope"), { code });
      const classified = classifyThrown(err);
      expect(classified.kind).toBe("local_file");
      expect(isRetryable(classified.kind)).toBe(false);
    }
  });

  it("maps a generic thrown Error to a retryable network failure", () => {
    const classified = classifyThrown(new Error("socket hang up"));
    expect(classified.kind).toBe("network");
    expect(isRetryable(classified.kind)).toBe(true);
  });

  it("handles a non-Error throw", () => {
    expect(classifyThrown("weird").kind).toBe("unknown");
  });
});
