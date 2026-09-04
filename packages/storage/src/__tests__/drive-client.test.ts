import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DriveClient } from "../drive/client.js";
import { resumableUpload } from "../drive/resumable-upload.js";
import { FakeDrive, fakeDriveConfig } from "./fake-drive.js";
import type { BackoffOptions, RetryDeps } from "../retry.js";

const NO_WAIT: RetryDeps = { sleep: async () => undefined, rng: () => 0.5 };
const BACKOFF: BackoffOptions = {
  baseDelayMs: 1,
  maxDelayMs: 4,
  maxAttempts: 4,
  jitter: 0,
};

/**
 * A virtual clock. `sleep` advances time instead of waiting, so backoff and
 * rate-limit penalties are exercised for real without the suite taking
 * minutes - and without a no-op sleep spinning forever against a real clock.
 */
function client(drive: FakeDrive, over = {}): DriveClient {
  let t = 0;
  return new DriveClient(fakeDriveConfig(over), {
    fetch: drive.fetch,
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    rng: () => 0.5,
  });
}

function rateLimitBody(): string {
  return JSON.stringify({
    error: {
      code: 403,
      message: "Rate Limit Exceeded",
      errors: [{ reason: "rateLimitExceeded" }],
    },
  });
}

describe("DriveClient folders", () => {
  let drive: FakeDrive;
  beforeEach(() => {
    drive = new FakeDrive();
  });

  it("creates a folder chain and returns the deepest id", async () => {
    const c = client(drive);
    const result = await c.ensureFolderPath([
      "Content Forge",
      "Casually Explained",
      "2026-07",
      "2026-07-28__x__abcd1234",
    ]);
    expect(result.ok).toBe(true);
    expect(drive.files.size).toBe(4);
  });

  it("is idempotent: a second call creates nothing new", async () => {
    const c = client(drive);
    const segments = ["Content Forge", "Chan", "2026-07", "job"];
    const first = await c.ensureFolderPath(segments);
    const countAfterFirst = drive.files.size;

    // A fresh client, so the in-memory folder cache cannot mask a real lookup.
    const c2 = client(drive);
    const second = await c2.ensureFolderPath(segments);

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(second.value).toBe(first.value);
    expect(drive.files.size).toBe(countAfterFirst);
  });

  it("caches folder lookups within a client", async () => {
    const c = client(drive);
    await c.ensureFolderPath(["Content Forge", "Chan", "2026-07", "job"]);
    const requestsAfterFirst = drive.requests.length;
    await c.ensureFolderPath(["Content Forge", "Chan", "2026-07", "job"]);
    expect(drive.requests.length).toBe(requestsAfterFirst);
  });

  it("escapes quotes in folder names so the query cannot be broken", async () => {
    const c = client(drive);
    const result = await c.ensureFolder("Konrad's Channel", null);
    expect(result.ok).toBe(true);
    const listing = drive.requests.find((r) => r.method === "GET");
    expect(listing?.url).toContain("Konrad");
  });

  it("skips our own root segment when an explicit root folder id is configured", async () => {
    const c = client(drive, { rootFolderId: "preexisting-folder" });
    const result = await c.ensureFolderPath([
      "Content Forge",
      "Chan",
      "2026-07",
    ]);
    expect(result.ok).toBe(true);
    // Only Chan + 2026-07 created; "Content Forge" was replaced by the id.
    expect(drive.files.size).toBe(2);
  });

  it("lists all direct children without collapsing duplicate-capable names", async () => {
    const c = client(drive);
    const folder = await c.ensureFolder("Exchange", null);
    if (!folder.ok) throw new Error("folder");
    await c.uploadSmallFile({
      filename: "receipt.json",
      parentId: folder.value,
      mimeType: "application/json",
      content: Buffer.from("{}"),
      jobId: "exchange-1",
      kind: "receipt",
    });

    const children = await c.listChildren(folder.value);

    expect(children.ok).toBe(true);
    if (children.ok) {
      expect(children.value.map((file) => file.name)).toEqual(["receipt.json"]);
    }
  });
});

describe("DriveClient bounded reads", () => {
  function readClient(content: Buffer): DriveClient {
    let now = 0;
    return new DriveClient(fakeDriveConfig(), {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      fetch: async (input) => {
        const url = input.toString();
        if (url.includes("oauth2.googleapis.com/token")) {
          return new Response(
            JSON.stringify({ access_token: "token", expires_in: 3600 }),
            { status: 200 },
          );
        }
        return new Response(content, {
          status: 200,
          headers: { "content-length": String(content.byteLength) },
        });
      },
    });
  }

  it("returns exact bytes, size and SHA-256 for a bounded JSON object", async () => {
    const content = Buffer.from('{"state":"accepted"}');
    const result = await readClient(content).downloadFileBytes("receipt", 1024);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content.equals(content)).toBe(true);
      expect(result.value.sizeBytes).toBe(content.byteLength);
      expect(result.value.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("refuses a body whose declared length exceeds the caller's limit", async () => {
    const result = await readClient(Buffer.alloc(20)).downloadFileBytes(
      "receipt",
      10,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("bad_request");
  });
});

describe("DriveClient retry behaviour", () => {
  let drive: FakeDrive;
  beforeEach(() => {
    drive = new FakeDrive();
  });

  it("retries a 429 and eventually succeeds", async () => {
    drive.failNext({
      urlIncludes: "/drive/v3/files",
      status: 429,
      body: rateLimitBody(),
      times: 2,
    });
    const c = client(drive);
    const result = await c.ensureFolder("Chan", null);
    expect(result.ok).toBe(true);
  });

  it("retries a 500 and eventually succeeds", async () => {
    drive.failNext({
      urlIncludes: "/drive/v3/files",
      status: 503,
      body: "{}",
      times: 1,
    });
    const c = client(drive);
    const result = await c.ensureFolder("Chan", null);
    expect(result.ok).toBe(true);
  });

  it("does NOT retry a full Drive, and surfaces quota_exceeded", async () => {
    drive.failNext({
      urlIncludes: "/drive/v3/files",
      status: 403,
      body: JSON.stringify({
        error: {
          code: 403,
          message: "The user has exceeded their Drive storage quota.",
          errors: [{ reason: "storageQuotaExceeded" }],
        },
      }),
      times: 99,
    });
    const c = client(drive);
    const result = await c.ensureFolder("Chan", null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("quota_exceeded");
    // One attempt only - a full Drive is not a transient condition.
    const listCalls = drive.requests.filter((r) =>
      r.url.includes("/drive/v3/files"),
    );
    expect(listCalls.length).toBe(1);
  });

  it("gives up after maxAttempts on persistent throttling", async () => {
    drive.failNext({
      urlIncludes: "/drive/v3/files",
      status: 429,
      body: rateLimitBody(),
      times: 99,
    });
    const c = client(drive, { maxAttempts: 3 });
    const result = await c.ensureFolder("Chan", null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("rate_limited");
    const listCalls = drive.requests.filter((r) =>
      r.url.includes("/drive/v3/files"),
    );
    expect(listCalls.length).toBe(3);
  });

  it("mints one token and reuses it across many requests", async () => {
    const c = client(drive);
    await c.ensureFolder("A", null);
    await c.ensureFolder("B", null);
    await c.ensureFolder("C", null);
    expect(drive.tokenRequests).toBe(1);
  });
});

describe("findExistingArtifact", () => {
  it("finds a file by job id + kind, ignoring other jobs", async () => {
    const drive = new FakeDrive();
    const c = client(drive);
    const folder = await c.ensureFolder("Chan", null);
    expect(folder.ok).toBe(true);
    if (!folder.ok) return;

    await c.uploadSmallFile({
      filename: "metadata.json",
      parentId: folder.value,
      mimeType: "application/json",
      content: Buffer.from("{}"),
      jobId: "job-A",
      kind: "metadata",
    });

    const hit = await c.findExistingArtifact("job-A", "metadata");
    expect(hit.ok).toBe(true);
    if (hit.ok) expect(hit.value).not.toBeNull();

    const missByJob = await c.findExistingArtifact("job-B", "metadata");
    expect(missByJob.ok && missByJob.value).toBeNull();

    const missByKind = await c.findExistingArtifact("job-A", "final_video");
    expect(missByKind.ok && missByKind.value).toBeNull();
  });
});

describe("resumableUpload", () => {
  let dir: string;
  let drive: FakeDrive;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cf-storage-test-"));
    drive = new FakeDrive();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function makeFile(name: string, bytes: number): Promise<string> {
    const path = join(dir, name);
    await writeFile(path, Buffer.alloc(bytes, 7));
    return path;
  }

  it("uploads a multi-chunk file and reports the finished Drive file", async () => {
    const path = await makeFile("video.mp4", 256 * 1024 * 3 + 500);
    const c = client(drive);
    const folder = await c.ensureFolder("Chan", null);
    if (!folder.ok) throw new Error("folder");

    const result = await resumableUpload(
      c,
      {
        localPath: path,
        totalBytes: 256 * 1024 * 3 + 500,
        filename: "final_video.mp4",
        parentId: folder.value,
        mimeType: "video/mp4",
        jobId: "job-1",
        kind: "final_video",
        chunkSizeBytes: 256 * 1024,
      },
      BACKOFF,
      NO_WAIT,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(Number(result.value.size)).toBe(256 * 1024 * 3 + 500);
  });

  it("reports progress so a restart can resume", async () => {
    const total = 256 * 1024 * 3;
    const path = await makeFile("video.mp4", total);
    const c = client(drive);
    const folder = await c.ensureFolder("Chan", null);
    if (!folder.ok) throw new Error("folder");

    const progress: number[] = [];
    const result = await resumableUpload(
      c,
      {
        localPath: path,
        totalBytes: total,
        filename: "final_video.mp4",
        parentId: folder.value,
        mimeType: "video/mp4",
        jobId: "job-1",
        kind: "final_video",
        chunkSizeBytes: 256 * 1024,
        onProgress: (info) => {
          progress.push(info.bytesUploaded);
        },
      },
      BACKOFF,
      NO_WAIT,
    );

    expect(result.ok).toBe(true);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(total);
    expect(progress.length).toBeGreaterThan(2);
  });

  it("resumes from a persisted session instead of restarting at byte 0", async () => {
    const total = 256 * 1024 * 4;
    const path = await makeFile("video.mp4", total);
    const c = client(drive);
    const folder = await c.ensureFolder("Chan", null);
    if (!folder.ok) throw new Error("folder");

    // First run: die after two chunks.
    const session = await c.createResumableSession({
      filename: "final_video.mp4",
      parentId: folder.value,
      mimeType: "video/mp4",
      sizeBytes: total,
      jobId: "job-1",
      kind: "final_video",
    });
    if (!session.ok) throw new Error("session");
    await c.uploadChunk({
      sessionUri: session.value,
      localPath: path,
      start: 0,
      end: 256 * 1024 - 1,
      totalBytes: total,
    });
    await c.uploadChunk({
      sessionUri: session.value,
      localPath: path,
      start: 256 * 1024,
      end: 256 * 1024 * 2 - 1,
      totalBytes: total,
    });

    const before = drive.requests.filter((r) =>
      r.url.includes("resumable-session"),
    ).length;

    // Second run: hand it the persisted session URI.
    const result = await resumableUpload(
      c,
      {
        localPath: path,
        totalBytes: total,
        sessionUri: session.value,
        filename: "final_video.mp4",
        parentId: folder.value,
        mimeType: "video/mp4",
        jobId: "job-1",
        kind: "final_video",
        chunkSizeBytes: 256 * 1024,
      },
      BACKOFF,
      NO_WAIT,
    );

    expect(result.ok).toBe(true);
    // Only the offset query + the 2 remaining chunks - not 4 more chunks.
    const after = drive.requests.filter((r) =>
      r.url.includes("resumable-session"),
    ).length;
    expect(after - before).toBe(3);
  });

  it("starts a fresh session when the persisted one has expired (404)", async () => {
    const total = 256 * 1024 * 2;
    const path = await makeFile("video.mp4", total);
    const c = client(drive);
    const folder = await c.ensureFolder("Chan", null);
    if (!folder.ok) throw new Error("folder");

    const result = await resumableUpload(
      c,
      {
        localPath: path,
        totalBytes: total,
        sessionUri: "https://www.googleapis.com/resumable-session/long-gone",
        filename: "final_video.mp4",
        parentId: folder.value,
        mimeType: "video/mp4",
        jobId: "job-1",
        kind: "final_video",
        chunkSizeBytes: 256 * 1024,
      },
      BACKOFF,
      NO_WAIT,
    );

    expect(result.ok).toBe(true);
  });

  it("recovers when the last chunk landed but we never saw the response", async () => {
    const total = 256 * 1024;
    const path = await makeFile("video.mp4", total);
    const c = client(drive);
    const folder = await c.ensureFolder("Chan", null);
    if (!folder.ok) throw new Error("folder");

    const session = await c.createResumableSession({
      filename: "final_video.mp4",
      parentId: folder.value,
      mimeType: "video/mp4",
      sizeBytes: total,
      jobId: "job-1",
      kind: "final_video",
    });
    if (!session.ok) throw new Error("session");
    await c.uploadChunk({
      sessionUri: session.value,
      localPath: path,
      start: 0,
      end: total - 1,
      totalBytes: total,
    });
    const filesBefore = drive.files.size;

    // Resume the "completed" session: must NOT re-upload.
    const result = await resumableUpload(
      c,
      {
        localPath: path,
        totalBytes: total,
        sessionUri: session.value,
        filename: "final_video.mp4",
        parentId: folder.value,
        mimeType: "video/mp4",
        jobId: "job-1",
        kind: "final_video",
        chunkSizeBytes: 256 * 1024,
      },
      BACKOFF,
      NO_WAIT,
    );

    expect(result.ok).toBe(true);
    expect(drive.files.size).toBe(filesBefore);
  });

  it("refuses a 0-byte file rather than creating an empty Drive object", async () => {
    const path = await makeFile("empty.mp4", 0);
    const c = client(drive);
    const result = await resumableUpload(
      c,
      {
        localPath: path,
        totalBytes: 0,
        filename: "final_video.mp4",
        parentId: "folder",
        mimeType: "video/mp4",
        jobId: "job-1",
        kind: "final_video",
        chunkSizeBytes: 256 * 1024,
      },
      BACKOFF,
      NO_WAIT,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("local_file");
    expect(drive.sessions.size).toBe(0);
  });

  it("retries a throttled chunk and completes without corrupting the file", async () => {
    const total = 256 * 1024 * 2;
    const path = await makeFile("video.mp4", total);
    const c = client(drive);
    const folder = await c.ensureFolder("Chan", null);
    if (!folder.ok) throw new Error("folder");

    drive.failNext({
      urlIncludes: "resumable-session",
      status: 429,
      body: rateLimitBody(),
      times: 1,
    });

    const result = await resumableUpload(
      c,
      {
        localPath: path,
        totalBytes: total,
        filename: "final_video.mp4",
        parentId: folder.value,
        mimeType: "video/mp4",
        jobId: "job-1",
        kind: "final_video",
        chunkSizeBytes: 256 * 1024,
      },
      BACKOFF,
      NO_WAIT,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(Number(result.value.size)).toBe(total);
  });

  it("never reports success when the transfer never completed", async () => {
    const total = 256 * 1024 * 2;
    const path = await makeFile("video.mp4", total);
    const c = client(drive);
    const folder = await c.ensureFolder("Chan", null);
    if (!folder.ok) throw new Error("folder");

    drive.failNext({
      urlIncludes: "resumable-session",
      status: 500,
      body: "{}",
      times: 999,
    });

    const result = await resumableUpload(
      c,
      {
        localPath: path,
        totalBytes: total,
        filename: "final_video.mp4",
        parentId: folder.value,
        mimeType: "video/mp4",
        jobId: "job-1",
        kind: "final_video",
        chunkSizeBytes: 256 * 1024,
      },
      { ...BACKOFF, maxAttempts: 2 },
      NO_WAIT,
    );

    expect(result.ok).toBe(false);
  });
});
