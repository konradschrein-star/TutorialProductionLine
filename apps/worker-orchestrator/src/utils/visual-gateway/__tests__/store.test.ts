import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  contentHashOf,
  createFileSystemVisualStore,
  visualLibraryRoot,
} from "../store.js";
import { makeProvenance, pngBytes } from "./fixtures.js";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "visual-store-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("visualLibraryRoot", () => {
  it("hangs the library off LOCAL_MEDIA_ROOT", () => {
    const previous = process.env["LOCAL_MEDIA_ROOT"];
    process.env["LOCAL_MEDIA_ROOT"] = join(tmpdir(), "media-root");
    try {
      expect(visualLibraryRoot()).toBe(
        join(tmpdir(), "media-root", "visual-library"),
      );
    } finally {
      if (previous === undefined) delete process.env["LOCAL_MEDIA_ROOT"];
      else process.env["LOCAL_MEDIA_ROOT"] = previous;
    }
  });
});

describe("createFileSystemVisualStore", () => {
  it("returns null for an asset it has never seen", async () => {
    const store = createFileSystemVisualStore(root);
    expect(await store.lookupByHash("a".repeat(64))).toBeNull();
    expect(
      await store.lookupBySourceUrl("https://example.com/x.png"),
    ).toBeNull();
  });

  it("round-trips bytes, provenance and posture", async () => {
    const store = createFileSystemVisualStore(root);
    const bytes = pngBytes(1920, 1080);
    const contentHash = contentHashOf(bytes);
    const provenance = makeProvenance();

    const stored = await store.save({
      bytes,
      contentHash,
      fileExtension: "png",
      mediaKind: "image",
      provenance,
      posture: "publishable",
    });

    expect(stored.contentHash).toBe(contentHash);
    expect(stored.assetKey).toContain(contentHash);
    expect(await readFile(stored.storagePath)).toEqual(bytes);

    const byHash = await store.lookupByHash(contentHash);
    expect(byHash?.provenance.licence).toBe("Pexels License");

    const byUrl = await store.lookupBySourceUrl(provenance.sourceUrl);
    expect(byUrl?.contentHash).toBe(contentHash);
  });

  it("shards objects by the first two hex characters of the hash", async () => {
    const store = createFileSystemVisualStore(root);
    const bytes = pngBytes(1200, 800);
    const contentHash = contentHashOf(bytes);
    const stored = await store.save({
      bytes,
      contentHash,
      fileExtension: "png",
      mediaKind: "image",
      provenance: makeProvenance(),
      posture: "publishable",
    });
    expect(stored.storagePath).toContain(
      join("objects", contentHash.slice(0, 2)),
    );
  });

  it("throws on a corrupt library record rather than returning junk", async () => {
    const store = createFileSystemVisualStore(root);
    const hash = "b".repeat(64);
    await mkdir(join(root, "objects", "bb"), { recursive: true });
    await writeFile(
      join(root, "objects", "bb", `${hash}.json`),
      JSON.stringify({ contentHash: hash }),
      "utf8",
    );
    await expect(store.lookupByHash(hash)).rejects.toThrow(
      /corrupt library record/,
    );
  });
});
