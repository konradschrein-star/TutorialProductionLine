import { copyFile, stat, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { retryFileOperation } from "../utils/retry-file-operation.js";

/**
 * "Upload" a file to local storage (previously uploaded to Cloudflare R2).
 *
 * Preserves the original call-site interface: accepts a source local path
 * and a destination key (now an absolute local path). Copies the file into
 * place and returns the size in bytes.
 *
 * @param _client - Unused (previously S3Client — kept for call-site compatibility)
 * @param _bucket - Unused (previously R2 bucket name — kept for call-site compatibility)
 * @param localPath - Source file path to copy from
 * @param key - Destination path (absolute local path under LOCAL_MEDIA_ROOT)
 * @returns Object with size_bytes for asset manifest
 */
export async function uploadToR2(
  _client: unknown,
  _bucket: string,
  localPath: string,
  key: string,
): Promise<{ size_bytes: number }> {
  console.log(`[storage] Saving: ${localPath} → ${key}`);

  try {
    // Verify source file exists before attempting copy (no retry needed for stat)
    const sourceStats = await stat(localPath).catch((err) => {
      throw new Error(
        `Source file does not exist: ${localPath} (Error: ${err.message})`,
      );
    });
    console.log(
      `[storage] Source file verified: ${localPath} (${sourceStats.size} bytes)`,
    );

    // Create destination directory
    const destDir = dirname(key);
    console.log(`[storage] Creating destination directory: ${destDir}`);
    await mkdir(destDir, { recursive: true });

    // Copy file with retry logic to handle OneDrive/Windows file locks
    console.log(`[storage] Copying file...`);
    await retryFileOperation(() => copyFile(localPath, key), {
      maxAttempts: 5,
      baseDelayMs: 100,
      operationName: `copy ${localPath} → ${key}`,
    });

    // Verify destination file exists and matches source size
    const destStats = await stat(key).catch((err) => {
      throw new Error(
        `Destination file verification failed: ${key} (Error: ${err.message})`,
      );
    });
    console.log(
      `[storage] Destination file verified: ${key} (${destStats.size} bytes)`,
    );

    if (destStats.size !== sourceStats.size) {
      throw new Error(
        `File size mismatch: source=${sourceStats.size} bytes, dest=${destStats.size} bytes`,
      );
    }

    console.log(
      `[storage] ✓ Saved successfully: ${key} (${destStats.size} bytes)`,
    );
    return { size_bytes: destStats.size };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[storage] ✗ Upload failed: ${errorMsg}`);
    console.error(`[storage]   Source: ${localPath}`);
    console.error(`[storage]   Dest: ${key}`);
    throw new Error(`Asset save failed for ${key}: ${errorMsg}`);
  }
}
