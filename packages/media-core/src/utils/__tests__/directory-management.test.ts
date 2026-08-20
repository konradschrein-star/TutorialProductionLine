import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ensureMediaDirectory,
  ensureMediaSubdirectory,
} from "../directory-management.js";
import {
  rmSync,
  existsSync,
  accessSync,
  constants as fsConstants,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Config mock ─────────────────────────────────────────────────────
// Must be hoisted so the import of directory-management (which imports
// @repo/config) picks up the mock.
let mockMediaRoot = join(tmpdir(), `test-media-root-${Date.now()}`);

vi.mock("@repo/config", () => ({
  getConfig: () => ({
    LOCAL_MEDIA_ROOT: mockMediaRoot,
    NODE_ENV: "test",
  }),
}));

describe("directory-management", () => {
  beforeEach(() => {
    // Give each test a fresh temp root with a unique timestamp
    mockMediaRoot = join(tmpdir(), `test-media-root-${Date.now()}`);
  });

  afterEach(() => {
    // Clean up test directories
    try {
      if (existsSync(mockMediaRoot)) {
        rmSync(mockMediaRoot, { recursive: true, force: true });
      }
    } catch (e) {
      console.warn("Failed to cleanup test directory:", e);
    }
  });

  describe("ensureMediaDirectory", () => {
    it("should create a media directory with correct structure", async () => {
      const jobId = "test-job-123";
      const format = "bundestag";

      const result = await ensureMediaDirectory(format, jobId);

      // Verify directory exists
      expect(existsSync(result)).toBe(true);

      // Verify correct path
      const expectedPath = join(mockMediaRoot, format, jobId);
      expect(result).toBe(expectedPath);

      // Verify directory is readable and writable
      expect(() => {
        accessSync(result, fsConstants.R_OK | fsConstants.W_OK);
      }).not.toThrow();
    });

    it("should handle existing directories gracefully", async () => {
      const jobId = "test-job-456";
      const format = "bundestag";

      // Create first time
      const path1 = await ensureMediaDirectory(format, jobId);
      // Create second time (directory already exists)
      const path2 = await ensureMediaDirectory(format, jobId);

      expect(path1).toBe(path2);
      expect(existsSync(path2)).toBe(true);
    });

    it("should throw error with descriptive message on permission failure", async () => {
      // Simulate a directory that cannot be created by using a path that
      // starts with a NUL byte — Node's mkdir rejects this on all platforms.
      // This tests the error-handling branch without platform-specific path assumptions.
      const savedRoot = mockMediaRoot;
      // Use a path with a null byte which is always invalid on all OS
      mockMediaRoot = "/tmp/\0invalid";

      try {
        await expect(
          ensureMediaDirectory("bundestag", "test-job"),
        ).rejects.toThrow();
      } finally {
        mockMediaRoot = savedRoot;
      }
    });
  });

  describe("ensureMediaSubdirectory", () => {
    it("should create a media subdirectory with asset type", async () => {
      const jobId = "test-job-789";
      const format = "bundestag";
      const assetType = "clips";

      const result = await ensureMediaSubdirectory(format, jobId, assetType);

      // Verify directory exists
      expect(existsSync(result)).toBe(true);

      // Verify correct path
      const expectedPath = join(mockMediaRoot, format, jobId, assetType);
      expect(result).toBe(expectedPath);

      // Verify directory is readable and writable
      expect(() => {
        accessSync(result, fsConstants.R_OK | fsConstants.W_OK);
      }).not.toThrow();
    });

    it("should create multiple subdirectories for different asset types", async () => {
      const jobId = "test-job-multi";
      const format = "bundestag";

      const clipsDir = await ensureMediaSubdirectory(format, jobId, "clips");
      const playbooksDir = await ensureMediaSubdirectory(
        format,
        jobId,
        "playbooks",
      );
      const rendersDir = await ensureMediaSubdirectory(
        format,
        jobId,
        "renders",
      );

      expect(existsSync(clipsDir)).toBe(true);
      expect(existsSync(playbooksDir)).toBe(true);
      expect(existsSync(rendersDir)).toBe(true);

      // Verify they're different paths
      expect(clipsDir).not.toBe(playbooksDir);
      expect(playbooksDir).not.toBe(rendersDir);
    });
  });
});
