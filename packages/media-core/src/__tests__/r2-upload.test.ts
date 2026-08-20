/**
 * R2 Upload Tests
 *
 * Tests for uploadToR2 - local file copy operation that preserves
 * the original R2 upload interface for backwards compatibility.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { uploadToR2 } from "../r2/upload.js";

// Mock Node.js fs/promises
const mockCopyFile = vi.fn();
const mockStat = vi.fn();
const mockMkdir = vi.fn();

vi.mock("node:fs/promises", () => ({
  copyFile: (...args: any[]) => mockCopyFile(...args),
  stat: (...args: any[]) => mockStat(...args),
  mkdir: (...args: any[]) => mockMkdir(...args),
}));

// Mock path
vi.mock("node:path", () => ({
  dirname: (path: string) => {
    const parts = path.split("/");
    parts.pop();
    return parts.join("/");
  },
}));

describe("uploadToR2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockCopyFile.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({ size: 1024 });
  });

  describe("successful uploads", () => {
    it("copies file from source to destination", async () => {
      const result = await uploadToR2(
        null,
        "unused-bucket",
        "/tmp/source.mp4",
        "/media/dest.mp4",
      );

      expect(mockCopyFile).toHaveBeenCalledWith(
        "/tmp/source.mp4",
        "/media/dest.mp4",
      );
      expect(result).toEqual({ size_bytes: 1024 });
    });

    it("creates destination directory if it doesn't exist", async () => {
      await uploadToR2(
        null,
        "unused-bucket",
        "/tmp/video.mp4",
        "/media/channel1/job123/video.mp4",
      );

      expect(mockMkdir).toHaveBeenCalledWith("/media/channel1/job123", {
        recursive: true,
      });
    });

    it("returns file size in bytes", async () => {
      mockStat.mockResolvedValue({ size: 5242880 }); // 5MB

      const result = await uploadToR2(
        null,
        "bucket",
        "/tmp/large.mp4",
        "/media/large.mp4",
      );

      expect(result.size_bytes).toBe(5242880);
    });

    it("stats the destination file after copying", async () => {
      await uploadToR2(null, "bucket", "/tmp/source.mp4", "/media/dest.mp4");

      expect(mockStat).toHaveBeenCalledWith("/media/dest.mp4");
    });

    it("handles various file paths", async () => {
      const testCases = [
        {
          source: "/tmp/audio.mp3",
          dest: "/media/ch1/j1/audio.mp3",
        },
        {
          source: "/var/tmp/thumbnail.jpg",
          dest: "/opt/media/thumb.jpg",
        },
        {
          source: "/home/user/video.webm",
          dest: "/storage/videos/final.webm",
        },
      ];

      for (const { source, dest } of testCases) {
        vi.clearAllMocks();
        mockStat.mockResolvedValue({ size: 1000 });

        await uploadToR2(null, "bucket", source, dest);

        expect(mockCopyFile).toHaveBeenCalledWith(source, dest);
      }
    });
  });

  describe("error handling", () => {
    it("throws error when mkdir fails", async () => {
      mockMkdir.mockRejectedValue(new Error("Permission denied"));

      await expect(
        uploadToR2(null, "bucket", "/tmp/file.mp4", "/media/file.mp4"),
      ).rejects.toThrow("Asset save failed for /media/file.mp4");
    });

    it("throws error when copyFile fails", async () => {
      mockCopyFile.mockRejectedValue(new Error("Source file not found"));

      await expect(
        uploadToR2(null, "bucket", "/tmp/missing.mp4", "/media/dest.mp4"),
      ).rejects.toThrow("Asset save failed for /media/dest.mp4");
    });

    it("throws error when stat fails", async () => {
      mockStat.mockRejectedValue(new Error("File disappeared"));

      await expect(
        uploadToR2(null, "bucket", "/tmp/file.mp4", "/media/file.mp4"),
      ).rejects.toThrow("Asset save failed for /media/file.mp4");
    });

    it("includes original error in thrown error", async () => {
      const originalError = new Error("ENOSPC: no space left on device");
      mockCopyFile.mockRejectedValue(originalError);

      try {
        await uploadToR2(null, "bucket", "/tmp/file.mp4", "/media/file.mp4");
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("Asset save failed");
        expect(err.message).toContain("ENOSPC");
      }
    });
  });

  describe("backwards compatibility", () => {
    it("ignores unused client parameter", async () => {
      const mockClient = { some: "object" };
      await uploadToR2(
        mockClient,
        "bucket",
        "/tmp/file.mp4",
        "/media/file.mp4",
      );

      expect(mockCopyFile).toHaveBeenCalled();
    });

    it("ignores unused bucket parameter", async () => {
      await uploadToR2(
        null,
        "my-r2-bucket-name",
        "/tmp/file.mp4",
        "/media/file.mp4",
      );

      expect(mockCopyFile).toHaveBeenCalled();
    });
  });

  describe("execution order", () => {
    it("creates directory before copying file", async () => {
      const callOrder: string[] = [];

      mockMkdir.mockImplementation(async () => {
        callOrder.push("mkdir");
      });

      mockCopyFile.mockImplementation(async () => {
        callOrder.push("copyFile");
      });

      mockStat.mockResolvedValue({ size: 100 });

      await uploadToR2(null, "bucket", "/tmp/file.mp4", "/media/file.mp4");

      expect(callOrder).toEqual(["mkdir", "copyFile"]);
    });

    it("stats file after copying", async () => {
      const callOrder: string[] = [];

      mockCopyFile.mockImplementation(async () => {
        callOrder.push("copyFile");
      });

      mockStat.mockImplementation(async () => {
        callOrder.push("stat");
        return { size: 100 };
      });

      await uploadToR2(null, "bucket", "/tmp/file.mp4", "/media/file.mp4");

      // Production code: stat(source) → mkdir → copyFile → stat(dest)
      // The destination stat always comes after copyFile
      const copyIdx = callOrder.indexOf("copyFile");
      const lastStatIdx = callOrder.lastIndexOf("stat");
      expect(copyIdx).toBeGreaterThan(-1);
      expect(lastStatIdx).toBeGreaterThan(copyIdx);
    });
  });

  describe("file sizes", () => {
    it("handles zero-byte files", async () => {
      mockStat.mockResolvedValue({ size: 0 });

      const result = await uploadToR2(
        null,
        "bucket",
        "/tmp/empty.txt",
        "/media/empty.txt",
      );

      expect(result.size_bytes).toBe(0);
    });

    it("handles large files", async () => {
      const largeSize = 10 * 1024 * 1024 * 1024; // 10GB
      mockStat.mockResolvedValue({ size: largeSize });

      const result = await uploadToR2(
        null,
        "bucket",
        "/tmp/large.mp4",
        "/media/large.mp4",
      );

      expect(result.size_bytes).toBe(largeSize);
    });
  });
});
