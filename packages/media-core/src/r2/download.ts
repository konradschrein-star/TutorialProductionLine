import { copyFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { retryFileOperation } from "../utils/retry-file-operation.js";

/**
 * Turn a manifest key into a real path on this box.
 *
 * Absolute keys are used as-is. A RELATIVE key is what the visual gateway's
 * content-addressed store writes (`visual-library/objects/ab/<hash>.jpeg`), and
 * it is relative to `LOCAL_MEDIA_ROOT` — the doc comment on
 * {@link downloadFromR2} has always said so, but the implementation handed the
 * key straight to `copyFile`, which resolves against `process.cwd()`. That made
 * every store-relative asset resolve under whichever app directory the worker
 * happened to be started from and fail with ENOENT.
 *
 * Reads the env var directly rather than importing `@repo/config`, matching
 * `visual-gateway/store.ts` — media-core is imported by tools that legitimately
 * have no full worker environment. THROWS rather than guessing a root: a
 * relative key with no root configured has no defensible interpretation.
 */
function resolveStorageKey(key: string): string {
  if (isAbsolute(key)) return key;
  const root = process.env["LOCAL_MEDIA_ROOT"];
  if (root === undefined || root.trim().length === 0) {
    throw new Error(
      `downloadFromR2: asset key "${key}" is relative to LOCAL_MEDIA_ROOT, but ` +
        `LOCAL_MEDIA_ROOT is not set in this process. Set it, or pass an absolute key.`,
    );
  }
  return join(root, key);
}

/**
 * "Download" an asset from local storage to a target path.
 *
 * Previously this function downloaded from Cloudflare R2. Now that all
 * assets are stored on the local VPS filesystem under LOCAL_MEDIA_ROOT,
 * this is a local file copy that preserves the same call-site interface.
 *
 * @param _client - Unused (previously S3Client — kept for call-site compatibility)
 * @param _bucket - Unused (previously R2 bucket name — kept for call-site compatibility)
 * @param key - Asset path key (absolute local path or LOCAL_MEDIA_ROOT-relative path)
 * @param localPath - Destination path to copy to
 */
export async function downloadFromR2(
  _client: unknown,
  _bucket: string,
  key: string,
  localPath: string,
): Promise<void> {
  const sourcePath = resolveStorageKey(key);
  console.log(`[storage] Copying: ${sourcePath} → ${localPath}`);

  try {
    // Ensure destination directory exists
    await mkdir(dirname(localPath), { recursive: true });

    // Copy file with retry logic to handle OneDrive/Windows file locks
    await retryFileOperation(() => copyFile(sourcePath, localPath), {
      maxAttempts: 5,
      baseDelayMs: 100,
      operationName: `copy ${sourcePath} → ${localPath}`,
    });

    console.log(`[storage] Copied: ${key}`);
  } catch (err) {
    throw new Error(`Asset copy failed for ${key}: ${err}`);
  }
}
