import { writeFile, readFile, unlink, mkdir } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

/**
 * ⚠️ NAMING ALERT: Despite "R2" in function names, this module uses LOCAL FILESYSTEM ONLY.
 *
 * Local Storage Utilities (formerly R2 client)
 *
 * Previously this module wrapped Cloudflare R2 using the AWS S3 SDK.
 * All asset storage now happens on the local VPS filesystem under LOCAL_MEDIA_ROOT.
 *
 * The exported function signatures are preserved for call-site compatibility.
 * All R2-specific arguments (client, bucket) are accepted but ignored.
 *
 * DO NOT attempt to configure R2 credentials - they are not used.
 *
 * Path Handling:
 * All paths are normalized using node:path to ensure cross-platform compatibility.
 * This prevents mixed separator bugs (/, \) on Windows.
 */

/** @deprecated Pass null — kept for call-site compatibility */
export function createR2Client(_config: unknown): null {
  return null;
}

/**
 * Write a buffer to a local file path (formerly uploaded to R2).
 *
 * @param _client - Ignored (previously S3Client)
 * @param _bucket - Ignored (previously bucket name)
 * @param key - Destination file path (absolute) - will be normalized
 * @param body - File content buffer
 * @param _contentType - Ignored (filesystem needs no content type)
 */
export async function uploadToR2(
  _client: unknown,
  _bucket: string,
  key: string,
  body: Buffer,
  _contentType: string,
): Promise<void> {
  // Normalize path to handle mixed separators on Windows
  const normalizedKey = normalize(key);

  await mkdir(dirname(normalizedKey), { recursive: true });
  await writeFile(normalizedKey, body);

  console.log(
    JSON.stringify({
      level: "info",
      message: "Saved file to local storage",
      key: normalizedKey,
      size_bytes: body.length,
    }),
  );
}

/**
 * Read a file from local storage (formerly downloaded from R2).
 *
 * @param _client - Ignored (previously S3Client)
 * @param _bucket - Ignored (previously bucket name)
 * @param key - Source file path (absolute) - will be normalized
 * @returns Readable-compatible async iterable (Buffer wrapped)
 */
export async function downloadFromR2(
  _client: unknown,
  _bucket: string,
  key: string,
): Promise<AsyncIterable<Buffer>> {
  // Normalize path to handle mixed separators on Windows
  const normalizedKey = normalize(key);
  const buffer = await readFile(normalizedKey);

  // Return as async iterable to match the previous stream interface
  async function* bufferIterable(): AsyncIterable<Buffer> {
    yield buffer;
  }

  return bufferIterable();
}

/**
 * Delete a local file (formerly deleted from R2).
 *
 * @param _client - Ignored (previously S3Client)
 * @param _bucket - Ignored (previously bucket name)
 * @param key - File path to delete (absolute) - will be normalized
 */
export async function deleteFromR2(
  _client: unknown,
  _bucket: string,
  key: string,
): Promise<void> {
  // Normalize path to handle mixed separators on Windows
  const normalizedKey = normalize(key);

  try {
    await unlink(normalizedKey);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      // Already gone — not an error
      return;
    }
    throw err;
  }

  console.log(
    JSON.stringify({
      level: "info",
      message: "Deleted local file",
      key: normalizedKey,
    }),
  );
}

/**
 * Build local file path for a job asset.
 * Convention: {LOCAL_MEDIA_ROOT}/{channel_id}/{job_id}/{filename}
 *
 * IMPORTANT: Returns a normalized absolute path using node:path to ensure
 * cross-platform compatibility. This prevents path bugs on Windows where
 * string concatenation with "/" can produce invalid paths like "/c/Users/...".
 *
 * @param channelId - Channel UUID
 * @param jobId - Job UUID
 * @param filename - Asset filename (e.g., "audio_tts.wav", "scene_1_broll.png")
 * @returns Normalized absolute path (e.g., "C:\media\channel-id\job-id\file.png" on Windows)
 */
export function buildR2Key(
  channelId: string,
  jobId: string,
  filename: string,
): string {
  const localMediaRoot =
    process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";

  // Use path.join() for proper path construction, then normalize
  // This handles Windows vs Unix path separators correctly
  return normalize(join(localMediaRoot, channelId, jobId, filename));
}
