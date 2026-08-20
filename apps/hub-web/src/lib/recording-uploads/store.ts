/**
 * IndexedDB persistence for in-flight recording uploads.
 *
 * We store the File object itself, not a copy of its bytes: Chrome and Firefox
 * serialize a file-backed Blob into IndexedDB by reference to the file on disk,
 * so a 2 GB recording costs ~nothing to persist and survives a page reload.
 *
 * If the VA moves or deletes the source file after the reload, reading the
 * blob throws NotReadableError. We surface that as a real, actionable error
 * ("re-drop the file, we'll resume from byte N") — we never silently drop the
 * upload or pretend it completed.
 */

const DB_NAME = "tutorial-recording-uploads";
const DB_VERSION = 1;
const STORE = "uploads";

export type PersistedState =
  | "queued"
  | "uploading"
  | "paused"
  | "finalizing"
  | "done"
  | "error";

export interface PersistedUpload {
  /** Tutorial job id — also the primary key: one in-flight upload per job. */
  jobId: string;
  jobTitle: string;
  /** Server-side session id; null until the first begin() succeeds. */
  uploadId: string | null;
  fileName: string;
  fileSize: number;
  lastModified: number;
  /** The source file. May be absent if the browser refused to persist it. */
  file: File | null;
  uploadedBytes: number;
  state: PersistedState;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(
        new Error(
          "IndexedDB is unavailable in this browser — uploads cannot be resumed after a reload.",
        ),
      );
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "jobId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("Failed to open the upload database"));
  });
  return dbPromise;
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const req = fn(transaction.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () =>
          reject(req.error ?? new Error("Upload database write failed"));
      }),
  );
}

export async function putUpload(rec: PersistedUpload): Promise<void> {
  await tx("readwrite", (s) => s.put(rec));
}

export async function deleteUpload(jobId: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(jobId));
}

export async function listUploads(): Promise<PersistedUpload[]> {
  const all = await tx<PersistedUpload[]>("readonly", (s) => s.getAll());
  return all ?? [];
}
