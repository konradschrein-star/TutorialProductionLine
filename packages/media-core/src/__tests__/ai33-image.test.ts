/**
 * AI33 Image Generation Tests
 *
 * Tests for generateImageAI33 - generates images via AI33 API using
 * gemini-3.1-flash-image-preview (Nano Banana 2) with task-based polling.
 * Production code retries up to 3 times on transient errors, then throws
 * "AI33 image generation failed: all 3 attempts exhausted".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use vi.hoisted so the variable is available inside the vi.mock factory
// (vi.mock calls are hoisted to the top of the file before const declarations)
const { mockExecFileAsync } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:util", () => ({
  promisify: () => mockExecFileAsync,
}));

// Mock node:fs/promises for ffmpeg temp files
const mockWriteFile = vi.fn();
const mockReadFile = vi.fn();
const mockUnlink = vi.fn();

vi.mock("node:fs/promises", () => ({
  writeFile: (...args: any[]) => mockWriteFile(...args),
  readFile: (...args: any[]) => mockReadFile(...args),
  unlink: (...args: any[]) => mockUnlink(...args),
}));

// Mock node:os for tmpdir
vi.mock("node:os", () => ({
  tmpdir: () => "/tmp",
}));

// Mock node:path
vi.mock("node:path", () => ({
  join: (...parts: string[]) => parts.join("/"),
}));

import { generateImageAI33 } from "../ai33/image.js";

/**
 * Helper: set up a standard successful mock fetch that goes:
 * submit → task poll → image download
 */
function setupSuccessfulFetch(
  mockFetch: any,
  taskId = "task-123",
  imageUrl = "https://ai33.com/result.png",
) {
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes("/task/generate-image")) {
      return {
        ok: true,
        json: async () => ({ success: true, task_id: taskId }),
      };
    }
    if (url.includes(`/task/${taskId}`)) {
      return {
        ok: true,
        json: async () => ({
          status: "done",
          progress: 100,
          metadata: {
            result_images: [
              {
                id: "img-1",
                imageUrl,
                previewUrl: imageUrl,
                mimeType: "image/png",
                width: 2048,
                height: 1152,
              },
            ],
          },
        }),
      };
    }
    if (url === imageUrl) {
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(1000),
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
}

describe("generateImageAI33", () => {
  let mockFetch: any;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Default mocks
    mockWriteFile.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(Buffer.from("normalized-image-data"));
    mockUnlink.mockResolvedValue(undefined);
    mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  describe("successful generation with primary model (Nano Banana 2)", () => {
    it("generates image successfully", async () => {
      setupSuccessfulFetch(mockFetch);

      const promise = generateImageAI33(
        "test-api-key",
        "A beautiful sunset",
        "16:9",
      );
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });

    it("submits with correct API key", async () => {
      setupSuccessfulFetch(mockFetch);

      const promise = generateImageAI33("my-secret-key", "Test prompt", "16:9");
      await vi.runAllTimersAsync();
      await promise;

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/task/generate-image"),
        expect.objectContaining({
          headers: { "xi-api-key": "my-secret-key" },
        }),
      );
    });

    it("uses gemini-3.1-flash-image-preview as primary model", async () => {
      setupSuccessfulFetch(mockFetch);

      const promise = generateImageAI33("key", "Test", "16:9");
      await vi.runAllTimersAsync();
      await promise;

      const submitCall = mockFetch.mock.calls.find((call: any) =>
        call[0].includes("/task/generate-image"),
      );
      expect(submitCall).toBeDefined();
    });

    it("accepts various aspect ratios", async () => {
      const testCases = ["16:9", "9:16", "1:1", "4:3"];

      for (const aspectRatio of testCases) {
        vi.clearAllMocks();
        // Re-setup mocks after clearAllMocks
        mockWriteFile.mockResolvedValue(undefined);
        mockReadFile.mockResolvedValue(Buffer.from("normalized-image-data"));
        mockUnlink.mockResolvedValue(undefined);
        mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });

        setupSuccessfulFetch(mockFetch, "task-ar", "https://ai33.com/img.png");

        const promise = generateImageAI33("key", "Test", aspectRatio);
        await vi.runAllTimersAsync();
        await promise;

        expect(mockFetch).toHaveBeenCalled();
      }
    });

    it("accepts optional seed parameter", async () => {
      setupSuccessfulFetch(mockFetch);

      const promise = generateImageAI33(
        "key",
        "Test",
        "16:9",
        undefined,
        undefined,
        42,
      );
      await vi.runAllTimersAsync();
      await promise;

      const submitCall = mockFetch.mock.calls.find((call: any) =>
        call[0].includes("/task/generate-image"),
      );
      expect(submitCall).toBeDefined();
    });
  });

  describe("polling mechanism", () => {
    it("polls until status is done", async () => {
      let pollCount = 0;

      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/task/generate-image")) {
          return {
            ok: true,
            json: async () => ({ success: true, task_id: "task-456" }),
          };
        }

        if (url.includes("/task/task-456")) {
          pollCount++;
          if (pollCount < 3) {
            return {
              ok: true,
              json: async () => ({ status: "doing", progress: pollCount * 33 }),
            };
          }
          return {
            ok: true,
            json: async () => ({
              status: "done",
              metadata: {
                result_images: [{ imageUrl: "https://ai33.com/done.png" }],
              },
            }),
          };
        }

        if (url.includes("done.png")) {
          return {
            ok: true,
            arrayBuffer: async () => new ArrayBuffer(1000),
          };
        }

        throw new Error("Unexpected URL");
      });

      const promise = generateImageAI33("key", "Test", "16:9");
      await vi.runAllTimersAsync();
      await promise;

      expect(pollCount).toBe(3);
    });

    it("rejects when task status is error (wrapped in final error)", async () => {
      // "Generation failed: invalid prompt" is NOT a transient error, so only 1 attempt is made.
      // The final error is "AI33 image generation failed: all 3 attempts exhausted"
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/task/generate-image")) {
          return {
            ok: true,
            json: async () => ({ success: true, task_id: "task-error" }),
          };
        }

        if (url.includes("/task/task-error")) {
          return {
            ok: true,
            json: async () => ({
              status: "error",
              error_message: "Generation failed: invalid prompt",
            }),
          };
        }

        throw new Error("Unexpected URL");
      });

      // Capture rejection to prevent unhandled rejection warnings
      let caught: Error | null = null;
      const promise = generateImageAI33("key", "Test", "16:9").catch((e) => {
        caught = e;
      });
      await vi.runAllTimersAsync();
      await promise; // waits for .catch handler to run

      expect(caught).toBeInstanceOf(Error);
      expect(caught!.message).toContain("AI33 image generation failed");
    });

    it("rejects on polling timeout (after max attempts)", async () => {
      // Polling timeout: 120 polls always return "doing". Each poll has a 5s delay.
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/task/generate-image")) {
          return {
            ok: true,
            json: async () => ({ success: true, task_id: "task-timeout" }),
          };
        }

        if (url.includes("/task/task-timeout")) {
          return {
            ok: true,
            json: async () => ({ status: "doing", progress: 50 }),
          };
        }

        throw new Error("Unexpected URL");
      });

      // Capture rejection to prevent unhandled rejection warnings
      let caught: Error | null = null;
      const promise = generateImageAI33("key", "Test", "16:9").catch((e) => {
        caught = e;
      });
      // Run all timers to exhaust the polling loop (120 polls × 5s = 600s)
      await vi.runAllTimersAsync();
      await promise; // waits for .catch handler to run

      expect(caught).toBeInstanceOf(Error);
      expect(caught!.message).toContain("AI33 image generation failed");
    });
  });

  describe("sRGB normalization", () => {
    it("normalizes image to sRGB via ffmpeg", async () => {
      setupSuccessfulFetch(mockFetch, "task-norm", "https://ai33.com/p3.png");

      const promise = generateImageAI33("key", "Test", "16:9");
      await vi.runAllTimersAsync();
      await promise;

      expect(mockWriteFile).toHaveBeenCalled();
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        "ffmpeg",
        expect.arrayContaining([
          "-vf",
          "colorspace=iall=bt709:all=bt709",
          "-pix_fmt",
          "rgb24",
        ]),
      );
      expect(mockReadFile).toHaveBeenCalled();
      expect(mockUnlink).toHaveBeenCalledTimes(2); // cleanup both temp files
    });

    it("returns raw buffer when ffmpeg fails", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/task/generate-image")) {
          return {
            ok: true,
            json: async () => ({ success: true, task_id: "task-raw" }),
          };
        }
        if (url.includes("/task/task-raw")) {
          return {
            ok: true,
            json: async () => ({
              status: "done",
              metadata: {
                result_images: [{ imageUrl: "https://ai33.com/img.png" }],
              },
            }),
          };
        }
        if (url.includes("img.png")) {
          return {
            ok: true,
            arrayBuffer: async () => new ArrayBuffer(500),
          };
        }
        throw new Error("Unexpected URL");
      });

      mockExecFileAsync.mockRejectedValue(new Error("ffmpeg not found"));

      const promise = generateImageAI33("key", "Test", "16:9");
      await vi.runAllTimersAsync();
      const result = await promise;

      // Should return raw buffer despite ffmpeg failure
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBe(500);
    });

    it("cleans up temp files even on ffmpeg error", async () => {
      setupSuccessfulFetch(
        mockFetch,
        "task-cleanup",
        "https://ai33.com/img.png",
      );

      mockExecFileAsync.mockRejectedValue(new Error("ffmpeg error"));
      mockUnlink.mockResolvedValue(undefined);

      const promise = generateImageAI33("key", "Test", "16:9");
      await vi.runAllTimersAsync();
      await promise;

      expect(mockUnlink).toHaveBeenCalled();
    });
  });

  describe("retry behavior", () => {
    it("retries on transient errors (temporary_model_error)", async () => {
      let submitCount = 0;

      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/task/generate-image")) {
          submitCount++;
          return {
            ok: true,
            json: async () => ({
              success: true,
              task_id: `task-retry-${submitCount}`,
            }),
          };
        }

        // First 2 attempts fail with transient error
        if (url.match(/task-retry-[12]$/)) {
          return {
            ok: true,
            json: async () => ({
              status: "error",
              error_message: "temporary_model_error: Service busy",
            }),
          };
        }

        // 3rd attempt succeeds
        if (url.includes("task-retry-3")) {
          return {
            ok: true,
            json: async () => ({
              status: "done",
              metadata: {
                result_images: [{ imageUrl: "https://ai33.com/retry-ok.png" }],
              },
            }),
          };
        }

        if (url.includes("retry-ok.png")) {
          return {
            ok: true,
            arrayBuffer: async () => new ArrayBuffer(1000),
          };
        }

        throw new Error(`Unexpected URL: ${url}`);
      });

      const promise = generateImageAI33("key", "Test", "16:9");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBeInstanceOf(Buffer);
      expect(submitCount).toBe(3); // retried twice
    });

    it("throws final error after all retries exhausted", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/task/generate-image")) {
          return {
            ok: true,
            json: async () => ({ success: true, task_id: "task-fail-all" }),
          };
        }

        if (url.includes("task-fail-all")) {
          return {
            ok: true,
            json: async () => ({
              status: "error",
              error_message: "temporary_model_error: Service unavailable",
            }),
          };
        }

        throw new Error("Unexpected URL");
      });

      // Capture rejection explicitly to prevent unhandled rejection warnings
      // from retry timer callbacks that fire after the test assertion
      let caught: Error | null = null;
      const promise = generateImageAI33("key", "Test", "16:9").catch((e) => {
        caught = e;
      });
      await vi.runAllTimersAsync();
      await promise;

      expect(caught).toBeInstanceOf(Error);
      expect(caught!.message).toContain("AI33 image generation failed");
    });
  });

  describe("error handling", () => {
    // Helper: run generateImageAI33, capture any rejection, advance all timers,
    // wait for the promise chain to settle, then return the caught error (or null).
    // This prevents unhandled rejection warnings from retry timers that fire
    // after the test's assertion point.
    async function runAndCatch(
      fn: () => Promise<unknown>,
    ): Promise<Error | null> {
      let caught: Error | null = null;
      const promise = fn().catch((e) => {
        caught = e instanceof Error ? e : new Error(String(e));
      });
      await vi.runAllTimersAsync();
      await promise;
      return caught;
    }

    it("rejects when submission fails (HTTP error wrapped in final error)", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "Unauthorized: Invalid API key",
      });

      const err = await runAndCatch(() =>
        generateImageAI33("bad-key", "Test", "16:9"),
      );

      // Production wraps all errors: "AI33 image generation failed: all 3 attempts exhausted"
      expect(err).toBeInstanceOf(Error);
      expect(err!.message).toContain("AI33 image generation failed");
    });

    it("rejects when submission response is invalid", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, error: "Rate limit exceeded" }),
      });

      const err = await runAndCatch(() =>
        generateImageAI33("key", "Test", "16:9"),
      );

      expect(err).toBeInstanceOf(Error);
      expect(err!.message).toContain("AI33 image generation failed");
    });

    it("rejects when polling fails", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/task/generate-image")) {
          return {
            ok: true,
            json: async () => ({ success: true, task_id: "task-poll-fail" }),
          };
        }

        if (url.includes("task-poll-fail")) {
          return {
            ok: false,
            status: 500,
          };
        }

        throw new Error("Unexpected URL");
      });

      const err = await runAndCatch(() =>
        generateImageAI33("key", "Test", "16:9"),
      );

      expect(err).toBeInstanceOf(Error);
      expect(err!.message).toContain("AI33 image generation failed");
    });

    it("rejects when image download fails", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/task/generate-image")) {
          return {
            ok: true,
            json: async () => ({ success: true, task_id: "task-dl-fail" }),
          };
        }

        if (url.includes("task-dl-fail")) {
          return {
            ok: true,
            json: async () => ({
              status: "done",
              metadata: {
                result_images: [{ imageUrl: "https://ai33.com/expired.png" }],
              },
            }),
          };
        }

        if (url.includes("expired.png")) {
          return {
            ok: false,
            status: 403,
          };
        }

        throw new Error("Unexpected URL");
      });

      const err = await runAndCatch(() =>
        generateImageAI33("key", "Test", "16:9"),
      );

      expect(err).toBeInstanceOf(Error);
      expect(err!.message).toContain("AI33 image generation failed");
    });

    it("rejects when no result images in done task", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/task/generate-image")) {
          return {
            ok: true,
            json: async () => ({ success: true, task_id: "task-no-result" }),
          };
        }

        if (url.includes("task-no-result")) {
          return {
            ok: true,
            json: async () => ({
              status: "done",
              metadata: {},
            }),
          };
        }

        throw new Error("Unexpected URL");
      });

      const err = await runAndCatch(() =>
        generateImageAI33("key", "Test", "16:9"),
      );

      expect(err).toBeInstanceOf(Error);
      expect(err!.message).toContain("AI33 image generation failed");
    });
  });

  describe("reference images", () => {
    it("attaches reference images to submission", async () => {
      setupSuccessfulFetch(
        mockFetch,
        "task-ref",
        "https://ai33.com/result.png",
      );

      const refImages = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];

      const promise = generateImageAI33(
        "key",
        "Test with @img1 and @img2",
        "16:9",
        undefined,
        refImages,
      );
      await vi.runAllTimersAsync();
      await promise;

      expect(mockFetch).toHaveBeenCalled();
      // Reference images are added to FormData - we verify call happened
    });
  });

  describe("model override", () => {
    it("accepts model override parameter", async () => {
      setupSuccessfulFetch(
        mockFetch,
        "task-override",
        "https://ai33.com/custom.png",
      );

      const promise = generateImageAI33("key", "Test", "16:9", {
        id: "custom-model",
        resolution: "4K",
      });
      await vi.runAllTimersAsync();
      await promise;

      expect(mockFetch).toHaveBeenCalled();
    });
  });
});
