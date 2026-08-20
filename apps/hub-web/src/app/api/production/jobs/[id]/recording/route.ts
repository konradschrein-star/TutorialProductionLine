import { NextRequest, NextResponse } from "next/server";
import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { join, extname } from "node:path";
import Busboy from "busboy";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getTutorialJobById, updateTutorialJob } from "@repo/db";
import { publishRecording } from "@/lib/production/publish-recording";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes

const ALLOWED_EXTENSIONS = [".mp4", ".mov", ".mkv", ".webm"];
const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10GB

/**
 * POST /api/production/jobs/[id]/recording
 *
 * Single-shot multipart upload of a screen recording, using Busboy streaming.
 * Writes to ${LOCAL_MEDIA_ROOT}/tutorial/<jobId>/recording<ext>, then hands off
 * to publishRecording() which sets AWAITING_UPLOAD and enqueues the splice.
 *
 * NOTE: the Tutorial Studio no longer uses this path. It uploads through
 * ./upload (chunked + resumable + backgrounded) so a VA never has to sit and
 * watch a 1 GB POST that loses the whole take if it dies at 90%. This handler
 * is kept as a working fallback for any caller that still posts a whole file
 * in one request — and because a 5-minute maxDuration on a multi-gigabyte
 * upload is exactly the failure the chunked route exists to remove.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission(session, "create:tutorial-job")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const job = await getTutorialJobById(db, id);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = job.created_by === session.userId;
  const isPrivileged =
    hasPermission(session, "manage:tutorial-settings") ||
    session.role === "ADMIN" ||
    session.role === "MANAGER";

  if (!isOwner && !isPrivileged) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const contentType = request.headers.get("content-type");
  if (!contentType || !contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Content-Type must be multipart/form-data" },
      { status: 400 },
    );
  }

  const mediaRoot =
    process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";
  const jobDir = join(mediaRoot, "tutorial", id);

  let uploadedFilePath: string | null = null;
  let uploadedFileSize = 0;

  try {
    await mkdir(jobDir, { recursive: true });

    const busboy = Busboy({ headers: { "content-type": contentType } });

    // Resolves only once the destination file is fully flushed AND its fd is
    // closed on disk.
    //
    // busboy's "finish" fires when the multipart parser is done — NOT when the
    // fs write stream it was piped into has drained. Enqueuing the splice job
    // at that point makes the worker ffprobe a half-written MP4 whose moov
    // atom has not landed yet. In production this failed the FIRST attempt of
    // 113 out of 113 splice jobs ("Command failed: ffprobe ..."), flipped the
    // job to FAILED_SPLICE, and only succeeded on the BullMQ retry ~5s later.
    let fileClosed: Promise<void> = Promise.resolve();

    const parsePromise = new Promise<void>((resolve, reject) => {
      busboy.on("file", (fieldname, file, info) => {
        const { filename } = info;

        if (fieldname !== "file") {
          file.resume();
          return;
        }

        const ext = extname(filename).toLowerCase();
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
          file.resume();
          reject(
            new Error(
              `Invalid file extension: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`,
            ),
          );
          return;
        }

        uploadedFilePath = join(jobDir, `recording${ext}`);
        const writeStream = createWriteStream(uploadedFilePath);
        fileClosed = new Promise<void>((res, rej) => {
          writeStream.on("close", () => res());
          writeStream.on("error", rej);
        });
        // parsePromise surfaces the same error; this keeps the rejection from
        // going unhandled when we bail out before awaiting fileClosed.
        void fileClosed.catch(() => {});

        file.on("data", (chunk: Buffer) => {
          uploadedFileSize += chunk.length;
          if (uploadedFileSize > MAX_FILE_SIZE) {
            file.destroy();
            writeStream.destroy();
            reject(
              new Error(
                `File too large: ${Math.round(uploadedFileSize / 1024 / 1024)}MB (max 10GB)`,
              ),
            );
          }
        });

        file.on("error", (err: Error) => {
          writeStream.destroy();
          reject(err);
        });

        writeStream.on("error", (err: Error) => {
          file.destroy();
          reject(err);
        });

        writeStream.on("finish", () => {
          console.warn(`[recording-upload] File saved: ${uploadedFilePath}`);
        });

        file.pipe(writeStream);
      });

      busboy.on("error", (err: Error) => {
        reject(err);
      });

      busboy.on("finish", () => {
        resolve();
      });
    });

    // Manually pump the Web ReadableStream into busboy — avoids the
    // "Unexpected end of form" bug that Readable.fromWeb().pipe() triggers
    // in some Node.js versions with Next.js App Router.
    const reader = request.body!.getReader();
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            busboy.end();
            break;
          }
          busboy.write(value);
        }
      } catch (err) {
        busboy.destroy(err as Error);
      }
    })();
    await parsePromise;
    // Must complete before recording_path is published or the splice job is
    // enqueued — see the fileClosed comment above.
    await fileClosed;

    if (!uploadedFilePath) {
      throw new Error("No file provided");
    }

    // Publishing (recording_path + splice enqueue) is shared with the chunked
    // uploader so both paths obey the same invariant and the same idempotent
    // enqueue. It runs only after `await fileClosed` above.
    const published = await publishRecording(db, job, uploadedFilePath);

    return NextResponse.json({
      success: true,
      recording_path: uploadedFilePath,
      size: published.size,
      spliceEnqueued: published.enqueued,
      ...(published.note ? { note: published.note } : {}),
    });
  } catch (err) {
    // Cleanup on failure
    try {
      if (uploadedFilePath) {
        await unlink(uploadedFilePath).catch(() => {});
      }
    } catch (cleanupErr) {
      console.error("Failed to cleanup recording file", cleanupErr);
    }

    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Recording upload failed", {
      error: errorMessage,
      jobId: id,
      userId: session.userId,
    });

    let userFacingError = "Failed to process upload";
    if (errorMessage.includes("too large")) {
      userFacingError = errorMessage;
    } else if (errorMessage.includes("Invalid file extension")) {
      userFacingError = errorMessage;
    } else if (errorMessage.includes("No file provided")) {
      userFacingError =
        "No file was uploaded. Please select a file and try again.";
    } else if (errorMessage.includes("ENOSPC")) {
      userFacingError = "Server storage is full. Please contact administrator.";
    } else {
      userFacingError = `Upload error: ${errorMessage}`;
    }

    return NextResponse.json({ error: userFacingError }, { status: 500 });
  }
}

const VIDEO_CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
};

/**
 * GET /api/production/jobs/[id]/recording
 *
 * Stream the uploaded recording (recording_path) so the Studio can show an
 * inline preview. Supports Range requests for in-browser seeking.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const job = await getTutorialJobById(db, id);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = job.created_by === session.userId;
  const isPrivileged =
    hasPermission(session, "manage:tutorial-settings") ||
    session.role === "ADMIN" ||
    session.role === "MANAGER";
  if (!isOwner && !isPrivileged) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!job.recording_path) {
    return NextResponse.json(
      { error: "No recording uploaded" },
      { status: 404 },
    );
  }

  const contentType =
    VIDEO_CONTENT_TYPES[extname(job.recording_path).toLowerCase()] ??
    "video/mp4";

  try {
    const fileStats = await stat(job.recording_path);
    const fileSize = fileStats.size;
    const rangeHeader = req.headers.get("range");

    if (rangeHeader) {
      // Stream the requested byte range straight off disk. Recordings can be up
      // to MAX_FILE_SIZE (10 GB); the previous Buffer.allocUnsafe(chunkSize)
      // allocated the ENTIRE file when the browser opened with `Range: bytes=0-`
      // (chunkSize === fileSize), OOM-ing hub-web for all users.
      const [startStr, endStr] = rangeHeader.replace("bytes=", "").split("-");
      const start = parseInt(startStr ?? "0", 10);
      const end = endStr
        ? Math.min(parseInt(endStr, 10), fileSize - 1)
        : fileSize - 1;

      if (Number.isNaN(start) || start >= fileSize || start > end) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${fileSize}` },
        });
      }

      const nodeStream = createReadStream(job.recording_path, { start, end });
      return new NextResponse(
        Readable.toWeb(nodeStream) as unknown as ReadableStream,
        {
          status: 206,
          headers: {
            "Content-Type": contentType,
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": (end - start + 1).toString(),
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const nodeStream = createReadStream(job.recording_path);
    return new NextResponse(
      Readable.toWeb(nodeStream) as unknown as ReadableStream,
      {
        headers: {
          "Content-Type": contentType,
          "Content-Length": fileSize.toString(),
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (err) {
    console.error("Failed to serve recording", err);
    return NextResponse.json(
      { error: "Failed to read recording file" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/production/jobs/[id]/recording
 *
 * Remove an uploaded recording: delete the file, clear recording_path, and
 * send the job back to READY_TO_RECORD. For a LONG_FORM part, demote the parent
 * out of READY_TO_STITCH since it is no longer fully recorded.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission(session, "create:tutorial-job")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const job = await getTutorialJobById(db, id);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = job.created_by === session.userId;
  const isPrivileged =
    hasPermission(session, "manage:tutorial-settings") ||
    session.role === "ADMIN" ||
    session.role === "MANAGER";
  if (!isOwner && !isPrivileged) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (job.recording_path) {
    await unlink(job.recording_path).catch(() => {});
  }

  await updateTutorialJob(db, id, {
    recording_path: null,
    recorded_at: null,
    status: "READY_TO_RECORD",
  });

  if (job.mode === "LONG_FORM" && job.parent_job_id) {
    const parent = await getTutorialJobById(db, job.parent_job_id);
    if (parent && parent.status === "READY_TO_STITCH") {
      await updateTutorialJob(db, job.parent_job_id, {
        status: "AWAITING_RECORDINGS",
      });
    }
  }

  return NextResponse.json({ success: true });
}
