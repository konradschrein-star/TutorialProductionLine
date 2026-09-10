import { and, eq, sql } from "drizzle-orm";
import { storageArtifacts, type DrizzleClient, type StorageArtifactKind } from "@repo/db";
import { lstat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { loadStorageConfigFromDatabase } from "./runtime-config.js";
import { DriveClient } from "./drive/client.js";
import { validateMediaTarget, withMaterializedArtifact, type MaterializerPorts } from "./materializer.js";
import { fingerprintStorageSource } from "./artifact-store.js";

export interface TutorialMediaRequest { jobId: string; /** null means a local-only input with no archive kind (e.g. narration). */ kind: StorageArtifactKind | null; path: string; expectedContent?: { sha256: string; size: number } }
export type TutorialMediaTransaction = Parameters<Parameters<DrizzleClient["transaction"]>[0]>[0];
export interface TutorialMediaOptions {
  allowedRoots: readonly string[];
  maxBytes: number;
  /** Injectable for offline tests. Default uses a pinned DB transaction lock. */
  withLease?: MaterializerPorts["withLease"];
  streamFileContent?: MaterializerPorts["streamFileContent"];
  /** Reuse an existing approval transaction; never acquire a second pool slot. */
  transaction?: TutorialMediaTransaction;
}

/** Transaction-scoped advisory lock: postgres.js pins one connection for the
 * callback and PostgreSQL releases the lock on commit/rollback/disconnect.
 * Never issue session locks/unlocks through an unreserved pooled connection.
 */
export function createDatabaseMediaLease(db: DrizzleClient): MaterializerPorts["withLease"] {
  return async (path, work) => db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tutorial-media:${path}`}, 0))`);
    return work();
  });
}

/** Caller must authorize the job before calling. Current local unarchived bytes
 * remain valid workflow inputs; missing bytes require an exact verified archive.
 */
export async function withTutorialMedia<T>(db: DrizzleClient, request: TutorialMediaRequest, options: TutorialMediaOptions, consume: (path: string) => Promise<T>): Promise<T> {
  return withTutorialMediaSet(db, [request], options, (paths) => consume(paths[0]!));
}

/** Lock all paths in deterministic order on ONE pinned transaction, and run
 * archive/config queries on that very transaction (no global-pool reentry).
 */
export async function withTutorialMediaSet<T>(db: DrizzleClient, requests: readonly TutorialMediaRequest[], options: TutorialMediaOptions, consume: (paths: string[]) => Promise<T>): Promise<T> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) throw new Error("Positive media size cap required");
  const paths = await Promise.all(requests.map(request => validateMediaTarget(request.path, options.allowedRoots)));
  const sorted = [...new Set(paths)].sort();
  const materializeAll = async (reader: DrizzleClient | TutorialMediaTransaction) => {
    const next = async (index: number): Promise<T> => index === requests.length ? consume(paths)
      : useLockedMedia(reader, requests[index]!, paths[index]!, options, () => next(index + 1));
    return next(0);
  };
  if (options.withLease) {
    const lockNext = async (index: number): Promise<T> => index === sorted.length ? materializeAll(options.transaction ?? db)
      : options.withLease!(sorted[index]!, () => lockNext(index + 1));
    return lockNext(0);
  }
  const inTransaction = async (tx: TutorialMediaTransaction) => {
    for (const path of sorted) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tutorial-media:${path}`}, 0))`);
    return materializeAll(tx);
  };
  return options.transaction ? inTransaction(options.transaction) : db.transaction(inTransaction);
}

async function useLockedMedia<T>(db: DrizzleClient | TutorialMediaTransaction, request: TutorialMediaRequest, path: string, options: TutorialMediaOptions, consume: (path: string) => Promise<T>): Promise<T> {
    await validateMediaTarget(path, options.allowedRoots);
    const info = await lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if (info) {
      if (!info.isFile() || info.size <= 0 || info.size > options.maxBytes) throw new Error("Local media is not a bounded regular file");
      if (request.expectedContent) {
        const actual = await fingerprintStorageSource(path);
        if (actual.sha256 !== request.expectedContent.sha256 || actual.bytes !== request.expectedContent.size) throw new Error("Current media differs from approved bytes");
      }
      return consume(path);
    }
    if (request.kind === null) throw new Error("Required local input is missing and has no archived revision. Restore the original narration/audio before retrying; no replacement was generated.");
    const rows = await db.select().from(storageArtifacts).where(and(
      eq(storageArtifacts.owner_kind, "tutorial_job"), eq(storageArtifacts.job_id, request.jobId),
      eq(storageArtifacts.kind, request.kind), eq(storageArtifacts.vps_path, request.path), eq(storageArtifacts.state, "uploaded"),
    )).limit(2);
    const archived = rows.length === 1 ? rows[0] : null;
    if (!archived?.drive_file_id || !archived.verified_at || !archived.checksum_sha256 || !archived.bytes) throw new Error("Media unavailable: no exact verified Drive revision for the current path");
    if (request.expectedContent && (archived.checksum_sha256 !== request.expectedContent.sha256 || archived.bytes !== request.expectedContent.size)) throw new Error("Archived media differs from approved bytes");
    let stream = options.streamFileContent;
    if (!stream) {
      const config = await loadStorageConfigFromDatabase(db);
      if (!config.enabled) throw new Error("Verified media is archived, but Drive retrieval is not configured");
      const drive = new DriveClient(config.drive);
      stream = drive.streamFileContent.bind(drive);
    }
    return withMaterializedArtifact({ driveFileId: archived.drive_file_id, sha256: archived.checksum_sha256, sizeBytes: archived.bytes, targetPath: path }, {
      allowedRoots: options.allowedRoots, maxBytes: options.maxBytes, streamFileContent: stream,
      // Already held by this enclosing callback, including consumption.
      withLease: async (_path, work) => work(),
    }, consume);
}

/** Await this to construct an HTTP response. The background lease is released
 * only when its readable closes, errors, or is cancelled, not on return here.
 */
export function parseMediaByteRange(value: string | undefined | null, size: number): { start: number; end: number } | null | "invalid" {
  if (value === undefined || value === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(size) || size <= 0) return "invalid";
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return "invalid";
  if (first === null) return last && last > 0 ? { start: Math.max(0, size - last), end: size - 1 } : "invalid";
  if (first >= size || (last !== null && last < first)) return "invalid";
  return { start: first, end: Math.min(last ?? size - 1, size - 1) };
}

export function openLeasedMediaStream(withMedia: (consume: (path: string) => Promise<void>) => Promise<void>, options: { range?: string | null; ifNoneMatch?: string | null } = {}): Promise<{ stream: ReadableStream<Uint8Array>; size: number; contentLength: number; status: 200 | 206 | 304 | 416; contentRange?: string; etag: string; lastModified: string }> {
  return new Promise((resolve, reject) => {
    void withMedia(async (path) => {
      const info = await lstat(path);
      const validators = { etag: `"${info.size}-${Math.floor(info.mtimeMs)}"`, lastModified: info.mtime.toUTCString() };
      if (options.ifNoneMatch?.split(",").some(value => value.trim() === "*" || value.trim().replace(/^W\//, "") === validators.etag)) {
        resolve({ stream: new ReadableStream({ start: controller => controller.close() }), size: info.size, contentLength: 0, status: 304, ...validators });
        return;
      }
      const range = parseMediaByteRange(options.range, info.size);
      if (range === "invalid") {
        resolve({ stream: new ReadableStream({ start: controller => controller.close() }), size: info.size, contentLength: 0, status: 416, contentRange: `bytes */${info.size}`, ...validators });
        return;
      }
      const reader = (Readable.toWeb(createReadStream(path, range ?? undefined)) as ReadableStream<Uint8Array>).getReader();
      let finish!: () => void;
      const consumed = new Promise<void>((done) => { finish = done; });
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) { controller.close(); finish(); }
            else controller.enqueue(next.value);
          } catch (error) { controller.error(error); finish(); }
        },
        async cancel(reason) { try { await reader.cancel(reason); } finally { finish(); } },
      }, { highWaterMark: 0 });
      resolve({ stream, size: info.size, contentLength: range ? range.end - range.start + 1 : info.size, status: range ? 206 : 200, ...(range ? { contentRange: `bytes ${range.start}-${range.end}/${info.size}` } : {}), ...validators });
      await consumed;
      reader.releaseLock();
    }).catch(reject);
  });
}
