import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock exiftool-vendored before importing the module under test.
// injectMetadata has no pure-function surface area to test without mocking
// the exiftool dependency — the entire function body is an async IO call.
// ---------------------------------------------------------------------------

const mockWrite = vi.fn();

vi.mock("exiftool-vendored", () => ({
  exiftool: {
    write: mockWrite,
  },
}));

// Mock node:fs so that existsSync always returns true in tests.
// Production code calls existsSync(normalizedPath) before writing metadata.
const mockExistsSync = vi.fn().mockReturnValue(true);

vi.mock("node:fs", () => ({
  existsSync: (...args: any[]) => mockExistsSync(...args),
}));

// Mock node:path so normalize() is a no-op in tests.
// On Windows, normalize("/tmp/video.mp4") → "\\tmp\\video.mp4" which would
// break assertions that expect the original POSIX path to be passed through.
vi.mock("node:path", () => ({
  normalize: (p: string) => p,
}));

// Import after mocks are registered
const { injectMetadata } = await import("../ffmpeg/metadata.js");

// ---------------------------------------------------------------------------
// injectMetadata
// ---------------------------------------------------------------------------

describe("injectMetadata", () => {
  beforeEach(() => {
    mockWrite.mockReset();
    mockExistsSync.mockReturnValue(true);
  });

  // ── Happy path ────────────────────────────────────────────────────

  it("resolves without throwing when exiftool.write succeeds", async () => {
    mockWrite.mockResolvedValue(undefined);
    await expect(
      injectMetadata("/tmp/video.mp4", { Author: "Test" }),
    ).resolves.toBeUndefined();
  });

  it("passes the video path as the first argument to exiftool.write", async () => {
    mockWrite.mockResolvedValue(undefined);
    const videoPath = "/renders/job-123/final.mp4";
    await injectMetadata(videoPath, { Comment: "hello" });
    expect(mockWrite).toHaveBeenCalledWith(videoPath, expect.any(Object));
  });

  it("passes the metadata object as the second argument to exiftool.write", async () => {
    mockWrite.mockResolvedValue(undefined);
    const metadata = {
      Author: "Content Forge",
      Comment: "v3-render",
      Copyright: "2026",
    };
    await injectMetadata("/tmp/video.mp4", metadata);
    expect(mockWrite).toHaveBeenCalledWith(expect.any(String), metadata);
  });

  it("calls exiftool.write exactly once per invocation", async () => {
    mockWrite.mockResolvedValue(undefined);
    await injectMetadata("/tmp/video.mp4", { Title: "Test" });
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  it("handles an empty metadata object without throwing", async () => {
    mockWrite.mockResolvedValue(undefined);
    await expect(injectMetadata("/tmp/video.mp4", {})).resolves.toBeUndefined();
    expect(mockWrite).toHaveBeenCalledWith("/tmp/video.mp4", {});
  });

  it("handles metadata with multiple keys", async () => {
    mockWrite.mockResolvedValue(undefined);
    const metadata: Record<string, string> = {
      Author: "Content Forge",
      Comment: "unique-fingerprint-abc123",
      Copyright: "2026 Content Forge",
      Title: "Episode 42",
    };
    await injectMetadata("/renders/final.mp4", metadata);
    expect(mockWrite).toHaveBeenCalledWith("/renders/final.mp4", metadata);
  });

  it("handles paths with spaces and special characters", async () => {
    mockWrite.mockResolvedValue(undefined);
    const path = "/renders/my job/final output (v2).mp4";
    await injectMetadata(path, { Author: "Test" });
    expect(mockWrite).toHaveBeenCalledWith(path, { Author: "Test" });
  });

  it("handles metadata values containing quotes", async () => {
    mockWrite.mockResolvedValue(undefined);
    const metadata = { Comment: 'She said "hello"', Author: "O'Brien" };
    await injectMetadata("/tmp/video.mp4", metadata);
    expect(mockWrite).toHaveBeenCalledWith("/tmp/video.mp4", metadata);
  });

  it("handles metadata values containing backslashes", async () => {
    mockWrite.mockResolvedValue(undefined);
    const metadata = { Comment: "path\\to\\something", Author: "Test\\User" };
    await injectMetadata("/tmp/video.mp4", metadata);
    expect(mockWrite).toHaveBeenCalledWith("/tmp/video.mp4", metadata);
  });

  it("handles metadata values containing commas", async () => {
    mockWrite.mockResolvedValue(undefined);
    const metadata = { Keywords: "news, politics, 2026", Tags: "a,b,c" };
    await injectMetadata("/tmp/video.mp4", metadata);
    expect(mockWrite).toHaveBeenCalledWith("/tmp/video.mp4", metadata);
  });

  // ── Error path ────────────────────────────────────────────────────

  it("throws when exiftool.write rejects", async () => {
    mockWrite.mockRejectedValue(new Error("exiftool crashed"));
    await expect(
      injectMetadata("/tmp/video.mp4", { Author: "Test" }),
    ).rejects.toThrow();
  });

  it("wraps the underlying error in a descriptive Error message", async () => {
    mockWrite.mockRejectedValue(new Error("permission denied"));
    await expect(injectMetadata("/tmp/video.mp4", {})).rejects.toThrow(
      "Metadata injection failed:",
    );
  });

  it("error message includes context about the underlying failure", async () => {
    const underlying = new Error("disk full");
    mockWrite.mockRejectedValue(underlying);
    await expect(injectMetadata("/tmp/video.mp4", {})).rejects.toThrow(
      /Metadata injection failed/,
    );
  });

  it("throws an Error instance (not a raw rejection value)", async () => {
    mockWrite.mockRejectedValue(new Error("timeout"));
    await expect(injectMetadata("/tmp/video.mp4", {})).rejects.toBeInstanceOf(
      Error,
    );
  });

  it("does not silently swallow non-Error rejection values", async () => {
    // exiftool could in theory reject with a string
    mockWrite.mockRejectedValue("exiftool: file not found");
    await expect(injectMetadata("/tmp/video.mp4", {})).rejects.toThrow(
      /Metadata injection failed/,
    );
  });

  // ── Sequential invocations ────────────────────────────────────────

  it("can be called multiple times for different files independently", async () => {
    mockWrite.mockResolvedValue(undefined);

    await injectMetadata("/renders/a.mp4", { Author: "Alpha" });
    await injectMetadata("/renders/b.mp4", { Author: "Beta" });

    expect(mockWrite).toHaveBeenCalledTimes(2);
    expect(mockWrite).toHaveBeenNthCalledWith(1, "/renders/a.mp4", {
      Author: "Alpha",
    });
    expect(mockWrite).toHaveBeenNthCalledWith(2, "/renders/b.mp4", {
      Author: "Beta",
    });
  });

  it("a failure on first call does not affect a successful second call", async () => {
    mockWrite
      .mockRejectedValueOnce(new Error("first failure"))
      .mockResolvedValueOnce(undefined);

    await expect(
      injectMetadata("/renders/a.mp4", { Author: "Alpha" }),
    ).rejects.toThrow("Metadata injection failed:");

    await expect(
      injectMetadata("/renders/b.mp4", { Author: "Beta" }),
    ).resolves.toBeUndefined();
  });
});
