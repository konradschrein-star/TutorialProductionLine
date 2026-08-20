import { mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { constants as fsConstants } from "node:fs";
import { getConfig } from "@repo/config";

/**
 * Ensure media directory exists with proper permissions
 *
 * Creates LOCAL_MEDIA_ROOT/{format}/{jobId}/ directory structure.
 * Handles permission errors gracefully with descriptive messages.
 *
 * @param format - Content format (e.g., 'bundestag')
 * @param jobId - Job UUID
 * @returns Absolute path to the created/existing directory
 * @throws {Error} If directory cannot be created or accessed
 */
export async function ensureMediaDirectory(
  format: string,
  jobId: string,
): Promise<string> {
  const config = getConfig();
  const mediaDir = join(config.LOCAL_MEDIA_ROOT, format, jobId);

  try {
    // Attempt to create directory recursively with 755 permissions
    await mkdir(mediaDir, {
      recursive: true,
      mode: 0o755,
    });

    console.log(
      JSON.stringify({
        level: "info",
        message: "Media directory created/verified",
        format,
        job_id: jobId,
        path: mediaDir,
      }),
    );

    // Verify directory is readable and writable
    try {
      await access(mediaDir, fsConstants.R_OK | fsConstants.W_OK);
    } catch (accessErr) {
      throw new Error(
        `Media directory exists but is not readable/writable: ${mediaDir}\n` +
          `Fix permissions with: chmod 755 "${mediaDir}"\n` +
          `Original error: ${accessErr instanceof Error ? accessErr.message : String(accessErr)}`,
      );
    }

    return mediaDir;
  } catch (err) {
    // Handle specific error cases
    const errorMessage = err instanceof Error ? err.message : String(err);
    const code = (err as NodeJS.ErrnoException).code;

    let descriptiveError: string;

    if (code === "EACCES") {
      descriptiveError =
        `Permission denied creating media directory: ${mediaDir}\n` +
        `Fix with: chmod 755 "${config.LOCAL_MEDIA_ROOT}"\n` +
        `Original error: ${errorMessage}`;
    } else if (code === "ENOSPC") {
      descriptiveError =
        `No space left on device for media directory: ${mediaDir}\n` +
        `Please free up disk space and retry.\n` +
        `Original error: ${errorMessage}`;
    } else if (code === "ENOENT") {
      descriptiveError =
        `Parent directory does not exist: ${config.LOCAL_MEDIA_ROOT}\n` +
        `Ensure LOCAL_MEDIA_ROOT is set and exists: mkdir -p "${config.LOCAL_MEDIA_ROOT}"\n` +
        `Original error: ${errorMessage}`;
    } else {
      descriptiveError =
        `Failed to create media directory: ${mediaDir}\n` +
        `Error: ${errorMessage}`;
    }

    console.error(
      JSON.stringify({
        level: "error",
        message: "Failed to create media directory",
        format,
        job_id: jobId,
        path: mediaDir,
        error_code: code,
        error: errorMessage,
      }),
    );

    throw new Error(descriptiveError);
  }
}

/**
 * Ensure media subdirectory exists (for asset types)
 *
 * Creates LOCAL_MEDIA_ROOT/{format}/{jobId}/{assetType}/ directory.
 * Useful for organizing different asset types within a job.
 *
 * @param format - Content format (e.g., 'bundestag')
 * @param jobId - Job UUID
 * @param assetType - Asset type (e.g., 'clips', 'playbooks', 'renders')
 * @returns Absolute path to the created/existing subdirectory
 * @throws {Error} If directory cannot be created or accessed
 */
export async function ensureMediaSubdirectory(
  format: string,
  jobId: string,
  assetType: string,
): Promise<string> {
  const config = getConfig();
  const subDir = join(config.LOCAL_MEDIA_ROOT, format, jobId, assetType);

  try {
    // Attempt to create subdirectory recursively with 755 permissions
    await mkdir(subDir, {
      recursive: true,
      mode: 0o755,
    });

    console.log(
      JSON.stringify({
        level: "info",
        message: "Media subdirectory created/verified",
        format,
        job_id: jobId,
        asset_type: assetType,
        path: subDir,
      }),
    );

    // Verify subdirectory is readable and writable
    try {
      await access(subDir, fsConstants.R_OK | fsConstants.W_OK);
    } catch (accessErr) {
      throw new Error(
        `Media subdirectory exists but is not readable/writable: ${subDir}\n` +
          `Fix permissions with: chmod 755 "${subDir}"\n` +
          `Original error: ${accessErr instanceof Error ? accessErr.message : String(accessErr)}`,
      );
    }

    return subDir;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const code = (err as NodeJS.ErrnoException).code;

    let descriptiveError: string;

    if (code === "EACCES") {
      descriptiveError =
        `Permission denied creating media subdirectory: ${subDir}\n` +
        `Fix with: chmod 755 "${config.LOCAL_MEDIA_ROOT}"\n` +
        `Original error: ${errorMessage}`;
    } else if (code === "ENOSPC") {
      descriptiveError =
        `No space left on device for media subdirectory: ${subDir}\n` +
        `Please free up disk space and retry.\n` +
        `Original error: ${errorMessage}`;
    } else {
      descriptiveError =
        `Failed to create media subdirectory: ${subDir}\n` +
        `Error: ${errorMessage}`;
    }

    console.error(
      JSON.stringify({
        level: "error",
        message: "Failed to create media subdirectory",
        format,
        job_id: jobId,
        asset_type: assetType,
        path: subDir,
        error_code: code,
        error: errorMessage,
      }),
    );

    throw new Error(descriptiveError);
  }
}
