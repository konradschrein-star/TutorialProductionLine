import { describe, it, expect, vi } from "vitest";
import { retryFileOperation } from "../retry-file-operation.js";

describe("retryFileOperation", () => {
  it("should succeed on first attempt", async () => {
    const operation = vi.fn().mockResolvedValue("success");

    const result = await retryFileOperation(operation, {
      maxAttempts: 3,
      baseDelayMs: 10,
    });

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("should retry on EBUSY error and eventually succeed", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ code: "EBUSY", message: "Resource busy" })
      .mockRejectedValueOnce({ code: "EBUSY", message: "Resource busy" })
      .mockResolvedValueOnce("success");

    const result = await retryFileOperation(operation, {
      maxAttempts: 5,
      baseDelayMs: 10,
    });

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("should retry on EPERM error and eventually succeed", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ code: "EPERM", message: "Permission denied" })
      .mockResolvedValueOnce("success");

    const result = await retryFileOperation(operation, {
      maxAttempts: 5,
      baseDelayMs: 10,
    });

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("should throw immediately on non-retryable error", async () => {
    const operation = vi
      .fn()
      .mockRejectedValue({ code: "ENOENT", message: "File not found" });

    await expect(
      retryFileOperation(operation, {
        maxAttempts: 5,
        baseDelayMs: 10,
      }),
    ).rejects.toMatchObject({
      code: "ENOENT",
      message: "File not found",
    });

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("should throw after max attempts with retryable error", async () => {
    const operation = vi
      .fn()
      .mockRejectedValue({ code: "EBUSY", message: "Resource busy" });

    await expect(
      retryFileOperation(operation, {
        maxAttempts: 3,
        baseDelayMs: 10,
      }),
    ).rejects.toMatchObject({
      code: "EBUSY",
      message: "Resource busy",
    });

    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("should use exponential backoff", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ code: "EBUSY", message: "Resource busy" })
      .mockRejectedValueOnce({ code: "EBUSY", message: "Resource busy" })
      .mockResolvedValueOnce("success");

    const startTime = Date.now();

    await retryFileOperation(operation, {
      maxAttempts: 5,
      baseDelayMs: 50,
      backoffMultiplier: 2,
    });

    const elapsed = Date.now() - startTime;

    // First retry: 50ms, second retry: 100ms = 150ms total minimum
    expect(elapsed).toBeGreaterThanOrEqual(140); // Allow 10ms margin
  });

  it("should handle non-Error objects", async () => {
    const operation = vi.fn().mockRejectedValue("string error");

    await expect(
      retryFileOperation(operation, {
        maxAttempts: 3,
        baseDelayMs: 10,
      }),
    ).rejects.toThrow("string error");

    expect(operation).toHaveBeenCalledTimes(1);
  });
});
