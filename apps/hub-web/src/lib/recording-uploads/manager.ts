"use client";

/**
 * Background recording-upload manager.
 *
 * WHY A MODULE SINGLETON AND NOT A SERVICE WORKER
 * -----------------------------------------------
 * The requirement is that a VA can hit "done", walk away from the upload, and
 * immediately start the next job. In Tutorial Studio "the next job" means
 * switching the tab bar in page-client.tsx, which UNMOUNTS <ProductionStudio>,
 * or router.push()-ing to /tutorial-studio/video-stitcher. Anything held in
 * component state dies at that moment. A module-level singleton does not: the
 * JS module graph outlives every client-side navigation in the app.
 *
 * A Service Worker was the other candidate and was rejected for a concrete,
 * non-aesthetic reason: hub-web is served in production over plain HTTP
 * (http://65.108.6.149:3000). `navigator.serviceWorker` does not exist outside
 * a secure context, so a SW-based uploader would work on localhost and be
 * silently absent in production — the worst possible failure mode. On top of
 * that a SW can be terminated between chunks, so it would need exactly the same
 * IndexedDB rehydration this module already does; it buys only "keeps uploading
 * after the tab is closed", which we deliberately trade away for resumability.
 *
 * Everything survives a full page reload via IndexedDB (see ./store.ts): the
 * File handle, the server uploadId and the byte offset are persisted after
 * every chunk, so a reload resumes mid-file instead of restarting.
 */

import {
  deleteUpload,
  listUploads,
  putUpload,
  type PersistedUpload,
} from "./store";

export type UploadState = PersistedUpload["state"];

export interface UploadEntry {
  jobId: string;
  jobTitle: string;
  fileName: string;
  fileSize: number;
  uploadedBytes: number;
  state: UploadState;
  error: string | null;
  /** Bytes/second, exponentially smoothed. 0 until we have a sample. */
  bytesPerSecond: number;
  /** Seconds remaining, or null when unknown. */
  etaSeconds: number | null;
  /** True when the persisted File handle is gone and the VA must re-drop it. */
  needsFile: boolean;
}

/** Chunk size fallback; the server returns the authoritative value on begin. */
const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;
/** Per-chunk network retries before the upload is parked in `error`. */
const MAX_CHUNK_ATTEMPTS = 6;

interface Runtime extends PersistedUpload {
  chunkSize: number;
  bytesPerSecond: number;
  cancelled: boolean;
  xhr: XMLHttpRequest | null;
}

const entries = new Map<string, Runtime>();
const listeners = new Set<() => void>();
let snapshot: UploadEntry[] = [];
let running = false;
let restored: Promise<void> | null = null;

// ── store plumbing ──────────────────────────────────────────────────────────

function toEntry(r: Runtime): UploadEntry {
  const remaining = Math.max(0, r.fileSize - r.uploadedBytes);
  return {
    jobId: r.jobId,
    jobTitle: r.jobTitle,
    fileName: r.fileName,
    fileSize: r.fileSize,
    uploadedBytes: r.uploadedBytes,
    state: r.state,
    error: r.error,
    bytesPerSecond: r.bytesPerSecond,
    etaSeconds:
      r.state === "uploading" && r.bytesPerSecond > 0
        ? Math.round(remaining / r.bytesPerSecond)
        : null,
    needsFile: r.file === null && r.state !== "done",
  };
}

function rebuildSnapshot() {
  snapshot = [...entries.values()]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(toEntry);
}

function emit() {
  rebuildSnapshot();
  for (const l of listeners) l();
}

/**
 * XHR fires `progress` every ~50ms. Re-rendering the whole Studio 20×/second
 * for a moving bar is wasteful and makes the page feel worse than the blocking
 * upload it replaced, so byte-level progress emits at most 5×/second. State
 * TRANSITIONS always use emit() directly and are never throttled.
 */
let lastProgressEmit = 0;
function emitProgress() {
  const now = Date.now();
  if (now - lastProgressEmit < 200) return;
  lastProgressEmit = now;
  emit();
}

function persist(r: Runtime) {
  const { chunkSize, bytesPerSecond, cancelled, xhr, ...rest } = r;
  void chunkSize;
  void bytesPerSecond;
  void cancelled;
  void xhr;
  void putUpload({ ...rest, updatedAt: Date.now() }).catch((err) => {
    // Losing persistence does not lose the upload — it only means a reload
    // cannot resume it. Say so in the console rather than failing the upload.
    console.warn("[recording-upload] could not persist upload state", err);
  });
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  void restore();
  return () => listeners.delete(listener);
}

export function getSnapshot(): UploadEntry[] {
  return snapshot;
}

/** Server-safe snapshot for useSyncExternalStore. */
export function getServerSnapshot(): UploadEntry[] {
  return [];
}

// ── public API ──────────────────────────────────────────────────────────────

/** Rehydrate persisted uploads once per page load and resume them. */
export function restore(): Promise<void> {
  if (restored) return restored;
  if (typeof window === "undefined") return Promise.resolve();
  restored = (async () => {
    let persisted: PersistedUpload[] = [];
    try {
      persisted = await listUploads();
    } catch (err) {
      console.warn("[recording-upload] could not read persisted uploads", err);
      return;
    }
    for (const p of persisted) {
      if (p.state === "done") {
        void deleteUpload(p.jobId);
        continue;
      }
      if (entries.has(p.jobId)) continue;
      entries.set(p.jobId, {
        ...p,
        // A reload interrupts whatever was in flight; everything resumable
        // goes back to "queued" and the pump picks it up.
        state: p.state === "error" ? "error" : "queued",
        chunkSize: DEFAULT_CHUNK_SIZE,
        bytesPerSecond: 0,
        cancelled: false,
        xhr: null,
      });
    }
    emit();
    void pump();
  })();
  return restored;
}

export function enqueueUpload(input: {
  jobId: string;
  jobTitle: string;
  file: File;
}): void {
  const existing = entries.get(input.jobId);
  if (
    existing &&
    (existing.state === "uploading" || existing.state === "finalizing")
  ) {
    throw new Error(
      `An upload for "${existing.jobTitle}" is already in flight (${Math.round(
        (existing.uploadedBytes / Math.max(1, existing.fileSize)) * 100,
      )}%). Cancel it before starting another.`,
    );
  }

  const sameFile =
    existing &&
    existing.fileName === input.file.name &&
    existing.fileSize === input.file.size &&
    existing.lastModified === input.file.lastModified;

  const rec: Runtime = {
    jobId: input.jobId,
    jobTitle: input.jobTitle,
    // Same file as the parked/errored attempt → keep the server session and
    // the byte offset so we resume instead of re-sending gigabytes.
    uploadId: sameFile ? (existing?.uploadId ?? null) : null,
    fileName: input.file.name,
    fileSize: input.file.size,
    lastModified: input.file.lastModified,
    file: input.file,
    uploadedBytes: sameFile ? (existing?.uploadedBytes ?? 0) : 0,
    state: "queued",
    error: null,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    chunkSize: DEFAULT_CHUNK_SIZE,
    bytesPerSecond: 0,
    cancelled: false,
    xhr: null,
  };

  entries.set(rec.jobId, rec);
  persist(rec);
  emit();
  void pump();
}

/** Retry an upload parked in `error`. Resumes from the server's byte offset. */
export function retryUpload(jobId: string): void {
  const r = entries.get(jobId);
  if (!r) return;
  if (!r.file) {
    r.error =
      "The recording file is no longer attached (page was reloaded and the browser dropped the handle). Drop the same file again — the upload resumes where it stopped.";
    emit();
    return;
  }
  r.state = "queued";
  r.error = null;
  r.cancelled = false;
  persist(r);
  emit();
  void pump();
}

/** Abort an upload and tell the server to drop its partial file. */
export async function cancelUpload(jobId: string): Promise<void> {
  const r = entries.get(jobId);
  if (!r) return;
  r.cancelled = true;
  r.xhr?.abort();
  const uploadId = r.uploadId;
  entries.delete(jobId);
  await deleteUpload(jobId).catch(() => {});
  emit();
  if (uploadId) {
    await fetch(
      `/api/production/jobs/${jobId}/recording/upload?uploadId=${uploadId}`,
      { method: "DELETE" },
    ).catch(() => {});
  }
}

/** Drop a finished/errored row from the queue widget. */
export function dismissUpload(jobId: string): void {
  const r = entries.get(jobId);
  if (!r || r.state === "uploading" || r.state === "finalizing") return;
  entries.delete(jobId);
  void deleteUpload(jobId).catch(() => {});
  emit();
}

export function hasActiveUploads(): boolean {
  for (const r of entries.values()) {
    if (
      r.state === "uploading" ||
      r.state === "queued" ||
      r.state === "finalizing"
    ) {
      return true;
    }
  }
  return false;
}

// ── the pump ────────────────────────────────────────────────────────────────

/**
 * One upload at a time. Recordings saturate the uplink; running two in
 * parallel makes both slower, halves the per-file resume granularity and
 * doubles the chance a flaky connection kills something.
 */
async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const next = [...entries.values()]
        .filter((r) => r.state === "queued")
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!next) return;
      await runUpload(next);
    }
  } finally {
    running = false;
  }
}

async function runUpload(r: Runtime): Promise<void> {
  r.state = "uploading";
  r.error = null;
  emit();

  try {
    if (!r.file) {
      throw new Error(
        "The recording file is no longer attached to this browser session. Drop the same file again — the upload resumes from where it stopped.",
      );
    }

    // ── begin / resume ──────────────────────────────────────────────────────
    const begin = await postJson<{
      uploadId: string;
      receivedBytes: number;
      chunkSize: number;
      resumed: boolean;
    }>(`/api/production/jobs/${r.jobId}/recording/upload`, {
      fileName: r.fileName,
      fileSize: r.fileSize,
      lastModified: r.lastModified,
    });

    r.uploadId = begin.uploadId;
    r.chunkSize = begin.chunkSize > 0 ? begin.chunkSize : DEFAULT_CHUNK_SIZE;
    // The SERVER's byte count is authoritative — never our local guess.
    r.uploadedBytes = Math.min(begin.receivedBytes, r.fileSize);
    persist(r);
    emit();

    // ── chunk loop ──────────────────────────────────────────────────────────
    //
    // Deliberately NOT `while (uploadedBytes < fileSize)`. If a previous
    // attempt died between writing the last chunk and finalizing, the server
    // already holds every byte — that loop would exit immediately having never
    // asked for finalization, and the take would sit there un-spliced. Instead
    // we keep going until the SERVER says `complete`, sending a zero-length
    // final chunk when there is nothing left to send.
    let stalls = 0;
    for (;;) {
      if (r.cancelled) return;

      const offset = r.uploadedBytes;
      const end = Math.min(offset + r.chunkSize, r.fileSize);
      const isFinal = end >= r.fileSize;
      const blob = r.file.slice(offset, end);

      const res = await sendChunkWithRetries(r, blob, offset, isFinal);

      if (typeof res.expectedOffset === "number") {
        // Server and client disagree about how much landed. The server wins.
        if (res.expectedOffset === offset) {
          stalls++;
          if (stalls > 5) {
            throw new Error(
              `Upload stalled at byte ${offset} of ${r.fileSize}: the server keeps rejecting this chunk without advancing. Nothing was published.`,
            );
          }
        } else {
          stalls = 0;
        }
        r.uploadedBytes = res.expectedOffset;
        persist(r);
        emit();
        continue;
      }

      stalls = 0;
      r.uploadedBytes =
        typeof res.receivedBytes === "number" ? res.receivedBytes : end;
      persist(r);
      emit();

      if (res.complete) {
        r.state = "done";
        r.uploadedBytes = r.fileSize;
        emit();
        void deleteUpload(r.jobId).catch(() => {});
        onCompleteCallbacks.forEach((cb) => cb(r.jobId, r.jobTitle));
        // Leave the row visible for a moment so the VA sees it turn green.
        setTimeout(() => dismissUpload(r.jobId), 8000);
        return;
      }

      if (isFinal) {
        // We asked for finalization and the server answered 2xx without
        // `complete`. Never assume it finished — that is exactly how a
        // half-written file gets ffprobed.
        throw new Error(
          `Server acknowledged the final chunk but did not confirm the recording was assembled (it reports ${r.uploadedBytes} of ${r.fileSize} bytes). Nothing was published; press Resume.`,
        );
      }
    }
  } catch (err) {
    if (r.cancelled) return;
    r.state = "error";
    r.error = err instanceof Error ? err.message : String(err);
    persist(r);
    emit();
    onErrorCallbacks.forEach((cb) => cb(r.jobId, r.jobTitle, r.error ?? ""));
  }
}

interface ChunkResponse {
  receivedBytes?: number;
  complete?: boolean;
  expectedOffset?: number;
  recording_path?: string;
  spliceEnqueued?: boolean;
}

async function sendChunkWithRetries(
  r: Runtime,
  blob: Blob,
  offset: number,
  isFinal: boolean,
): Promise<ChunkResponse> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_CHUNK_ATTEMPTS; attempt++) {
    if (r.cancelled) throw new Error("Upload cancelled");
    try {
      return await sendChunk(r, blob, offset, isFinal);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // A 4xx that is not a 409 is a permanent, actionable problem (wrong
      // file type, session gone, permissions). Retrying is pointless.
      if (err instanceof UploadHttpError && !err.retryable) throw err;
      if (err instanceof UploadHttpError && err.expectedOffset !== undefined) {
        return { expectedOffset: err.expectedOffset };
      }
      if (attempt === MAX_CHUNK_ATTEMPTS) break;
      const backoffMs = Math.min(30_000, 1000 * 2 ** (attempt - 1));
      await sleep(backoffMs);
      // Re-ask the server where it actually is before resending; the failed
      // request may have landed partially.
      try {
        const sync = await postJson<{ receivedBytes: number }>(
          `/api/production/jobs/${r.jobId}/recording/upload`,
          {
            fileName: r.fileName,
            fileSize: r.fileSize,
            lastModified: r.lastModified,
          },
        );
        if (sync.receivedBytes !== offset) {
          return { expectedOffset: sync.receivedBytes };
        }
      } catch {
        // Still offline — fall through and retry the chunk itself.
      }
    }
  }

  throw new Error(
    `Chunk at byte ${offset} failed after ${MAX_CHUNK_ATTEMPTS} attempts: ${lastError?.message ?? "unknown error"}. ${
      r.uploadedBytes
    } of ${r.fileSize} bytes are safe on the server — press Retry to resume.`,
  );
}

class UploadHttpError extends Error {
  status: number;
  retryable: boolean;
  expectedOffset: number | undefined;
  constructor(message: string, status: number, expectedOffset?: number) {
    super(message);
    this.name = "UploadHttpError";
    this.status = status;
    this.expectedOffset = expectedOffset;
    // 409 = offset disagreement (recoverable), 5xx = server hiccup, 408/429 =
    // transient. Everything else in 4xx is a real problem the VA must fix.
    this.retryable =
      status >= 500 || status === 408 || status === 429 || status === 409;
  }
}

function sendChunk(
  r: Runtime,
  blob: Blob,
  offset: number,
  isFinal: boolean,
): Promise<ChunkResponse> {
  return new Promise<ChunkResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    r.xhr = xhr;
    const url =
      `/api/production/jobs/${r.jobId}/recording/upload` +
      `?uploadId=${r.uploadId}&offset=${offset}${isFinal ? "&final=1" : ""}`;

    const startedAt = performance.now();

    xhr.upload.addEventListener("progress", (e) => {
      if (!e.lengthComputable) return;
      // Optimistic within-chunk progress; the authoritative offset is only
      // advanced when the server acknowledges the chunk.
      const shown = Math.min(r.fileSize, offset + e.loaded);
      const elapsed = (performance.now() - startedAt) / 1000;
      if (elapsed > 0.25) {
        const instant = e.loaded / elapsed;
        r.bytesPerSecond =
          r.bytesPerSecond > 0
            ? r.bytesPerSecond * 0.7 + instant * 0.3
            : instant;
      }
      if (shown > r.uploadedBytes) {
        r.uploadedBytes = shown;
        emitProgress();
      }
    });

    xhr.addEventListener("load", () => {
      r.xhr = null;
      let body: ChunkResponse & { error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText) as ChunkResponse & {
          error?: string;
        };
      } catch {
        // Fall through — handled by the status check below.
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body);
        return;
      }
      reject(
        new UploadHttpError(
          body.error ?? `Server returned HTTP ${xhr.status}`,
          xhr.status,
          typeof body.expectedOffset === "number"
            ? body.expectedOffset
            : undefined,
        ),
      );
    });

    xhr.addEventListener("error", () => {
      r.xhr = null;
      reject(new Error("Network error while sending chunk"));
    });
    xhr.addEventListener("timeout", () => {
      r.xhr = null;
      reject(new Error("Chunk upload timed out"));
    });
    xhr.addEventListener("abort", () => {
      r.xhr = null;
      reject(new Error("Upload cancelled"));
    });

    xhr.open("PATCH", url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    // No client-side timeout: the final chunk's response also carries the
    // rename + DB write + splice enqueue, and a slow VPS must not be mistaken
    // for a dead connection.
    xhr.timeout = 0;
    xhr.send(blob);
  });
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // handled below
  }
  if (!res.ok) {
    const message =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new UploadHttpError(message, res.status);
  }
  if (parsed === null) {
    throw new Error(
      `Server returned a non-JSON response: ${text.slice(0, 200)}`,
    );
  }
  return parsed as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── completion / error hooks (so the studio can refresh + toast) ────────────

type CompleteCb = (jobId: string, jobTitle: string) => void;
type ErrorCb = (jobId: string, jobTitle: string, error: string) => void;

const onCompleteCallbacks = new Set<CompleteCb>();
const onErrorCallbacks = new Set<ErrorCb>();

export function onUploadComplete(cb: CompleteCb): () => void {
  onCompleteCallbacks.add(cb);
  return () => onCompleteCallbacks.delete(cb);
}

export function onUploadError(cb: ErrorCb): () => void {
  onErrorCallbacks.add(cb);
  return () => onErrorCallbacks.delete(cb);
}

// ── leaving the page mid-upload ─────────────────────────────────────────────

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (!hasActiveUploads()) return;
    // Resumable, but only if they come back — warn anyway.
    e.preventDefault();
    e.returnValue = "";
  });
}
