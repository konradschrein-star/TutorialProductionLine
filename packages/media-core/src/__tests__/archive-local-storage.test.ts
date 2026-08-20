/**
 * Local Storage Archive Tests
 *
 * Tests for local disk storage utilities used for archived finished assets.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReadStream } from "node:fs";

// Mock fs/promises
const mockAccess = vi.fn();
const mockMkdir = vi.fn();
const mockWriteFile = vi.fn();
const mockRm = vi.fn();

vi.mock("node:fs/promises", () => ({
  default: {
    access: (...args: any[]) => mockAccess(...args),
    mkdir: (...args: any[]) => mockMkdir(...args),
    writeFile: (...args: any[]) => mockWriteFile(...args),
    rm: (...args: any[]) => mockRm(...args),
  },
}));

// Mock fs (for sync and stream operations)
const mockCreateReadStream = vi.fn();
const mockExistsSync = vi.fn();

vi.mock("node:fs", () => ({
  createReadStream: (...args: any[]) => mockCreateReadStream(...args),
  existsSync: (...args: any[]) => mockExistsSync(...args),
}));

// Mock path
vi.mock("node:path", () => ({
  default: {
    join: (...parts: string[]) => parts.join("/"),
  },
}));

import {
  getLocalAssetPath,
  localAssetExists,
  saveLocalAsset,
  deleteLocalAssets,
  streamLocalAsset,
  localAssetExistsSync,
} from "../archive/local-storage.js";

describe("getLocalAssetPath", () => {
  it("constructs path from root, jobId, and filename", () => {
    const path = getLocalAssetPath("/opt/media", "job-123", "final.mp4");

    expect(path).toBe("/opt/media/job-123/final.mp4");
  });

  it("handles various filename types", () => {
    const testCases = [
      { filename: "final.mp4", expected: "/media/j1/final.mp4" },
      { filename: "audio.mp3", expected: "/media/j1/audio.mp3" },
      { filename: "thumbnail.jpg", expected: "/media/j1/thumbnail.jpg" },
      { filename: "subtitle.srt", expected: "/media/j1/subtitle.srt" },
    ];

    testCases.forEach(({ filename, expected }) => {
      const path = getLocalAssetPath("/media", "j1", filename);
      expect(path).toBe(expected);
    });
  });

  it("handles different root paths", () => {
    const roots = ["/opt/content-forge/media", "/var/media", "/storage"];

    roots.forEach((root) => {
      const path = getLocalAssetPath(root, "job-1", "file.mp4");
      expect(path).toBe(`${root}/job-1/file.mp4`);
    });
  });
});

describe("localAssetExists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when asset exists", async () => {
    mockAccess.mockResolvedValue(undefined);

    const exists = await localAssetExists("/media", "job-123", "final.mp4");

    expect(exists).toBe(true);
    expect(mockAccess).toHaveBeenCalledWith("/media/job-123/final.mp4");
  });

  it("returns false when asset does not exist", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));

    const exists = await localAssetExists("/media", "job-456", "missing.mp4");

    expect(exists).toBe(false);
  });

  it("returns false on permission errors", async () => {
    mockAccess.mockRejectedValue(new Error("EACCES: permission denied"));

    const exists = await localAssetExists("/media", "job-789", "file.mp4");

    expect(exists).toBe(false);
  });

  it("checks correct path", async () => {
    mockAccess.mockResolvedValue(undefined);

    await localAssetExists("/opt/media", "job-abc", "video.mp4");

    expect(mockAccess).toHaveBeenCalledWith("/opt/media/job-abc/video.mp4");
  });
});

describe("saveLocalAsset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it("creates directory and saves file", async () => {
    const buffer = Buffer.from("video data");
    const path = await saveLocalAsset("/media", "job-123", "final.mp4", buffer);

    expect(mockMkdir).toHaveBeenCalledWith("/media/job-123", { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith("/media/job-123/final.mp4", buffer);
    expect(path).toBe("/media/job-123/final.mp4");
  });

  it("returns full file path", async () => {
    const buffer = Buffer.from("data");
    const path = await saveLocalAsset("/opt/storage", "j1", "file.txt", buffer);

    expect(path).toBe("/opt/storage/j1/file.txt");
  });

  it("creates directory with recursive option", async () => {
    const buffer = Buffer.from("data");
    await saveLocalAsset("/media", "job-456", "file.mp4", buffer);

    expect(mockMkdir).toHaveBeenCalledWith(
      "/media/job-456",
      expect.objectContaining({ recursive: true })
    );
  });

  it("saves buffer to correct path", async () => {
    const buffer = Buffer.from("test content");
    await saveLocalAsset("/storage", "job-789", "audio.mp3", buffer);

    expect(mockWriteFile).toHaveBeenCalledWith(
      "/storage/job-789/audio.mp3",
      buffer
    );
  });

  it("throws error when mkdir fails", async () => {
    mockMkdir.mockRejectedValue(new Error("Permission denied"));

    await expect(
      saveLocalAsset("/media", "job-1", "file.mp4", Buffer.from("data"))
    ).rejects.toThrow("Permission denied");
  });

  it("throws error when writeFile fails", async () => {
    mockWriteFile.mockRejectedValue(new Error("Disk full"));

    await expect(
      saveLocalAsset("/media", "job-2", "file.mp4", Buffer.from("data"))
    ).rejects.toThrow("Disk full");
  });

  it("handles large buffers", async () => {
    const largeBuffer = Buffer.alloc(1024); // 1KB (large allocation causes worker OOM in CI)
    await saveLocalAsset("/media", "job-large", "large.mp4", largeBuffer);

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.any(String),
      largeBuffer
    );
  });
});

describe("deleteLocalAssets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRm.mockResolvedValue(undefined);
  });

  it("removes entire job directory", async () => {
    await deleteLocalAssets("/media", "job-123");

    expect(mockRm).toHaveBeenCalledWith("/media/job-123", {
      recursive: true,
      force: true,
    });
  });

  it("uses recursive and force options", async () => {
    await deleteLocalAssets("/storage", "job-456");

    expect(mockRm).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        recursive: true,
        force: true,
      })
    );
  });

  it("throws error when rm fails", async () => {
    mockRm.mockRejectedValue(new Error("Directory in use"));

    await expect(deleteLocalAssets("/media", "job-789")).rejects.toThrow(
      "Directory in use"
    );
  });

  it("handles various root and jobId combinations", async () => {
    const testCases = [
      { root: "/opt/media", jobId: "job-1" },
      { root: "/var/storage", jobId: "abc-123" },
      { root: "/data", jobId: "550e8400-e29b-41d4-a716-446655440000" },
    ];

    for (const { root, jobId } of testCases) {
      vi.clearAllMocks();
      await deleteLocalAssets(root, jobId);

      expect(mockRm).toHaveBeenCalledWith(
        `${root}/${jobId}`,
        expect.any(Object)
      );
    }
  });
});

describe("streamLocalAsset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates read stream for asset", () => {
    const mockStream = { pipe: vi.fn() } as any;
    mockCreateReadStream.mockReturnValue(mockStream);

    const stream = streamLocalAsset("/media", "job-123", "final.mp4");

    expect(mockCreateReadStream).toHaveBeenCalledWith("/media/job-123/final.mp4");
    expect(stream).toBe(mockStream);
  });

  it("returns ReadStream instance", () => {
    const mockStream = { on: vi.fn(), pipe: vi.fn() } as any;
    mockCreateReadStream.mockReturnValue(mockStream);

    const stream = streamLocalAsset("/opt/media", "j1", "video.mp4");

    expect(stream).toBeDefined();
    expect(stream).toBe(mockStream);
  });

  it("handles various file paths", () => {
    const mockStream = {} as any;
    mockCreateReadStream.mockReturnValue(mockStream);

    const paths = [
      { root: "/media", jobId: "j1", filename: "final.mp4" },
      { root: "/storage", jobId: "j2", filename: "audio.mp3" },
      { root: "/data", jobId: "j3", filename: "subtitle.srt" },
    ];

    paths.forEach(({ root, jobId, filename }) => {
      vi.clearAllMocks();
      streamLocalAsset(root, jobId, filename);

      expect(mockCreateReadStream).toHaveBeenCalledWith(
        `${root}/${jobId}/${filename}`
      );
    });
  });
});

describe("localAssetExistsSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when asset exists", () => {
    mockExistsSync.mockReturnValue(true);

    const exists = localAssetExistsSync("/media", "job-123", "final.mp4");

    expect(exists).toBe(true);
    expect(mockExistsSync).toHaveBeenCalledWith("/media/job-123/final.mp4");
  });

  it("returns false when asset does not exist", () => {
    mockExistsSync.mockReturnValue(false);

    const exists = localAssetExistsSync("/media", "job-456", "missing.mp4");

    expect(exists).toBe(false);
  });

  it("checks correct path", () => {
    mockExistsSync.mockReturnValue(true);

    localAssetExistsSync("/opt/storage", "job-abc", "video.webm");

    expect(mockExistsSync).toHaveBeenCalledWith("/opt/storage/job-abc/video.webm");
  });

  it("handles various paths synchronously", () => {
    mockExistsSync.mockReturnValue(false);

    const testCases = [
      "/media/j1/file1.mp4",
      "/storage/j2/file2.mp3",
      "/data/j3/file3.jpg",
    ];

    testCases.forEach((expectedPath) => {
      const [root, jobId, filename] = expectedPath.split("/").filter(Boolean);
      vi.clearAllMocks();

      localAssetExistsSync(`/${root}`, jobId, filename);

      expect(mockExistsSync).toHaveBeenCalledWith(expectedPath);
    });
  });
});
