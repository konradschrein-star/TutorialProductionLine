/**
 * Content-addressed visual library on the local filesystem.
 *
 * Every sourced or generated visual in the BUSINESS_PLAN_HUB catalogue lands
 * here exactly once. Two indexes make "fetched once across the catalogue"
 * (design §6.1) true:
 *
 *   objects/<ab>/<sha256>.<ext>    the bytes
 *   objects/<ab>/<sha256>.json     its `StoredVisual` record (provenance)
 *   by-url/<sha256(sourceUrl)>.json  { contentHash } — pre-fetch dedup
 *
 * The by-url index is what stops the 200th bakery video re-downloading the same
 * SBA form. The by-hash index catches the same bytes arriving under two URLs.
 *
 * First provenance wins: if the same bytes turn up later from a worse-licensed
 * provider we keep the original record rather than downgrading an asset that is
 * already published somewhere.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { StoredVisual, VisualStore } from "./types.js";

const LIBRARY_DIR = "visual-library";

/**
 * Root of the visual library: `<LOCAL_MEDIA_ROOT>/visual-library`.
 *
 * Reads the env var directly (same fallback as `storage-resolver.ts`) rather
 * than importing `@repo/config`, whose module-level validation asserts the
 * media root exists — that is correct for a worker process and wrong for a
 * pure utility that must also load inside a unit test.
 */
export function visualLibraryRoot(): string {
  const mediaRoot =
    process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";
  return join(mediaRoot, LIBRARY_DIR);
}

/** SHA-256 of a buffer, lower-case hex. The dedup identity of an asset. */
export function contentHashOf(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function urlKey(sourceUrl: string): string {
  return createHash("sha256").update(sourceUrl).digest("hex");
}

function objectPaths(
  root: string,
  contentHash: string,
  fileExtension: string,
): { assetKey: string; bytesPath: string; recordPath: string } {
  const shard = contentHash.slice(0, 2);
  const assetKey = `${LIBRARY_DIR}/objects/${shard}/${contentHash}.${fileExtension}`;
  return {
    assetKey,
    bytesPath: join(root, "objects", shard, `${contentHash}.${fileExtension}`),
    recordPath: join(root, "objects", shard, `${contentHash}.json`),
  };
}

async function readJson(path: string): Promise<unknown | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw error;
  }
}

/** Structural guard — a half-written or hand-edited record must not be trusted. */
function isStoredVisual(value: unknown): value is StoredVisual {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const p = v["provenance"];
  if (typeof p !== "object" || p === null) return false;
  const prov = p as Record<string, unknown>;
  return (
    typeof v["contentHash"] === "string" &&
    typeof v["assetKey"] === "string" &&
    typeof v["storagePath"] === "string" &&
    typeof v["bytes"] === "number" &&
    (v["mediaKind"] === "image" || v["mediaKind"] === "video") &&
    (v["posture"] === "publishable" || v["posture"] === "needs-review") &&
    typeof prov["provider"] === "string" &&
    typeof prov["sourceUrl"] === "string" &&
    typeof prov["licence"] === "string" &&
    typeof prov["retrievedAt"] === "string"
  );
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, path);
}

/**
 * Filesystem-backed `VisualStore` rooted at `root`
 * (defaults to `visualLibraryRoot()`).
 *
 * @throws whatever the filesystem throws on a write failure — a store that
 *         cannot persist must fail the job, not silently return in-memory data.
 */
export function createFileSystemVisualStore(
  root: string = visualLibraryRoot(),
): VisualStore {
  const lookupByHash = async (
    contentHash: string,
  ): Promise<StoredVisual | null> => {
    const shard = contentHash.slice(0, 2);
    const recordPath = join(root, "objects", shard, `${contentHash}.json`);
    const record = await readJson(recordPath);
    if (record === null) return null;
    if (!isStoredVisual(record)) {
      throw new Error(
        `visual-gateway: corrupt library record for ${contentHash} — ` +
          `delete ${recordPath} and let the asset be re-fetched.`,
      );
    }
    return record;
  };

  return {
    lookupByHash,

    async lookupBySourceUrl(sourceUrl: string): Promise<StoredVisual | null> {
      const pointer = await readJson(
        join(root, "by-url", `${urlKey(sourceUrl)}.json`),
      );
      if (pointer === null) return null;
      const hash = (pointer as Record<string, unknown>)["contentHash"];
      if (typeof hash !== "string" || hash.length === 0) {
        throw new Error(
          `visual-gateway: corrupt by-url index entry for ${sourceUrl}`,
        );
      }
      return lookupByHash(hash);
    },

    async save(input): Promise<StoredVisual> {
      const { assetKey, bytesPath, recordPath } = objectPaths(
        root,
        input.contentHash,
        input.fileExtension,
      );
      const stored: StoredVisual = {
        contentHash: input.contentHash,
        assetKey,
        storagePath: bytesPath,
        bytes: input.bytes.length,
        mediaKind: input.mediaKind,
        provenance: input.provenance,
        posture: input.posture,
      };

      await mkdir(dirname(bytesPath), { recursive: true });
      await writeFile(bytesPath, input.bytes);
      await writeJsonAtomic(recordPath, stored);
      await writeJsonAtomic(
        join(root, "by-url", `${urlKey(input.provenance.sourceUrl)}.json`),
        {
          contentHash: input.contentHash,
          sourceUrl: input.provenance.sourceUrl,
        },
      );
      return stored;
    },
  };
}
