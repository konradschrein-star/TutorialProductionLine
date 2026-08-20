import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, unlink } from "node:fs/promises";
import { join, extname } from "node:path";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { probeMedia } from "@repo/media-core";
import Busboy from "busboy";
import { Readable } from "stream";

export const maxDuration = 300; // 5 minutes
export const dynamic = "force-dynamic";

// Allowed file extensions for uploads
const ALLOWED_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".mp3",
  ".wav",
  ".ogg",
  ".opus",
  ".m4a",
  ".flac",
];

// Maximum file size (10GB)
const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10GB

/**
 * POST /api/video-stitch/upload
 *
 * Upload a video or audio file for video stitcher using streaming.
 * This bypasses Next.js's 10MB body limit by streaming directly to disk.
 *
 * FormData fields:
 *   - file: File (required) — video or audio file
 *
 * Returns:
 *   - upload_id: Unique identifier for this upload
 *   - filename: Original filename
 *   - duration_seconds: Duration in seconds
 *   - width: Video width (0 for audio)
 *   - height: Video height (0 for audio)
 *   - fps: Frames per second (0 for audio)
 *   - recorded_at: Recorded timestamp (if available)
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "create:job")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
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
  const uploadId = randomUUID();
  const uploadDir = join(mediaRoot, "stitch-uploads", uploadId);

  let uploadedFilePath: string | null = null;
  let uploadedFileName: string | null = null;
  let uploadedFileSize = 0;
  let lastModifiedField: string | undefined;

  try {
    // Create upload directory
    await mkdir(uploadDir, { recursive: true });

    // Convert Web Streams API to Node.js stream
    const nodeStream = Readable.fromWeb(request.body as any);

    // Parse multipart form data with busboy
    const busboy = Busboy({ headers: { "content-type": contentType } });

    const parsePromise = new Promise<void>((resolve, reject) => {
      busboy.on("file", (fieldname, file, info) => {
        const { filename } = info;

        if (fieldname !== "file") {
          file.resume(); // Drain the stream
          return;
        }

        // Validate file extension
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

        uploadedFileName = filename;
        uploadedFilePath = join(uploadDir, `original${ext}`);

        const writeStream = createWriteStream(uploadedFilePath);

        // Track file size
        file.on("data", (chunk) => {
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

        file.on("error", (err) => {
          writeStream.destroy();
          reject(err);
        });

        writeStream.on("error", (err) => {
          file.destroy();
          reject(err);
        });

        writeStream.on("finish", () => {
          console.warn(`File uploaded successfully: ${uploadedFileName}`);
        });

        file.pipe(writeStream);
      });

      busboy.on("field", (fieldname, value) => {
        if (fieldname === "lastModified") {
          lastModifiedField = value;
        }
      });

      busboy.on("error", (err) => {
        reject(err);
      });

      busboy.on("finish", () => {
        resolve();
      });
    });

    // Pipe request to busboy
    nodeStream.pipe(busboy);

    // Wait for upload to complete
    await parsePromise;

    // Validate that a file was uploaded
    if (!uploadedFilePath || !uploadedFileName) {
      throw new Error("No file provided");
    }

    // Extract metadata using probeMedia
    const metadata = await probeMedia(uploadedFilePath);

    // Get file timestamp - prefer client-provided lastModified, fallback to server filesystem
    let recordedAt: string;
    const lastModifiedFromClient = lastModifiedField;
    if (lastModifiedFromClient && typeof lastModifiedFromClient === "string") {
      // Use timestamp from browser (original file's lastModified)
      const timestamp = parseInt(lastModifiedFromClient, 10);
      recordedAt = new Date(timestamp).toISOString();
    } else {
      // Fallback: use filesystem metadata from server
      const { stat } = await import("node:fs/promises");
      const fileStats = await stat(uploadedFilePath);
      recordedAt = (fileStats.birthtime || fileStats.mtime).toISOString();
    }

    return NextResponse.json({
      upload_id: uploadId,
      filename: uploadedFileName,
      duration_seconds: metadata.durationSeconds,
      width: metadata.video?.width ?? 0,
      height: metadata.video?.height ?? 0,
      fps: metadata.video?.fps ?? 0,
      recorded_at: recordedAt,
    });
  } catch (err) {
    // Cleanup uploaded files on failure
    try {
      if (uploadedFilePath) {
        await unlink(uploadedFilePath).catch(() => {});
      }
      await rm(uploadDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.error("Failed to cleanup upload directory", {
        uploadDir,
        error:
          cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
      });
    }

    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Upload failed", {
      error: errorMessage,
      stack: err instanceof Error ? err.stack : undefined,
      uploadId,
      userId: session.userId,
      filename: uploadedFileName,
      uploadedSize: uploadedFileSize,
    });

    // Return helpful error message based on the failure type
    let userFacingError = "Failed to process upload";
    if (errorMessage.includes("too large")) {
      userFacingError = errorMessage; // Already user-friendly
    } else if (errorMessage.includes("Invalid file extension")) {
      userFacingError = errorMessage; // Already user-friendly
    } else if (errorMessage.includes("No file provided")) {
      userFacingError =
        "No file was uploaded. Please select a file and try again.";
    } else if (errorMessage.includes("ENOSPC")) {
      userFacingError = "Server storage is full. Please contact administrator.";
    } else if (
      errorMessage.includes("Invalid data found") ||
      errorMessage.includes("probe")
    ) {
      userFacingError =
        "Invalid or corrupted media file. Please try a different file.";
    } else if (
      errorMessage.includes("EACCES") ||
      errorMessage.includes("EPERM")
    ) {
      userFacingError =
        "Server permission error. Please contact administrator.";
    } else {
      userFacingError = `Upload error: ${errorMessage}`;
    }

    return NextResponse.json({ error: userFacingError }, { status: 500 });
  }
}
