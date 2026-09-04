import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import type { DriveConfig } from "../config.js";
import {
  classifyHttpError,
  classifyThrown,
  storageError,
  type StorageError,
} from "../errors.js";
import {
  withRetry,
  realRetryDeps,
  type Attempt,
  type BackoffOptions,
  type RetryDeps,
} from "../retry.js";
import { TokenBucketRateLimiter } from "../rate-limiter.js";
import { DriveTokenProvider, type FetchLike } from "./auth.js";

/**
 * A minimal Google Drive v3 client.
 *
 * Hand-rolled on fetch rather than pulling in `googleapis` on purpose:
 *   - `googleapis` is a ~50 MB dependency for the four endpoints we use;
 *   - it is not currently installed anywhere in this monorepo;
 *   - we need explicit control of resumable-upload chunking and resumption,
 *     which the SDK hides.
 *
 * Every request goes through the rate limiter and the retry policy. There is
 * no path in this file that swallows an error.
 */

export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

/** appProperties keys — how we recognise our own files on re-runs. */
export const APP_PROP_JOB_ID = "cfJobId";
export const APP_PROP_KIND = "cfKind";

export interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  webViewLink?: string;
  size?: string;
  md5Checksum?: string;
  sha256Checksum?: string;
  version?: string;
  trashed?: boolean;
}

interface DriveFileListResponse {
  files?: DriveFile[];
  nextPageToken?: string;
  incompleteSearch?: boolean;
}

export interface DriveClientDeps {
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  rng?: () => number;
  onRetry?: RetryDeps["onRetry"];
}

interface RawRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  /** Statuses that are a normal outcome, not an error (e.g. 308 during upload). */
  acceptStatuses?: number[];
}

interface RawResponse {
  status: number;
  headers: Headers;
  text: string;
}

export class DriveClient {
  private readonly tokens: DriveTokenProvider;
  private readonly limiter: TokenBucketRateLimiter;
  private readonly backoff: BackoffOptions;
  private readonly retryDeps: RetryDeps;
  private readonly fetchImpl: FetchLike;
  /** name+parent -> folder id. Saves a list() per artefact per job. */
  private readonly folderCache = new Map<string, string>();

  constructor(
    private readonly config: DriveConfig,
    deps: DriveClientDeps = {},
  ) {
    this.tokens = new DriveTokenProvider(config.auth, {
      ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
      ...(deps.now !== undefined ? { now: deps.now } : {}),
    });
    this.limiter = new TokenBucketRateLimiter({
      requestsPerSecond: config.requestsPerSecond,
      burst: config.burst,
      ...(deps.now !== undefined ? { now: deps.now } : {}),
      ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
    });
    this.backoff = {
      baseDelayMs: 1_000,
      maxDelayMs: 60_000,
      maxAttempts: config.maxAttempts,
      jitter: 1,
    };
    this.retryDeps = {
      sleep: deps.sleep ?? realRetryDeps.sleep,
      rng: deps.rng ?? realRetryDeps.rng,
      ...(deps.onRetry !== undefined ? { onRetry: deps.onRetry } : {}),
    };
    this.fetchImpl = deps.fetch ?? globalThis.fetch;
  }

  // ---------------------------------------------------------------- plumbing

  /**
   * One HTTP attempt: acquire a token, wait for a rate-limit slot, send.
   * Retries are applied by the caller via `request()`.
   */
  private async attempt(req: RawRequest): Promise<Attempt<RawResponse>> {
    const tokenResult = await this.tokens.getToken();
    if (!tokenResult.ok) return tokenResult;

    await this.limiter.acquire();

    let response: Response;
    try {
      response = await this.fetchImpl(req.url, {
        method: req.method,
        headers: {
          authorization: `Bearer ${tokenResult.value.token}`,
          ...(req.headers ?? {}),
        },
        ...(req.body !== undefined ? { body: req.body } : {}),
        // Node needs this for a stream body; harmless elsewhere.
        ...(req.body instanceof ReadableStream ? { duplex: "half" } : {}),
      } as RequestInit);
    } catch (err) {
      return { ok: false, error: classifyThrown(err) };
    }

    const accept = req.acceptStatuses ?? [];
    if (response.ok || accept.includes(response.status)) {
      // 308 has no body worth reading but does carry a Range header.
      const text = response.status === 308 ? "" : await response.text();
      return {
        ok: true,
        value: { status: response.status, headers: response.headers, text },
      };
    }

    const text = await response.text().catch(() => "");
    const error = classifyHttpError({
      status: response.status,
      bodyText: text,
      retryAfterHeader: response.headers.get("retry-after"),
    });

    if (error.kind === "auth" && response.status === 401) {
      // The token may simply have aged out mid-flight; force a re-mint so the
      // retry has a chance. A genuinely bad credential fails again identically.
      this.tokens.invalidate();
    }
    if (error.kind === "rate_limited") {
      // Slow *everything* down, not just this call. A 429 is about the whole
      // project's quota, so punishing only the unlucky request is pointless.
      this.limiter.penalise(error.retryAfterMs ?? 5_000);
    }

    return { ok: false, error };
  }

  private request(req: RawRequest): Promise<Attempt<RawResponse>> {
    return withRetry(() => this.attempt(req), this.backoff, this.retryDeps);
  }

  private static parseJson<T>(text: string): Attempt<T> {
    try {
      return { ok: true, value: JSON.parse(text) as T };
    } catch {
      return {
        ok: false,
        error: storageError(
          "unknown",
          `Drive returned non-JSON: ${text.slice(0, 200)}`,
        ),
      };
    }
  }

  // ----------------------------------------------------------------- folders

  /**
   * Find a direct child folder by name, or create it. Idempotent: two workers
   * racing here can create a duplicate folder in Drive (Drive has no unique
   * constraint on names), which is why the *file* lookup is keyed on
   * appProperties rather than on path.
   */
  async ensureFolder(
    name: string,
    parentId: string | null,
  ): Promise<Attempt<string>> {
    const cacheKey = `${parentId ?? "root"}/${name}`;
    const cached = this.folderCache.get(cacheKey);
    if (cached !== undefined) return { ok: true, value: cached };

    const found = await this.findFolder(name, parentId);
    if (!found.ok) return found;
    if (found.value !== null) {
      this.folderCache.set(cacheKey, found.value);
      return { ok: true, value: found.value };
    }

    const created = await this.createFolder(name, parentId);
    if (!created.ok) return created;
    this.folderCache.set(cacheKey, created.value);
    return created;
  }

  async findFolder(
    name: string,
    parentId: string | null,
  ): Promise<Attempt<string | null>> {
    const escaped = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const clauses = [
      `name = '${escaped}'`,
      `mimeType = '${DRIVE_FOLDER_MIME}'`,
      "trashed = false",
      `'${parentId ?? "root"}' in parents`,
    ];
    const url = `${DRIVE_FILES_URL}?${new URLSearchParams({
      q: clauses.join(" and "),
      fields: "files(id,name)",
      pageSize: "10",
      spaces: "drive",
    }).toString()}`;

    const res = await this.request({ url, method: "GET" });
    if (!res.ok) return res;

    const parsed = DriveClient.parseJson<DriveFileListResponse>(res.value.text);
    if (!parsed.ok) return parsed;
    const first = parsed.value.files?.[0];
    return { ok: true, value: first?.id ?? null };
  }

  /**
   * List every direct child of a folder. The exchange transport relies on a
   * complete listing because Drive permits duplicate names: picking the first
   * match would turn an integrity conflict into an apparently successful
   * publish. Pagination is therefore handled here rather than at call sites.
   */
  async listChildren(parentId: string): Promise<Attempt<DriveFile[]>> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < 200; page += 1) {
      const params: Record<string, string> = {
        q: `'${parentId.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' in parents and trashed = false`,
        fields:
          "incompleteSearch,nextPageToken,files(id,name,mimeType,webViewLink,size,md5Checksum,sha256Checksum,version,trashed)",
        pageSize: "1000",
        orderBy: "name",
        spaces: "drive",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
        corpora: "allDrives",
        ...(pageToken !== undefined ? { pageToken } : {}),
      };
      const res = await this.request({
        url: `${DRIVE_FILES_URL}?${new URLSearchParams(params).toString()}`,
        method: "GET",
      });
      if (!res.ok) return res;
      const parsed = DriveClient.parseJson<DriveFileListResponse>(
        res.value.text,
      );
      if (!parsed.ok) return parsed;
      if (parsed.value.incompleteSearch === true) {
        return {
          ok: false,
          error: storageError(
            "unknown",
            "Drive returned an incomplete child listing",
          ),
        };
      }
      files.push(...(parsed.value.files ?? []));
      pageToken = parsed.value.nextPageToken;
      if (pageToken === undefined || pageToken === "") {
        return { ok: true, value: files };
      }
    }

    return {
      ok: false,
      error: storageError("unknown", "Drive child listing exceeded 200 pages"),
    };
  }

  async createFolder(
    name: string,
    parentId: string | null,
  ): Promise<Attempt<string>> {
    const metadata = {
      name,
      mimeType: DRIVE_FOLDER_MIME,
      ...(parentId !== null ? { parents: [parentId] } : {}),
    };
    const res = await this.request({
      url: `${DRIVE_FILES_URL}?fields=id`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(metadata),
    });
    if (!res.ok) return res;

    const parsed = DriveClient.parseJson<{ id?: string }>(res.value.text);
    if (!parsed.ok) return parsed;
    if (typeof parsed.value.id !== "string") {
      return {
        ok: false,
        error: storageError("unknown", "folder create returned no id"),
      };
    }
    return { ok: true, value: parsed.value.id };
  }

  /** Walk/create a chain of folders, returning the id of the deepest one. */
  async ensureFolderPath(segments: string[]): Promise<Attempt<string>> {
    let parent: string | null = this.config.rootFolderId ?? null;
    // When an explicit root folder id is configured, the first segment (our
    // own root folder name) is redundant — the user pointed us at a folder.
    const chain =
      this.config.rootFolderId !== undefined ? segments.slice(1) : segments;

    for (const segment of chain) {
      const result: Attempt<string> = await this.ensureFolder(segment, parent);
      if (!result.ok) return result;
      parent = result.value;
    }
    if (parent === null) {
      return {
        ok: false,
        error: storageError("bad_request", "empty folder path"),
      };
    }
    return { ok: true, value: parent };
  }

  // ------------------------------------------------------------- idempotency

  /**
   * Look for a file we previously uploaded for this (job, kind), by
   * appProperties. This is the authoritative de-duplication check: it survives
   * a lost DB row, a renamed folder, and a moved file.
   */
  async findExistingArtifact(
    jobId: string,
    kind: string,
  ): Promise<Attempt<DriveFile | null>> {
    const clauses = [
      `appProperties has { key='${APP_PROP_JOB_ID}' and value='${jobId}' }`,
      `appProperties has { key='${APP_PROP_KIND}' and value='${kind}' }`,
      "trashed = false",
    ];
    const url = `${DRIVE_FILES_URL}?${new URLSearchParams({
      q: clauses.join(" and "),
      fields: "files(id,name,webViewLink,size,md5Checksum,trashed)",
      pageSize: "5",
      spaces: "drive",
    }).toString()}`;

    const res = await this.request({ url, method: "GET" });
    if (!res.ok) return res;

    const parsed = DriveClient.parseJson<DriveFileListResponse>(res.value.text);
    if (!parsed.ok) return parsed;
    return { ok: true, value: parsed.value.files?.[0] ?? null };
  }

  /**
   * Delete a file we uploaded. Used to roll back a checksum mismatch — a
   * corrupt Drive copy must not be left behind masquerading as the artefact.
   */
  async deleteFile(fileId: string): Promise<Attempt<void>> {
    const res = await this.request({
      url: `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`,
      method: "DELETE",
      acceptStatuses: [204, 404],
    });
    if (!res.ok) return res;
    return { ok: true, value: undefined };
  }

  /**
   * Storage quota for the account (about.get). Used by the health probe to
   * report how full the Drive is. `drive.file` scope is sufficient for this.
   */
  async getAbout(): Promise<
    Attempt<{ limitBytes: number | null; usageBytes: number | null }>
  > {
    const url = `https://www.googleapis.com/drive/v3/about?fields=storageQuota`;
    const res = await this.request({ url, method: "GET" });
    if (!res.ok) return res;
    const parsed = DriveClient.parseJson<{
      storageQuota?: { limit?: string; usage?: string };
    }>(res.value.text);
    if (!parsed.ok) return parsed;
    const q = parsed.value.storageQuota;
    return {
      ok: true,
      value: {
        limitBytes: q?.limit !== undefined ? Number(q.limit) : null,
        usageBytes: q?.usage !== undefined ? Number(q.usage) : null,
      },
    };
  }

  async getFile(fileId: string): Promise<Attempt<DriveFile>> {
    const url = `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?${new URLSearchParams(
      {
        fields:
          "id,name,mimeType,webViewLink,size,md5Checksum,sha256Checksum,version,trashed",
      },
    ).toString()}`;
    const res = await this.request({ url, method: "GET" });
    if (!res.ok) return res;
    return DriveClient.parseJson<DriveFile>(res.value.text);
  }

  private async attemptReadFile(
    fileId: string,
    maxBytes: number,
    collect: boolean,
  ): Promise<Attempt<{ content?: Buffer; sizeBytes: number; sha256: string }>> {
    const tokenResult = await this.tokens.getToken();
    if (!tokenResult.ok) return tokenResult;
    await this.limiter.acquire();

    let response: Response;
    try {
      response = await this.fetchImpl(
        `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
        {
          method: "GET",
          headers: { authorization: `Bearer ${tokenResult.value.token}` },
        },
      );
    } catch (err) {
      return { ok: false, error: classifyThrown(err) };
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      const error = classifyHttpError({
        status: response.status,
        bodyText,
        retryAfterHeader: response.headers.get("retry-after"),
      });
      if (error.kind === "auth" && response.status === 401) {
        this.tokens.invalidate();
      }
      if (error.kind === "rate_limited") {
        this.limiter.penalise(error.retryAfterMs ?? 5_000);
      }
      return { ok: false, error };
    }

    const declaredLength = response.headers.get("content-length");
    if (
      declaredLength !== null &&
      Number.isFinite(Number(declaredLength)) &&
      Number(declaredLength) > maxBytes
    ) {
      await response.body?.cancel();
      return {
        ok: false,
        error: storageError(
          "bad_request",
          `Drive file exceeds the ${maxBytes} byte read limit`,
        ),
      };
    }
    if (response.body === null) {
      return {
        ok: false,
        error: storageError("unknown", "Drive file response had no body"),
      };
    }

    const digest = createHash("sha256");
    const chunks: Buffer[] = [];
    let sizeBytes = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        const chunk = Buffer.from(next.value);
        sizeBytes += chunk.byteLength;
        if (sizeBytes > maxBytes) {
          await reader.cancel();
          return {
            ok: false,
            error: storageError(
              "bad_request",
              `Drive file exceeded the ${maxBytes} byte read limit`,
            ),
          };
        }
        digest.update(chunk);
        if (collect) chunks.push(chunk);
      }
    } catch (err) {
      return { ok: false, error: classifyThrown(err) };
    }

    return {
      ok: true,
      value: {
        ...(collect ? { content: Buffer.concat(chunks) } : {}),
        sizeBytes,
        sha256: digest.digest("hex"),
      },
    };
  }

  /** Read a bounded Drive object into memory (used for JSON receipts/markers). */
  async downloadFileBytes(
    fileId: string,
    maxBytes: number,
  ): Promise<Attempt<{ content: Buffer; sizeBytes: number; sha256: string }>> {
    const result = await withRetry(
      () => this.attemptReadFile(fileId, maxBytes, true),
      this.backoff,
      this.retryDeps,
    );
    if (!result.ok) return result;
    if (result.value.content === undefined) {
      return {
        ok: false,
        error: storageError("unknown", "Drive file read produced no bytes"),
      };
    }
    return {
      ok: true,
      value: {
        content: result.value.content,
        sizeBytes: result.value.sizeBytes,
        sha256: result.value.sha256,
      },
    };
  }

  /** Hash a bounded Drive object without retaining its bytes in memory. */
  async inspectFileContent(
    fileId: string,
    maxBytes: number,
  ): Promise<Attempt<{ sizeBytes: number; sha256: string }>> {
    const result = await withRetry(
      () => this.attemptReadFile(fileId, maxBytes, false),
      this.backoff,
      this.retryDeps,
    );
    if (!result.ok) return result;
    return {
      ok: true,
      value: {
        sizeBytes: result.value.sizeBytes,
        sha256: result.value.sha256,
      },
    };
  }

  // ---------------------------------------------------------------- uploads

  /**
   * Start a resumable session. Returns the session URI, which the caller must
   * persist — that is what lets a 400 MB upload survive a worker restart.
   */
  async createResumableSession(args: {
    filename: string;
    parentId: string;
    mimeType: string;
    sizeBytes: number;
    jobId: string;
    kind: string;
  }): Promise<Attempt<string>> {
    const metadata = {
      name: args.filename,
      parents: [args.parentId],
      appProperties: {
        [APP_PROP_JOB_ID]: args.jobId,
        [APP_PROP_KIND]: args.kind,
      },
    };
    const res = await this.request({
      url: `${DRIVE_UPLOAD_URL}?uploadType=resumable&fields=id,name,mimeType,webViewLink,size,md5Checksum,sha256Checksum,version,trashed`,
      method: "POST",
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": args.mimeType,
        "x-upload-content-length": String(args.sizeBytes),
      },
      body: JSON.stringify(metadata),
    });
    if (!res.ok) return res;

    const location = res.value.headers.get("location");
    if (location === null || location === "") {
      return {
        ok: false,
        error: storageError(
          "unknown",
          "resumable session response had no Location header",
        ),
      };
    }
    return { ok: true, value: location };
  }

  /**
   * Ask the server how many bytes it already has for a session.
   * Returns the next byte offset, or `"complete"` when the upload already
   * finished (which happens if we crashed after the final chunk landed).
   */
  async queryResumableOffset(
    sessionUri: string,
    totalBytes: number,
  ): Promise<Attempt<number | "complete">> {
    const res = await this.request({
      url: sessionUri,
      method: "PUT",
      headers: { "content-range": `bytes */${totalBytes}` },
      acceptStatuses: [308, 200, 201, 404],
    });
    if (!res.ok) return res;

    if (res.value.status === 404) {
      return {
        ok: false,
        error: storageError(
          "not_found",
          "resumable session expired or was cancelled (Drive sessions live ~1 week)",
        ),
      };
    }
    if (res.value.status === 200 || res.value.status === 201) {
      return { ok: true, value: "complete" };
    }

    const range = res.value.headers.get("range");
    if (range === null || range === "") {
      // No Range header on a 308 means the server has zero bytes.
      return { ok: true, value: 0 };
    }
    const match = /bytes=0-(\d+)/.exec(range);
    if (match?.[1] === undefined) {
      return {
        ok: false,
        error: storageError("unknown", `unparseable Range header: ${range}`),
      };
    }
    return { ok: true, value: Number(match[1]) + 1 };
  }

  /**
   * Upload one chunk. Returns the finished DriveFile when this was the last
   * chunk, or the new offset when the server wants more.
   *
   * Note this deliberately does NOT go through `withRetry` at the chunk level
   * with a fresh body — a consumed stream cannot be replayed. The caller
   * re-queries the offset and re-reads from disk instead.
   */
  async uploadChunk(args: {
    sessionUri: string;
    localPath: string;
    start: number;
    end: number; // inclusive
    totalBytes: number;
  }): Promise<
    Attempt<
      { done: false; nextOffset: number } | { done: true; file: DriveFile }
    >
  > {
    const { sessionUri, localPath, start, end, totalBytes } = args;
    const length = end - start + 1;

    await this.limiter.acquire();
    const tokenResult = await this.tokens.getToken();
    if (!tokenResult.ok) return tokenResult;

    let response: Response;
    try {
      const stream = createReadStream(localPath, { start, end });
      response = await this.fetchImpl(sessionUri, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${tokenResult.value.token}`,
          "content-length": String(length),
          "content-range": `bytes ${start}-${end}/${totalBytes}`,
        },
        // Node's fetch accepts a Readable as a body with duplex: "half".
        body: stream as unknown as BodyInit,
        duplex: "half",
      } as RequestInit);
    } catch (err) {
      return { ok: false, error: classifyThrown(err) };
    }

    if (response.status === 308) {
      const range = response.headers.get("range");
      const match = range !== null ? /bytes=0-(\d+)/.exec(range) : null;
      const nextOffset =
        match?.[1] !== undefined ? Number(match[1]) + 1 : end + 1;
      return { ok: true, value: { done: false, nextOffset } };
    }

    if (response.ok) {
      const text = await response.text();
      const parsed = DriveClient.parseJson<DriveFile>(text);
      if (!parsed.ok) return parsed;
      return { ok: true, value: { done: true, file: parsed.value } };
    }

    const text = await response.text().catch(() => "");
    const error: StorageError = classifyHttpError({
      status: response.status,
      bodyText: text,
      retryAfterHeader: response.headers.get("retry-after"),
    });
    if (error.kind === "rate_limited") {
      this.limiter.penalise(error.retryAfterMs ?? 5_000);
    }
    if (response.status === 401) this.tokens.invalidate();
    return { ok: false, error };
  }

  /** Small files (metadata sidecar, thumbnails) — one multipart request. */
  async uploadSmallFile(args: {
    filename: string;
    parentId: string;
    mimeType: string;
    content: Buffer;
    jobId: string;
    kind: string;
  }): Promise<Attempt<DriveFile>> {
    const boundary = `cf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const metadata = {
      name: args.filename,
      parents: [args.parentId],
      appProperties: {
        [APP_PROP_JOB_ID]: args.jobId,
        [APP_PROP_KIND]: args.kind,
      },
    };
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
          metadata,
        )}\r\n--${boundary}\r\ncontent-type: ${args.mimeType}\r\n\r\n`,
      ),
      args.content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const res = await this.request({
      url: `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,name,mimeType,webViewLink,size,md5Checksum,sha256Checksum,version,trashed`,
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${boundary}` },
      body: new Uint8Array(body),
    });
    if (!res.ok) return res;
    return DriveClient.parseJson<DriveFile>(res.value.text);
  }

  /** Replace the bytes of an existing file (used when a re-render supersedes). */
  async updateSmallFile(args: {
    fileId: string;
    mimeType: string;
    content: Buffer;
  }): Promise<Attempt<DriveFile>> {
    const res = await this.request({
      url: `${DRIVE_UPLOAD_URL}/${encodeURIComponent(
        args.fileId,
      )}?uploadType=media&fields=id,name,mimeType,webViewLink,size,md5Checksum,sha256Checksum,version,trashed`,
      method: "PATCH",
      headers: { "content-type": args.mimeType },
      body: new Uint8Array(args.content),
    });
    if (!res.ok) return res;
    return DriveClient.parseJson<DriveFile>(res.value.text);
  }

  /** Verify a local file is readable and get its size, without reading it all. */
  static async statLocal(path: string): Promise<Attempt<number>> {
    try {
      const handle = await open(path, "r");
      try {
        const stats = await handle.stat();
        if (!stats.isFile()) {
          return {
            ok: false,
            error: storageError("local_file", `${path} is not a regular file`),
          };
        }
        return { ok: true, value: stats.size };
      } finally {
        await handle.close();
      }
    } catch (err) {
      return { ok: false, error: classifyThrown(err) };
    }
  }
}
