/**
 * Content-addressed segment cache for Remotion motion-graphic islands.
 *
 * The BUSINESS_PLAN_HUB format is built from a keyword matrix: the same
 * explainer beat ("why lenders want a 1.25 DSCR") appears in dozens of videos.
 * Because a motion-graphic island is a pure function of its spec, it should be
 * rendered ONCE for the whole library and reused byte-for-byte everywhere else.
 * Rendering 27,000 frames per video through Chromium is what makes the volume
 * target impossible; this cache is the mechanism that avoids it.
 *
 * Layout on disk:
 *
 *   <mediaRoot>/segment-cache/<first2>/<sha256>.mp4        the segment
 *   <mediaRoot>/segment-cache/<first2>/<sha256>.mp4.json   its audit sidecar
 *   <mediaRoot>/segment-cache/_work/                       scratch for producers
 *
 * Sharding by the first two hex characters keeps any single directory to
 * roughly 1/256th of the catalogue, so a 100k-entry cache never puts 100k
 * files in one directory.
 *
 * Fail-closed behaviour (per the format's standing rules):
 * - A missing entry is a MISS and is re-produced. It is never substituted with
 *   a placeholder.
 * - An INCONSISTENT entry (media present, sidecar missing or unreadable) throws
 *   rather than being silently re-rendered, because that state means something
 *   is writing into the store incorrectly and hiding it would let it spread.
 * - Nothing is ever deleted implicitly. {@link selectEvictions} is pure and only
 *   RETURNS what would go; {@link SegmentCache.remove} is the sole destructive
 *   operation and must be called explicitly.
 */

import { createHash, randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { getConfig } from "@repo/config";

import { retryFileOperation } from "../utils/retry-file-operation.js";
import {
  canonicalStringify,
  isJsonValue,
  type JsonValue,
} from "./canonical-json.js";

/** Directory name appended to the media root. */
const CACHE_DIR_NAME = "segment-cache";

/** Scratch directory for {@link SegmentCache.withCache} producers. Never scanned as a shard. */
const WORK_DIR_NAME = "_work";

const KEY_PATTERN = /^[0-9a-f]{64}$/;
const SHARD_PATTERN = /^[0-9a-f]{2}$/;
const EXTENSION_PATTERN = /^[a-z0-9]{1,8}$/;

/** Base class for every error this module raises. */
export class SegmentCacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SegmentCacheError";
  }
}

/**
 * The store is in a state that should be impossible: a segment exists without
 * a readable sidecar, or a sidecar disagrees with its own key.
 */
export class SegmentCacheIntegrityError extends SegmentCacheError {
  constructor(message: string) {
    super(message);
    this.name = "SegmentCacheIntegrityError";
  }
}

/**
 * The canonical hash input for a BUSINESS_PLAN_HUB motion-graphic island.
 *
 * Declared as a type alias (not an interface) so it is assignable to
 * {@link JsonValue}. `computeCacheKey` accepts any JSON value; this type simply
 * documents the shape the format actually hashes.
 */
export type SegmentCacheSpec = {
  /** Remotion element/component name, e.g. `"FormulaReveal"`. */
  element: string;
  /** Layout the island is composed into, e.g. `"framed-chart"`. */
  layout: string;
  /** Aspect ratio token, e.g. `"16:9"`. */
  aspect: string;
  /** Colour grade slug, or null when ungraded. */
  grade: string | null;
  /** Element props. Must come from finance-kit or sourced facts, never authored. */
  data: JsonValue;
};

/** What a {@link SegmentCache.store} caller must record alongside the file. */
export interface SegmentStoreMeta {
  /** The exact spec `key` was computed from. Verified, not trusted. */
  spec: JsonValue;
  /** Frame count of the produced segment. Must be a positive integer. */
  sourceDurationFrames: number;
}

/** The audit record written next to every cached segment. */
export interface SegmentSidecar {
  key: string;
  spec: JsonValue;
  /** ISO-8601 timestamp of first successful commit. */
  createdAt: string;
  /** ISO-8601 timestamp of the most recent cache hit. Drives LRU eviction. */
  lastAccessedAt: string;
  sourceDurationFrames: number;
  /** Size recorded at write time. Reads report the live size instead — see {@link SegmentCacheEntry.bytes}. */
  bytes: number;
}

/** A resolved cache entry. */
export interface SegmentCacheEntry {
  key: string;
  /** Absolute path to the cached media file. */
  filePath: string;
  /** Absolute path to the sidecar. */
  sidecarPath: string;
  spec: JsonValue;
  createdAt: string;
  lastAccessedAt: string;
  sourceDurationFrames: number;
  /**
   * Live size of the media file in bytes, read with `stat` at lookup time —
   * NOT the sidecar's recorded value. Under a concurrent-write race the two can
   * disagree by a few bytes; the filesystem is the authority.
   */
  bytes: number;
}

/** Files in the store that do not form a complete entry. */
export interface SegmentCacheOrphans {
  /** Media files with no sidecar. {@link SegmentCache.lookup} throws on these. */
  mediaWithoutSidecar: string[];
  /** Sidecars with no media. Treated as a MISS; harmlessly overwritten on the next store. */
  sidecarWithoutMedia: string[];
  /** Sidecars that exist but do not parse or fail validation. */
  unreadableSidecar: string[];
}

/** Full scan of the store. */
export interface SegmentCacheListing {
  entries: SegmentCacheEntry[];
  orphans: SegmentCacheOrphans;
}

/** Summary of the store's footprint. */
export interface SegmentCacheStats {
  /** Number of complete entries (media + valid sidecar). */
  entryCount: number;
  /** Sum of the live sizes of every complete entry's media file. */
  totalBytes: number;
  /** Number of populated shard directories. */
  shardCount: number;
  orphans: SegmentCacheOrphans;
}

/** Handed to a {@link SegmentCache.withCache} producer. */
export interface SegmentProduceContext {
  key: string;
  /** A private, empty scratch directory. Deleted after `produce` returns. */
  workDir: string;
  /** A path inside `workDir` the producer may write to. Using it is optional. */
  suggestedOutputPath: string;
}

/** What a producer must hand back. Both fields are required — nothing is inferred. */
export interface ProducedSegment {
  /** Absolute path to the finished, fully-written segment file. */
  filePath: string;
  /** Frame count of that file. */
  sourceDurationFrames: number;
}

/** Result of {@link SegmentCache.withCache}. */
export interface SegmentCacheResult {
  entry: SegmentCacheEntry;
  /** True when the segment came from the cache and `produce` was never called. */
  hit: boolean;
}

/** Construction options for {@link createSegmentCache}. */
export interface SegmentCacheOptions {
  /**
   * Root the `segment-cache/` directory is created under. Defaults to
   * `getConfig().LOCAL_MEDIA_ROOT`. Pass an explicit path in tests so config
   * validation is not required.
   */
  mediaRoot?: string;
  /**
   * Container extension without the dot. Defaults to `"mp4"`. Alpha islands
   * use `"webm"`. Segments of different extensions coexist in the same store
   * because the extension is part of the filename, not the key.
   */
  mediaExtension?: string;
}

/**
 * Compute the content-addressed cache key for a segment spec.
 *
 * Uses {@link canonicalStringify}, so object key insertion order cannot change
 * the result. A naive `JSON.stringify` here would silently miss cache hits.
 *
 * @param spec - Any JSON value. For this format, a {@link SegmentCacheSpec}.
 * @returns A lowercase 64-character sha256 hex digest.
 * @throws {CanonicalJsonError} If the spec is not losslessly JSON-serialisable
 *   (non-finite number, `undefined` in an array, `Date`, class instance, cycle).
 */
export function computeCacheKey(spec: JsonValue): string {
  return createHash("sha256")
    .update(canonicalStringify(spec), "utf8")
    .digest("hex");
}

/**
 * Decide which entries would be evicted to bring the store under a byte budget.
 *
 * PURE. Deletes nothing, touches no filesystem. The caller inspects the plan
 * and, if it agrees, calls {@link SegmentCache.remove} per key. Eviction order
 * is least-recently-used first, with `createdAt` then `key` as deterministic
 * tie-breakers so the same input always yields the same plan.
 *
 * @param entries - Entries to consider, typically from {@link SegmentCache.listEntries}.
 * @param maxBytes - Byte budget for the store. `0` selects everything.
 * @returns The eviction plan. `evict` is empty when already within budget.
 * @throws {SegmentCacheError} If `maxBytes` is negative or not finite.
 */
export function selectEvictions(
  entries: ReadonlyArray<SegmentCacheEntry>,
  maxBytes: number,
): EvictionPlan {
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    throw new SegmentCacheError(
      `selectEvictions: maxBytes must be a finite number >= 0, received ${String(maxBytes)}`,
    );
  }

  const totalBytes = entries.reduce((sum, e) => sum + e.bytes, 0);

  if (totalBytes <= maxBytes) {
    return {
      maxBytes,
      totalBytes,
      overBytes: 0,
      evict: [],
      keep: [...entries],
      reclaimedBytes: 0,
      remainingBytes: totalBytes,
    };
  }

  const ordered = [...entries].sort(compareLeastRecentlyUsed);

  const evict: SegmentCacheEntry[] = [];
  let remainingBytes = totalBytes;
  for (const entry of ordered) {
    if (remainingBytes <= maxBytes) break;
    evict.push(entry);
    remainingBytes -= entry.bytes;
  }

  const evicted = new Set(evict.map((e) => e.key));
  return {
    maxBytes,
    totalBytes,
    overBytes: totalBytes - maxBytes,
    evict,
    keep: entries.filter((e) => !evicted.has(e.key)),
    reclaimedBytes: totalBytes - remainingBytes,
    remainingBytes,
  };
}

/** Output of {@link selectEvictions}. Advisory only — nothing has been deleted. */
export interface EvictionPlan {
  maxBytes: number;
  totalBytes: number;
  /** How far over budget the store is. `0` when within budget. */
  overBytes: number;
  /** Entries to evict, least-recently-used first. */
  evict: SegmentCacheEntry[];
  /** Entries that survive the plan, in input order. */
  keep: SegmentCacheEntry[];
  reclaimedBytes: number;
  /** Store size after the plan is applied. */
  remainingBytes: number;
}

function compareLeastRecentlyUsed(
  a: SegmentCacheEntry,
  b: SegmentCacheEntry,
): number {
  const accessDelta = toEpoch(a.lastAccessedAt) - toEpoch(b.lastAccessedAt);
  if (accessDelta !== 0) return accessDelta;
  const createdDelta = toEpoch(a.createdAt) - toEpoch(b.createdAt);
  if (createdDelta !== 0) return createdDelta;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function toEpoch(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new SegmentCacheError(
      `Cache entry carries an unparseable timestamp: ${JSON.stringify(iso)}. ` +
        `Eviction ordering cannot be computed from it.`,
    );
  }
  return ms;
}

/**
 * A handle on one content-addressed segment store.
 *
 * Create with {@link createSegmentCache}. Instances are cheap and hold no state
 * beyond their paths, so the filesystem remains the single source of truth and
 * multiple workers may operate on the same store concurrently.
 */
export class SegmentCache {
  /** Absolute path to the `segment-cache/` directory. */
  public readonly cacheDir: string;
  /** Container extension, without the dot. */
  public readonly mediaExtension: string;

  private readonly workDir: string;
  private readonly mediaPattern: RegExp;
  private readonly sidecarPattern: RegExp;

  constructor(cacheDir: string, mediaExtension: string) {
    this.cacheDir = cacheDir;
    this.mediaExtension = mediaExtension;
    this.workDir = join(cacheDir, WORK_DIR_NAME);
    this.mediaPattern = new RegExp(`^([0-9a-f]{64})\\.${mediaExtension}$`);
    this.sidecarPattern = new RegExp(
      `^([0-9a-f]{64})\\.${mediaExtension}\\.json$`,
    );
  }

  /**
   * Absolute path a segment with this key would occupy.
   *
   * @param key - A 64-character sha256 hex digest.
   * @throws {SegmentCacheError} If the key is not a sha256 hex digest.
   */
  public pathForKey(key: string): string {
    assertKey(key);
    return join(
      this.cacheDir,
      key.slice(0, 2),
      `${key}.${this.mediaExtension}`,
    );
  }

  /**
   * Look a segment up.
   *
   * On a hit the sidecar's `lastAccessedAt` is refreshed so LRU eviction has a
   * real signal. A failure to refresh is logged and does NOT fail the lookup —
   * a usable segment must never be discarded over a bookkeeping write.
   *
   * @param key - A 64-character sha256 hex digest.
   * @returns The entry, or `null` on a clean miss (nothing on disk, or a
   *   sidecar whose media file is gone).
   * @throws {SegmentCacheError} If the key is malformed.
   * @throws {SegmentCacheIntegrityError} If the media file exists but its
   *   sidecar is missing, unparseable, or names a different key.
   */
  public async lookup(key: string): Promise<SegmentCacheEntry | null> {
    assertKey(key);
    const filePath = this.pathForKey(key);
    const sidecarPath = `${filePath}.json`;

    const fileStat = await statOrNull(filePath);
    if (fileStat === null) return null;

    const raw = await readFileOrNull(sidecarPath);
    if (raw === null) {
      throw new SegmentCacheIntegrityError(
        `Segment ${key} exists at ${filePath} but its sidecar ${sidecarPath} is missing. ` +
          `The store was written to by something that does not honour the commit order ` +
          `(sidecar first, media last). Delete the orphan media file or restore its sidecar.`,
      );
    }

    const sidecar = parseSidecar(raw);
    if (sidecar === null) {
      throw new SegmentCacheIntegrityError(
        `Sidecar ${sidecarPath} is not a valid segment-cache record. ` +
          `Delete both it and ${filePath} to force a re-render.`,
      );
    }
    if (sidecar.key !== key) {
      throw new SegmentCacheIntegrityError(
        `Sidecar ${sidecarPath} declares key ${sidecar.key} but is filed under ${key}. ` +
          `The store has been hand-edited; delete both files to force a re-render.`,
      );
    }

    const lastAccessedAt = new Date().toISOString();
    try {
      await writeJsonAtomic(sidecarPath, { ...sidecar, lastAccessedAt });
    } catch (err) {
      console.warn(
        `[segment-cache] could not refresh lastAccessedAt on ${sidecarPath}: ${errText(err)} ` +
          `(cache hit still served; LRU ordering for this entry is stale)`,
      );
    }

    return {
      key,
      filePath,
      sidecarPath,
      spec: sidecar.spec,
      createdAt: sidecar.createdAt,
      lastAccessedAt,
      sourceDurationFrames: sidecar.sourceDurationFrames,
      bytes: fileStat.size,
    };
  }

  /**
   * Commit a produced segment into the store.
   *
   * Atomicity: the media file and the sidecar are each written to a
   * process-unique `.tmp` path and then `rename`d into place. A reader
   * therefore only ever sees a complete file. The SIDECAR is renamed first and
   * the MEDIA last, making the media file the commit point — a crash mid-store
   * can leave an orphan sidecar (harmless, treated as a miss and overwritten)
   * but never a segment without its audit record.
   *
   * Concurrency: if another worker commits the same key first, this call
   * discards its own copy and returns the winner's entry. Nothing is
   * overwritten and no reader's open file is replaced.
   *
   * @param key - A 64-character sha256 hex digest, matching `meta.spec`.
   * @param filePath - Absolute path to the finished segment to ingest. Copied, not moved.
   * @param meta - The spec the key came from, and the segment's frame count.
   * @returns The committed entry (or the winner's, if this call lost a race).
   * @throws {SegmentCacheError} If the key is malformed, if
   *   `computeCacheKey(meta.spec) !== key`, if `sourceDurationFrames` is not a
   *   positive integer, or if `filePath` is missing or zero bytes.
   */
  public async store(
    key: string,
    filePath: string,
    meta: SegmentStoreMeta,
  ): Promise<SegmentCacheEntry> {
    assertKey(key);

    if (
      !Number.isInteger(meta.sourceDurationFrames) ||
      meta.sourceDurationFrames <= 0
    ) {
      throw new SegmentCacheError(
        `store(${key}): sourceDurationFrames must be a positive integer, received ` +
          `${String(meta.sourceDurationFrames)}. The frame count must come from the ` +
          `producer — it is never inferred.`,
      );
    }

    if (!isJsonValue(meta.spec)) {
      throw new SegmentCacheError(
        `store(${key}): spec is not losslessly JSON-serialisable, so the entry would ` +
          `not be auditable. Convert it to plain JSON data before storing.`,
      );
    }

    const derived = computeCacheKey(meta.spec);
    if (derived !== key) {
      throw new SegmentCacheError(
        `store(${key}): the supplied spec hashes to ${derived}. Storing it under ${key} ` +
          `would poison the cache — every later lookup of ${key} would serve a segment ` +
          `rendered from a different spec.`,
      );
    }

    const sourceStat = await statOrNull(filePath);
    if (sourceStat === null) {
      throw new SegmentCacheError(
        `store(${key}): source file does not exist: ${filePath}`,
      );
    }
    if (!sourceStat.isFile()) {
      throw new SegmentCacheError(
        `store(${key}): source path is not a file: ${filePath}`,
      );
    }
    if (sourceStat.size === 0) {
      throw new SegmentCacheError(
        `store(${key}): source file is zero bytes: ${filePath}. A zero-byte segment is a ` +
          `failed render, not a cacheable result.`,
      );
    }

    const targetPath = this.pathForKey(key);
    const sidecarPath = `${targetPath}.json`;
    await mkdir(join(this.cacheDir, key.slice(0, 2)), { recursive: true });

    // Fast path: another worker already committed this key.
    const existing = await this.lookup(key);
    if (existing !== null) return existing;

    const suffix = uniqueSuffix();
    const tmpMedia = `${targetPath}.${suffix}.tmp`;

    try {
      await retryFileOperation(() => copyFile(filePath, tmpMedia), {
        operationName: `stage segment ${key}`,
      });

      const stagedStat = await stat(tmpMedia);
      const now = new Date().toISOString();
      const sidecar: SegmentSidecar = {
        key,
        spec: meta.spec,
        createdAt: now,
        lastAccessedAt: now,
        sourceDurationFrames: meta.sourceDurationFrames,
        bytes: stagedStat.size,
      };

      // Sidecar first: the media file is the commit point.
      await writeJsonAtomic(sidecarPath, sidecar);

      // Re-check immediately before committing to narrow the race window.
      if ((await statOrNull(targetPath)) !== null) {
        await discard(tmpMedia);
        return await this.requireEntry(key);
      }

      try {
        await retryFileOperation(() => rename(tmpMedia, targetPath), {
          operationName: `commit segment ${key}`,
        });
      } catch (err) {
        // Lost the race at the last instant: the winner's file is in place.
        if ((await statOrNull(targetPath)) !== null) {
          await discard(tmpMedia);
          return await this.requireEntry(key);
        }
        throw err;
      }

      return {
        key,
        filePath: targetPath,
        sidecarPath,
        spec: meta.spec,
        createdAt: sidecar.createdAt,
        lastAccessedAt: sidecar.lastAccessedAt,
        sourceDurationFrames: sidecar.sourceDurationFrames,
        bytes: stagedStat.size,
      };
    } catch (err) {
      await discard(tmpMedia);
      throw err;
    }
  }

  /**
   * Serve a segment from the cache, producing it only on a miss.
   *
   * `produce` is given a private, empty scratch directory that is removed once
   * it returns. A miss ALWAYS produces — it never substitutes a placeholder.
   *
   * @param key - A 64-character sha256 hex digest, matching `spec`.
   * @param spec - The spec `key` was computed from; recorded in the sidecar.
   * @param produce - Renders the segment and returns its path and frame count.
   * @returns The entry plus whether it was a cache hit.
   * @throws {SegmentCacheError} On any {@link SegmentCache.store} validation
   *   failure, or if `produce` returns a path that does not exist.
   * @throws {SegmentCacheIntegrityError} If the store is inconsistent for this key.
   */
  public async withCache(
    key: string,
    spec: JsonValue,
    produce: (ctx: SegmentProduceContext) => Promise<ProducedSegment>,
  ): Promise<SegmentCacheResult> {
    assertKey(key);

    const hit = await this.lookup(key);
    if (hit !== null) return { entry: hit, hit: true };

    const workDir = join(this.workDir, `${key}-${uniqueSuffix()}`);
    await mkdir(workDir, { recursive: true });

    try {
      const produced = await produce({
        key,
        workDir,
        suggestedOutputPath: join(workDir, `${key}.${this.mediaExtension}`),
      });

      const entry = await this.store(key, produced.filePath, {
        spec,
        sourceDurationFrames: produced.sourceDurationFrames,
      });
      return { entry, hit: false };
    } finally {
      try {
        await rm(workDir, { recursive: true, force: true });
      } catch (err) {
        console.warn(
          `[segment-cache] could not clean work dir ${workDir}: ${errText(err)}`,
        );
      }
    }
  }

  /**
   * Scan the whole store.
   *
   * Unlike {@link SegmentCache.lookup}, this does not throw on inconsistent
   * files — it reports them under `orphans`, because an audit tool that dies on
   * the first bad file cannot be used to find bad files. It does not refresh
   * any access timestamp.
   *
   * @returns Every complete entry plus a census of incomplete ones.
   */
  public async listEntries(): Promise<SegmentCacheListing> {
    const orphans: SegmentCacheOrphans = {
      mediaWithoutSidecar: [],
      sidecarWithoutMedia: [],
      unreadableSidecar: [],
    };
    const entries: SegmentCacheEntry[] = [];

    for (const shard of await this.listShards()) {
      const shardDir = join(this.cacheDir, shard);
      const names = await readdirOrEmpty(shardDir);
      const mediaKeys = new Set<string>();
      const sidecarKeys = new Set<string>();

      for (const name of names) {
        const media = this.mediaPattern.exec(name);
        if (media !== null && media[1] !== undefined) {
          mediaKeys.add(media[1]);
          continue;
        }
        const sidecar = this.sidecarPattern.exec(name);
        if (sidecar !== null && sidecar[1] !== undefined) {
          sidecarKeys.add(sidecar[1]);
        }
        // Anything else (.tmp staging files, other extensions) is not ours.
      }

      for (const key of sidecarKeys) {
        if (!mediaKeys.has(key)) {
          orphans.sidecarWithoutMedia.push(
            join(shardDir, `${key}.${this.mediaExtension}.json`),
          );
        }
      }

      for (const key of mediaKeys) {
        const filePath = join(shardDir, `${key}.${this.mediaExtension}`);
        const sidecarPath = `${filePath}.json`;

        if (!sidecarKeys.has(key)) {
          orphans.mediaWithoutSidecar.push(filePath);
          continue;
        }

        const raw = await readFileOrNull(sidecarPath);
        const sidecar = raw === null ? null : parseSidecar(raw);
        if (sidecar === null || sidecar.key !== key) {
          orphans.unreadableSidecar.push(sidecarPath);
          continue;
        }

        const fileStat = await statOrNull(filePath);
        if (fileStat === null) {
          // Removed between the readdir and the stat.
          orphans.sidecarWithoutMedia.push(sidecarPath);
          continue;
        }

        entries.push({
          key,
          filePath,
          sidecarPath,
          spec: sidecar.spec,
          createdAt: sidecar.createdAt,
          lastAccessedAt: sidecar.lastAccessedAt,
          sourceDurationFrames: sidecar.sourceDurationFrames,
          bytes: fileStat.size,
        });
      }
    }

    return { entries, orphans };
  }

  /**
   * Summarise the store's footprint.
   *
   * @returns Entry count, total bytes on disk, shard count, and orphan census.
   */
  public async stats(): Promise<SegmentCacheStats> {
    const { entries, orphans } = await this.listEntries();
    const shards = new Set(entries.map((e) => e.key.slice(0, 2)));
    return {
      entryCount: entries.length,
      totalBytes: entries.reduce((sum, e) => sum + e.bytes, 0),
      shardCount: shards.size,
      orphans,
    };
  }

  /**
   * Delete one entry — media file and sidecar.
   *
   * This is the ONLY destructive operation in the module and it is never called
   * implicitly. {@link selectEvictions} decides nothing on its own; a caller
   * must act on its plan by calling this per key.
   *
   * @param key - A 64-character sha256 hex digest.
   * @returns True if anything was removed, false if the key was not present.
   * @throws {SegmentCacheError} If the key is malformed.
   */
  public async remove(key: string): Promise<boolean> {
    assertKey(key);
    const filePath = this.pathForKey(key);
    const sidecarPath = `${filePath}.json`;

    const hadMedia = (await statOrNull(filePath)) !== null;
    const hadSidecar = (await statOrNull(sidecarPath)) !== null;

    // Media first: it is the commit point, so removing it first never leaves a
    // segment without its sidecar.
    await retryFileOperation(() => rm(filePath, { force: true }), {
      operationName: `remove segment ${key}`,
    });
    await retryFileOperation(() => rm(sidecarPath, { force: true }), {
      operationName: `remove sidecar ${key}`,
    });

    return hadMedia || hadSidecar;
  }

  /** Read an entry that must exist (used after losing a commit race). */
  private async requireEntry(key: string): Promise<SegmentCacheEntry> {
    const entry = await this.lookup(key);
    if (entry === null) {
      throw new SegmentCacheIntegrityError(
        `Segment ${key} was present a moment ago but vanished before it could be read. ` +
          `Something outside the cache is deleting entries mid-write.`,
      );
    }
    return entry;
  }

  private async listShards(): Promise<string[]> {
    const names = await readdirOrEmpty(this.cacheDir);
    return names.filter((name) => SHARD_PATTERN.test(name));
  }
}

/**
 * Create a handle on a segment store.
 *
 * @param options - Optional media root and container extension.
 * @returns A {@link SegmentCache}. The directory is created lazily on first write.
 * @throws {SegmentCacheError} If `mediaExtension` is not 1-8 lowercase
 *   alphanumerics, or if `mediaRoot` is omitted and config cannot be loaded.
 */
export function createSegmentCache(
  options: SegmentCacheOptions = {},
): SegmentCache {
  const mediaExtension = options.mediaExtension ?? "mp4";
  if (!EXTENSION_PATTERN.test(mediaExtension)) {
    throw new SegmentCacheError(
      `createSegmentCache: mediaExtension must be 1-8 lowercase alphanumeric characters ` +
        `with no dot, received ${JSON.stringify(mediaExtension)}`,
    );
  }

  const mediaRoot = options.mediaRoot ?? getConfig().LOCAL_MEDIA_ROOT;
  if (typeof mediaRoot !== "string" || mediaRoot.length === 0) {
    throw new SegmentCacheError(
      `createSegmentCache: could not resolve a media root. Pass options.mediaRoot or ` +
        `set LOCAL_MEDIA_ROOT.`,
    );
  }

  return new SegmentCache(join(mediaRoot, CACHE_DIR_NAME), mediaExtension);
}

let defaultCache: SegmentCache | null = null;

/**
 * The process-wide default segment cache, rooted at `LOCAL_MEDIA_ROOT` with
 * `.mp4` segments.
 *
 * Resolved lazily so importing this module never triggers config validation.
 *
 * @returns The shared {@link SegmentCache} instance.
 * @throws {SegmentCacheError} If `LOCAL_MEDIA_ROOT` cannot be resolved.
 */
export function getSegmentCache(): SegmentCache {
  defaultCache ??= createSegmentCache();
  return defaultCache;
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function assertKey(key: string): void {
  if (!KEY_PATTERN.test(key)) {
    throw new SegmentCacheError(
      `Invalid segment cache key ${JSON.stringify(key)}: expected a 64-character ` +
        `lowercase sha256 hex digest from computeCacheKey().`,
    );
  }
}

function uniqueSuffix(): string {
  return `${process.pid}-${randomBytes(6).toString("hex")}`;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isNodeErrorWithCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === code
  );
}

async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (err) {
    if (isNodeErrorWithCode(err, "ENOENT")) return null;
    throw err;
  }
}

async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (isNodeErrorWithCode(err, "ENOENT")) return null;
    throw err;
  }
}

async function readdirOrEmpty(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (err) {
    if (isNodeErrorWithCode(err, "ENOENT")) return [];
    throw err;
  }
}

async function discard(path: string): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch (err) {
    console.warn(
      `[segment-cache] could not remove staging file ${path}: ${errText(err)}`,
    );
  }
}

/** Write JSON to `targetPath` atomically: unique tmp file, then rename. */
async function writeJsonAtomic(
  targetPath: string,
  value: SegmentSidecar,
): Promise<void> {
  const tmp = `${targetPath}.${uniqueSuffix()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await retryFileOperation(() => rename(tmp, targetPath), {
      operationName: `commit sidecar ${targetPath}`,
    });
  } catch (err) {
    await discard(tmp);
    throw err;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isIntAtLeast(value: unknown, min: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min;
}

/**
 * Parse and validate a sidecar's JSON text.
 *
 * @returns The record, or `null` if the text is not valid JSON or any field
 *   fails validation. Callers decide whether that is fatal.
 */
function parseSidecar(raw: string): SegmentSidecar | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;

  const key: unknown = parsed.key;
  const spec: unknown = parsed.spec;
  const createdAt: unknown = parsed.createdAt;
  const lastAccessedAt: unknown = parsed.lastAccessedAt;
  const sourceDurationFrames: unknown = parsed.sourceDurationFrames;
  const bytes: unknown = parsed.bytes;

  if (typeof key !== "string" || !KEY_PATTERN.test(key)) return null;
  if (!("spec" in parsed) || !isJsonValue(spec)) return null;
  if (!isIsoTimestamp(createdAt)) return null;
  if (!isIsoTimestamp(lastAccessedAt)) return null;
  if (!isIntAtLeast(sourceDurationFrames, 1)) return null;
  if (!isIntAtLeast(bytes, 0)) return null;

  return {
    key,
    spec,
    createdAt,
    lastAccessedAt,
    sourceDurationFrames,
    bytes,
  };
}
