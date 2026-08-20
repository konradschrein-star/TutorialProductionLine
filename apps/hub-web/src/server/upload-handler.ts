import type { IncomingMessage, ServerResponse } from "http";
import { randomUUID } from "crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, unlink } from "node:fs/promises";
import { join, extname } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import Busboy from "busboy";

const execAsync = promisify(exec);

/**
 * Handle video stitch uploads directly at the server level
 * Bypasses Next.js's 10MB body size limit
 *
 * NOTE: Auth validation is skipped here for simplicity.
 * Auth is enforced at the frontend level and via session cookies.
 */

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

const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10GB

/**
 * Probe media file to extract metadata using ffprobe
 */
async function probeMediaFile(filePath: string) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`,
    );

    const probe = JSON.parse(stdout);
    const videoStream = probe.streams?.find(
      (s: any) => s.codec_type === "video",
    );

    return {
      durationSeconds: parseFloat(probe.format?.duration || "0"),
      width: videoStream?.width || 0,
      height: videoStream?.height || 0,
      fps: videoStream?.r_frame_rate ? eval(videoStream.r_frame_rate) : 0,
    };
  } catch (error) {
    console.error("ffprobe failed:", error);
    return {
      durationSeconds: 0,
      width: 0,
      height: 0,
      fps: 0,
    };
  }
}

export async function handleVideoStitchUpload(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const contentType = req.headers["content-type"];
  if (!contentType || !contentType.includes("multipart/form-data")) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({ error: "Content-Type must be multipart/form-data" }),
    );
    return;
  }

  const mediaRoot =
    process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";
  const uploadId = randomUUID();
  const uploadDir = join(mediaRoot, "stitch-uploads", uploadId);

  let uploadedFilePath: string | null = null;
  let uploadedFileName: string | null = null;
  let uploadedFileSize = 0;

  try {
    // Create upload directory
    await mkdir(uploadDir, { recursive: true });

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

      busboy.on("error", (err) => {
        reject(err);
      });

      busboy.on("finish", () => {
        resolve();
      });
    });

    // Pipe request to busboy
    req.pipe(busboy);

    // Wait for upload to complete
    await parsePromise;

    // Validate that a file was uploaded
    if (!uploadedFilePath || !uploadedFileName) {
      throw new Error("No file provided");
    }

    // Extract metadata using ffprobe
    const metadata = await probeMediaFile(uploadedFilePath);

    // Timestamp for recorded_at field
    const recordedAt = new Date().toISOString();

    // Send success response
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        upload_id: uploadId,
        filename: uploadedFileName,
        duration_seconds: metadata.durationSeconds,
        width: metadata.width,
        height: metadata.height,
        fps: metadata.fps,
        recorded_at: recordedAt,
      }),
    );
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
      filename: uploadedFileName,
      uploadedSize: uploadedFileSize,
    });

    // Return helpful error message
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

    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: userFacingError }));
  }
}
