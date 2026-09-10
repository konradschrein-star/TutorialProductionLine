/**
 * R2 Download Tests
 *
 * Tests for downloadFromR2 - local file copy operation that preserves
 * the original R2 download interface for backwards compatibility.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { downloadFromR2 } from "../r2/download.js";

// Mock Node.js fs/promises
const mockCopyFile = vi.fn();
const mockMkdir = vi.fn();

vi.mock("node:fs/promises", () => ({
  copyFile: (...args: any[]) => mockCopyFile(...args),
  mkdir: (...args: any[]) => mockMkdir(...args),
}));

// Mock path
vi.mock("node:path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:path")>();
  return {
    ...actual,
    dirname: (path: string) => {
      const parts = path.split("/");
      parts.pop();
      return parts.join("/");
    },
  };
});

describe("downloadFromR2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockCopyFile.mockResolvedValue(undefined);
  });

  describe("successful downloads", () => {
    it("copies file from source key to destination path", async () => {
      await downloadFromR2(
        null,
        "unused-bucket",
        "/media/source.mp4",
        "/tmp/dest.mp4"
      );

      expect(mockCopyFile).toHaveBeenCalledWith("/media/source.mp4", "/tmp/dest.mp4");
    });

    it("creates destination directory if it doesn't exist", async () => {
      await downloadFromR2(
        null,
        "bucket",
        "/media/video.mp4",
        "/tmp/downloads/subfolder/video.mp4"
      );

      expect(mockMkdir).toHaveBeenCalledWith(
        "/tmp/downloads/subfolder",
        { recursive: true }
      );
    });

    it("handles various file paths", async () => {
      const testCases = [
        {
          key: "/media/ch1/j1/audio.mp3",
          dest: "/tmp/audio.mp3",
        },
        {
          key: "/opt/storage/thumb.jpg",
          dest: "/var/tmp/thumbnail.jpg",
        },
        {
          key: "/storage/videos/final.webm",
          dest: "/home/user/video.webm",
        },
      ];

      for (const { key, dest } of testCases) {
        vi.clearAllMocks();

        await downloadFromR2(null, "bucket", key, dest);

        expect(mockCopyFile).toHaveBeenCalledWith(key, dest);
      }
    });

    it("completes without returning a value", async () => {
      const result = await downloadFromR2(
        null,
        "bucket",
        "/media/file.mp4",
        "/tmp/file.mp4"
      );

      expect(result).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("throws error when mkdir fails", async () => {
      mockMkdir.mockRejectedValue(new Error("Permission denied"));

      await expect(
        downloadFromR2(null, "bucket", "/media/file.mp4", "/tmp/file.mp4")
      ).rejects.toThrow("Asset copy failed for /media/file.mp4");
    });

    it("throws error when copyFile fails", async () => {
      mockCopyFile.mockRejectedValue(new Error("Source file not found"));

      await expect(
        downloadFromR2(null, "bucket", "/media/missing.mp4", "/tmp/dest.mp4")
      ).rejects.toThrow("Asset copy failed for /media/missing.mp4");
    });

    it("includes original error in thrown error", async () => {
      const originalError = new Error("EACCES: permission denied");
      mockCopyFile.mockRejectedValue(originalError);

      try {
        await downloadFromR2(null, "bucket", "/media/file.mp4", "/tmp/file.mp4");
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("Asset copy failed");
        expect(err.message).toContain("EACCES");
      }
    });

    it("includes key path in error message", async () => {
      mockCopyFile.mockRejectedValue(new Error("File not found"));

      try {
        await downloadFromR2(
          null,
          "bucket",
          "/media/channel1/job123/video.mp4",
          "/tmp/video.mp4"
        );
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("/media/channel1/job123/video.mp4");
      }
    });
  });

  describe("backwards compatibility", () => {
    it("ignores unused client parameter", async () => {
      const mockClient = { some: "object" };
      await downloadFromR2(mockClient, "bucket", "/media/file.mp4", "/tmp/file.mp4");

      expect(mockCopyFile).toHaveBeenCalled();
    });

    it("ignores unused bucket parameter", async () => {
      await downloadFromR2(null, "my-r2-bucket-name", "/media/file.mp4", "/tmp/file.mp4");

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

      await downloadFromR2(null, "bucket", "/media/file.mp4", "/tmp/file.mp4");

      expect(callOrder).toEqual(["mkdir", "copyFile"]);
    });
  });

  describe("directory creation", () => {
    it("uses recursive option for mkdir", async () => {
      await downloadFromR2(
        null,
        "bucket",
        "/media/file.mp4",
        "/tmp/deep/nested/path/file.mp4"
      );

      expect(mockMkdir).toHaveBeenCalledWith(
        "/tmp/deep/nested/path",
        { recursive: true }
      );
    });

    it("handles root-level destinations", async () => {
      await downloadFromR2(
        null,
        "bucket",
        "/media/file.mp4",
        "/file.mp4"
      );

      expect(mockMkdir).toHaveBeenCalledWith("", { recursive: true });
    });
  });
});
