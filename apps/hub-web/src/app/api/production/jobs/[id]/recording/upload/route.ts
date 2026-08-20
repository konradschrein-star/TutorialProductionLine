import { NextRequest, NextResponse } from "next/server";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  stat,
  unlink,
  rename,
  readFile,
  writeFile,
} from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join, extname } from "node:path";
import { createHash } from "node:crypto";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getTutorialJobById, type TutorialJob } from "@repo/db";
import { publishRecording } from "@/lib/production/publish-recording";

export const dynamic = "force-dynamic";
// Per CHUNK, not per file — the whole point of this route is that no single
// request has to carry a multi-gigabyte recording.
export const maxDuration = 300;

const ALLOWED_EXTENSIONS = [".mp4", ".mov", ".mkv", ".webm"];
const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10GB
// Chunk size the client is told to use. 8 MiB ≈ 1s on a 64 Mbit uplink.
// NOTE: not exported — Next.js rejects unknown exports from a route module.
const CHUNK_SIZE = 8 * 1024 * 1024;
/** Hard ceiling on a single PATCH body, so a bad client cannot buffer the box. */
const MAX_CHUNK_BYTES = 64 * 1024 * 1024;

/**
 * Resumable, chunked recording upload.
 *
 *   POST   ?           {fileName,fileSize,lastModified}  → begin/resume session
 *   PATCH  ?uploadId&offset[&final=1]  <raw bytes>       → append one chunk
 *   DELETE ?uploadId                                     → abandon a session
 *
 * Bytes land in `<media>/tutorial/<jobId>/.uploads/<uploadId>.part` and are only
 * renamed to `recording<ext>` once the LAST chunk has been written AND its write
 * stream has closed AND the on-disk size matches the size the client declared.
 * `recording_path` is published (and the splice enqueued) after that rename, by
 * the shared publishRecording() helper — which is the invariant 69d6229e
 * established: the splice worker must never ffprobe a partially assembled file.
 *
 * Idempotency:
 *   - uploadId is derived deterministically from (jobId, fileName, fileSize,
 *     lastModified), so a page reload or a dropped connection resumes into the
 *     same .part file instead of starting a second one.
 *   - PATCH is offset-addressed. Re-sending a chunk that is already on disk is
 *     a no-op; sending one past the end is a 409 carrying the expected offset.
 *   - Finalize is guarded by an atomic rename(): only one caller can win, so a
 *     duplicate finalize cannot enqueue a second splice.
 */

// ── Per-upload serialization ────────────────────────────────────────────────
// Appends must not interleave. The client is strictly sequential, but a
// retried request whose response was lost can arrive while the original is
// still writing; without this the two appends would corrupt the file.
const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(key, gate);
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === gate) locks.delete(key);
  }
}

interface UploadMeta {
  jobId: string;
  fileName: string;
  fileSize: number;
  ext: string;
  createdAt: string;
}

type Authorized =
  | { ok: true; job: TutorialJob }
  | { ok: false; response: NextResponse };

async function authorize(id: string): Promise<Authorized> {
  const session = await getSession();
  if (!session || !hasPermission(session, "create:tutorial-job")) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  const job = await getTutorialJobById(db, id);
  if (!job) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not found" }, { status: 404 }),
    };
  }

  const isOwner = job.created_by === session.userId;
  const isPrivileged =
    hasPermission(session, "manage:tutorial-settings") ||
    session.role === "ADMIN" ||
    session.role === "MANAGER";

  if (!isOwner && !isPrivileged) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, job };
}

function mediaRoot(): string {
  return process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";
}

function uploadsDir(jobId: string): string {
  return join(mediaRoot(), "tutorial", jobId, ".uploads");
}

function partPath(jobId: string, uploadId: string): string {
  return join(uploadsDir(jobId), `${uploadId}.part`);
}

function metaPath(jobId: string, uploadId: string): string {
  return join(uploadsDir(jobId), `${uploadId}.json`);
}

/** Reject anything that is not one of our own hex ids — this value is a path segment. */
function isValidUploadId(v: string | null): v is string {
  return typeof v === "string" && /^[a-f0-9]{32}$/.test(v);
}

async function sizeOrZero(path: string): Promise<number> {
  try {
    const s = await stat(path);
    return s.size;
  } catch {
    return 0;
  }
}

async function readMeta(
  jobId: string,
  uploadId: string,
): Promise<UploadMeta | null> {
  try {
    const raw = await readFile(metaPath(jobId, uploadId), "utf8");
    return JSON.parse(raw) as UploadMeta;
  } catch {
    return null;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── POST: begin or resume a session ─────────────────────────────────────────

interface BeginBody {
  fileName?: unknown;
  fileSize?: unknown;
  lastModified?: unknown;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authorize(id);
  if (!auth.ok) return auth.response;

  let body: BeginBody;
  try {
    body = (await request.json()) as BeginBody;
  } catch {
    return NextResponse.json(
      { error: "Body must be JSON: {fileName, fileSize, lastModified}" },
      { status: 400 },
    );
  }

  const fileName = typeof body.fileName === "string" ? body.fileName : "";
  const fileSize = Number(body.fileSize);
  const lastModified = Number(body.lastModified ?? 0);

  const ext = extname(fileName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return NextResponse.json(
      {
        error: `Invalid file extension: ${ext || "(none)"}. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`,
      },
      { status: 400 },
    );
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return NextResponse.json(
      { error: `Invalid fileSize: ${String(body.fileSize)}` },
      { status: 400 },
    );
  }
  if (fileSize > MAX_FILE_SIZE) {
    return NextResponse.json(
      {
        error: `File too large: ${Math.round(fileSize / 1024 / 1024)}MB (max 10GB)`,
      },
      { status: 413 },
    );
  }

  const uploadId = createHash("sha256")
    .update(`${id}:${fileName}:${fileSize}:${lastModified}`)
    .digest("hex")
    .slice(0, 32);

  try {
    await mkdir(uploadsDir(id), { recursive: true });

    return await withLock(uploadId, async () => {
      let receivedBytes = await sizeOrZero(partPath(id, uploadId));

      if (receivedBytes > fileSize) {
        // A leftover partial that is longer than the file it claims to be can
        // only be junk. Say so loudly and start over rather than assembling a
        // file we know is wrong.
        console.warn(
          `[recording-upload] discarding corrupt partial for job ${id}: ${receivedBytes} bytes on disk > declared ${fileSize}`,
        );
        await unlink(partPath(id, uploadId)).catch(() => {});
        receivedBytes = 0;
      }

      const meta: UploadMeta = {
        jobId: id,
        fileName,
        fileSize,
        ext,
        createdAt: new Date().toISOString(),
      };
      await writeFile(metaPath(id, uploadId), JSON.stringify(meta), "utf8");

      return NextResponse.json({
        uploadId,
        receivedBytes,
        chunkSize: CHUNK_SIZE,
        maxFileSize: MAX_FILE_SIZE,
        resumed: receivedBytes > 0,
      });
    });
  } catch (err) {
    console.error("[recording-upload] begin failed", {
      jobId: id,
      error: errorMessage(err),
    });
    return NextResponse.json(
      { error: `Could not start upload: ${errorMessage(err)}` },
      { status: 500 },
    );
  }
}

// ── PATCH: append one chunk (and finalize on the last one) ──────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authorize(id);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const uploadId = url.searchParams.get("uploadId");
  const offset = Number(url.searchParams.get("offset"));
  const isFinal = url.searchParams.get("final") === "1";

  if (!isValidUploadId(uploadId)) {
    return NextResponse.json(
      { error: "Missing or malformed uploadId" },
      { status: 400 },
    );
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return NextResponse.json(
      {
        error: `Missing or malformed offset: ${url.searchParams.get("offset")}`,
      },
      { status: 400 },
    );
  }

  const meta = await readMeta(id, uploadId);
  if (!meta) {
    // The session was never begun, or was cleaned up. The client must POST
    // again to re-establish it — do NOT invent one, or we would happily
    // assemble bytes we cannot size-check.
    return NextResponse.json(
      {
        error:
          "Upload session not found. It may have been finalized or cleaned up — start the upload again.",
        restart: true,
      },
      { status: 410 },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_CHUNK_BYTES) {
    return NextResponse.json(
      {
        error: `Chunk too large: ${declaredLength} bytes (max ${MAX_CHUNK_BYTES}).`,
      },
      { status: 413 },
    );
  }
  if (!request.body) {
    return NextResponse.json({ error: "Chunk body is empty" }, { status: 400 });
  }

  try {
    return await withLock(uploadId, async () => {
      const part = partPath(id, uploadId);
      const currentSize = await sizeOrZero(part);

      // ── Duplicate chunk (a retry whose original actually landed) ──────────
      if (offset < currentSize) {
        const end = offset + declaredLength;
        if (declaredLength > 0 && end > currentSize) {
          // Straddles the end of what we have — we cannot append it without
          // duplicating bytes, and we cannot skip it without losing bytes.
          return NextResponse.json(
            {
              error: `Chunk at offset ${offset} overlaps the end of the assembled file (${currentSize} bytes). Resume from the expected offset.`,
              expectedOffset: currentSize,
            },
            { status: 409 },
          );
        }
        // Fully contained in what we already have → drain and no-op.
        await request.body!.cancel().catch(() => {});
        if (isFinal && currentSize === meta.fileSize) {
          return await finalize(auth.job, id, uploadId, meta);
        }
        return NextResponse.json({
          receivedBytes: currentSize,
          duplicate: true,
        });
      }

      // ── Gap: the client is ahead of the server ────────────────────────────
      if (offset > currentSize) {
        await request.body!.cancel().catch(() => {});
        return NextResponse.json(
          {
            error: `Out-of-order chunk: got offset ${offset}, expected ${currentSize}.`,
            expectedOffset: currentSize,
          },
          { status: 409 },
        );
      }

      // ── Normal append ─────────────────────────────────────────────────────
      if (currentSize + declaredLength > meta.fileSize) {
        await request.body!.cancel().catch(() => {});
        return NextResponse.json(
          {
            error: `Chunk would overrun the declared file size (${currentSize} + ${declaredLength} > ${meta.fileSize}).`,
            expectedOffset: currentSize,
          },
          { status: 409 },
        );
      }

      const nodeStream = Readable.fromWeb(
        request.body as unknown as Parameters<typeof Readable.fromWeb>[0],
      );
      const writeStream = createWriteStream(part, { flags: "a" });
      // pipeline() resolves only after the destination has flushed AND closed
      // — the same guarantee 69d6229e added to the single-shot route.
      await pipeline(nodeStream, writeStream);

      const newSize = await sizeOrZero(part);
      if (newSize !== currentSize + declaredLength && declaredLength > 0) {
        // The transfer was cut short. Report the truth; the client resumes
        // from whatever actually landed.
        return NextResponse.json(
          {
            error: `Chunk truncated in transit: expected ${declaredLength} bytes, ${newSize - currentSize} landed.`,
            expectedOffset: newSize,
          },
          { status: 409 },
        );
      }

      if (isFinal) {
        if (newSize !== meta.fileSize) {
          return NextResponse.json(
            {
              error: `Final chunk received but the assembled file is ${newSize} bytes, expected ${meta.fileSize}. Nothing was published.`,
              expectedOffset: newSize,
            },
            { status: 409 },
          );
        }
        return await finalize(auth.job, id, uploadId, meta);
      }

      return NextResponse.json({ receivedBytes: newSize });
    });
  } catch (err) {
    const msg = errorMessage(err);
    console.error("[recording-upload] chunk failed", {
      jobId: id,
      uploadId,
      offset,
      error: msg,
    });
    const userFacing = msg.includes("ENOSPC")
      ? "Server storage is full. Please contact an administrator — your upload is paused, not lost."
      : `Chunk write failed: ${msg}`;
    return NextResponse.json({ error: userFacing }, { status: 500 });
  }
}

/**
 * Promote a fully-assembled .part to the real recording and publish it.
 *
 * The rename() is the concurrency guard: it is atomic within a filesystem, so
 * of two racing finalizes exactly one moves the file and the other observes
 * ENOENT and reports the already-finalized state WITHOUT re-publishing. That
 * is what makes "resume the same upload twice" incapable of enqueuing two
 * splice jobs.
 */
async function finalize(
  job: TutorialJob,
  jobId: string,
  uploadId: string,
  meta: UploadMeta,
): Promise<NextResponse> {
  const part = partPath(jobId, uploadId);
  const finalPath = join(
    mediaRoot(),
    "tutorial",
    jobId,
    `recording${meta.ext}`,
  );

  let renamedHere = false;
  const partSize = await sizeOrZero(part);
  if (partSize === meta.fileSize) {
    try {
      await rename(part, finalPath);
      renamedHere = true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
      // Someone else already moved it. Fall through to the verification below.
    }
  }

  const finalSize = await sizeOrZero(finalPath);
  if (finalSize !== meta.fileSize) {
    throw new Error(
      `Assembled recording is ${finalSize} bytes but ${meta.fileSize} were declared (${finalPath}). Refusing to publish a partial file.`,
    );
  }

  // We did NOT move the file in this call and the job already points at it →
  // a previous finalize won the race. Do not publish or enqueue a second time.
  //
  // `renamedHere` is what makes this precise. Checking only
  // `job.recording_path === finalPath` would silently swallow a legitimate
  // RE-take: the VA's second recording overwrites recording.mp4 at the same
  // path, so the paths match even though this is genuinely new footage that
  // must be spliced.
  if (!renamedHere && job.recording_path === finalPath) {
    await unlink(metaPath(jobId, uploadId)).catch(() => {});
    return NextResponse.json({
      complete: true,
      alreadyFinalized: true,
      recording_path: finalPath,
      size: finalSize,
      receivedBytes: finalSize,
    });
  }

  const result = await publishRecording(db, job, finalPath);
  await unlink(metaPath(jobId, uploadId)).catch(() => {});
  await unlink(part).catch(() => {});

  console.warn(
    `[recording-upload] finalized job ${jobId}: ${finalPath} (${finalSize} bytes, splice ${result.enqueued ? "enqueued" : `not enqueued — ${result.note ?? "n/a"}`})`,
  );

  return NextResponse.json({
    complete: true,
    recording_path: finalPath,
    size: finalSize,
    receivedBytes: finalSize,
    spliceEnqueued: result.enqueued,
    ...(result.note ? { note: result.note } : {}),
  });
}

// ── DELETE: abandon a session ───────────────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authorize(id);
  if (!auth.ok) return auth.response;

  const uploadId = new URL(request.url).searchParams.get("uploadId");
  if (!isValidUploadId(uploadId)) {
    return NextResponse.json(
      { error: "Missing or malformed uploadId" },
      { status: 400 },
    );
  }

  await withLock(uploadId, async () => {
    await unlink(partPath(id, uploadId)).catch(() => {});
    await unlink(metaPath(id, uploadId)).catch(() => {});
  });

  return NextResponse.json({ success: true });
}
