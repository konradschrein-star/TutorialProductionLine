/**
 * Temp Files Utilities Tests
 *
 * Tests for temporary directory creation and cleanup during render jobs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs/promises
const mockMkdir = vi.fn();
const mockRm = vi.fn();

vi.mock("node:fs/promises", () => ({
  mkdir: (...args: any[]) => mockMkdir(...args),
  rm: (...args: any[]) => mockRm(...args),
}));

// Mock path - join just concatenates with "/"
vi.mock("node:path", () => ({
  join: (...parts: string[]) => parts.join("/"),
}));

// Mock os - always return /tmp so paths are predictable across OSes
vi.mock("node:os", () => ({
  tmpdir: () => "/tmp",
}));

import { createTempDir, cleanupTempDir } from "../utils/temp-files.js";

describe("createTempDir", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    // createTempDir also calls rm() to clean any pre-existing directory first
    mockRm.mockResolvedValue(undefined);
  });

  it("creates temp directory with job ID", async () => {
    const jobId = "550e8400-e29b-41d4-a716-446655440000";
    const path = await createTempDir(jobId);

    expect(mockMkdir).toHaveBeenCalledWith(`/tmp/render-${jobId}`, {
      recursive: true,
    });
    expect(path).toBe(`/tmp/render-${jobId}`);
  });

  it("returns absolute path to temp directory", async () => {
    const path = await createTempDir("test-job-123");

    expect(path).toBe("/tmp/render-test-job-123");
  });

  it("uses recursive mkdir option", async () => {
    await createTempDir("job-456");

    expect(mockMkdir).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ recursive: true }),
    );
  });

  it("handles various job ID formats", async () => {
    const jobIds = [
      "550e8400-e29b-41d4-a716-446655440000", // UUID
      "job-123", // Simple ID
      "test_job_with_underscores", // Underscores
      "job.with.dots", // Dots
    ];

    for (const jobId of jobIds) {
      vi.clearAllMocks();
      const path = await createTempDir(jobId);

      expect(path).toBe(`/tmp/render-${jobId}`);
      expect(mockMkdir).toHaveBeenCalled();
    }
  });

  it("throws error when mkdir fails", async () => {
    mockMkdir.mockRejectedValue(new Error("Permission denied"));

    await expect(createTempDir("job-123")).rejects.toThrow("Permission denied");
  });
});

describe("cleanupTempDir", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRm.mockResolvedValue(undefined);
  });

  it("removes temp directory recursively", async () => {
    const tmpDir = "/tmp/render-job-123";
    await cleanupTempDir(tmpDir);

    expect(mockRm).toHaveBeenCalledWith(tmpDir, {
      recursive: true,
      force: true,
    });
  });

  it("uses force option to ignore missing directories", async () => {
    await cleanupTempDir("/tmp/some-dir");

    expect(mockRm).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ force: true }),
    );
  });

  it("does not throw error when rm fails", async () => {
    mockRm.mockRejectedValue(new Error("Directory not found"));

    // Should not throw - cleanup failures are logged but not fatal
    await expect(cleanupTempDir("/tmp/missing")).resolves.toBeUndefined();
  });

  it("handles permission errors gracefully", async () => {
    mockRm.mockRejectedValue(new Error("EACCES: permission denied"));

    await expect(cleanupTempDir("/tmp/protected")).resolves.toBeUndefined();
  });

  it("handles rm errors without throwing", async () => {
    const errors = [
      new Error("ENOENT: no such file or directory"),
      new Error("EBUSY: resource busy"),
      new Error("EPERM: operation not permitted"),
    ];

    for (const error of errors) {
      vi.clearAllMocks();
      mockRm.mockRejectedValue(error);

      await expect(cleanupTempDir("/tmp/dir")).resolves.toBeUndefined();
    }
  });

  it("completes successfully when rm succeeds", async () => {
    mockRm.mockResolvedValue(undefined);

    const result = await cleanupTempDir("/tmp/success");

    expect(result).toBeUndefined();
    expect(mockRm).toHaveBeenCalled();
  });

  it("handles various directory paths", async () => {
    const paths = [
      "/tmp/render-job-1",
      "/var/tmp/deep/nested/path",
      "/tmp/job-with-special-chars_123",
    ];

    for (const path of paths) {
      vi.clearAllMocks();
      await cleanupTempDir(path);

      expect(mockRm).toHaveBeenCalledWith(path, expect.any(Object));
    }
  });
});

describe("createTempDir and cleanupTempDir integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
  });

  it("creates and then cleans up the same directory", async () => {
    const jobId = "test-job-789";

    const tmpDir = await createTempDir(jobId);
    await cleanupTempDir(tmpDir);

    expect(mockMkdir).toHaveBeenCalledWith(
      "/tmp/render-test-job-789",
      expect.any(Object),
    );
    // mockRm is called twice: once inside createTempDir (pre-clean) and once in cleanupTempDir
    expect(mockRm).toHaveBeenCalledWith(
      "/tmp/render-test-job-789",
      expect.any(Object),
    );
  });

  it("cleanup does not fail even if directory was never created", async () => {
    mockRm.mockRejectedValue(new Error("Directory does not exist"));

    // Simulate cleanup without create
    await expect(
      cleanupTempDir("/tmp/render-never-created"),
    ).resolves.toBeUndefined();
  });
});
