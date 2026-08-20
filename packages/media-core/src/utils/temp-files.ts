import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Create temporary directory for render job.
 *
 * Deletes any existing directory with the same name to ensure a clean slate.
 * This prevents issues with stale files from previous failed renders.
 *
 * @param jobId - Content job UUID
 * @returns Absolute path to temp directory
 */
export async function createTempDir(jobId: string): Promise<string> {
  const tmpDir = join(tmpdir(), `render-${jobId}`);

  // Remove existing directory if present (prevents stale file issues)
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {
    // Ignore errors if directory doesn't exist
  });

  await mkdir(tmpDir, { recursive: true });
  console.log(`[temp] Created temp directory: ${tmpDir}`);
  return tmpDir;
}

/**
 * Clean up temporary directory.
 *
 * @param tmpDir - Absolute path to temp directory
 */
export async function cleanupTempDir(tmpDir: string): Promise<void> {
  try {
    await rm(tmpDir, { recursive: true, force: true });
    console.log(`[temp] Cleaned up temp directory: ${tmpDir}`);
  } catch (err) {
    console.warn(`[temp] Failed to cleanup temp directory ${tmpDir}:`, err);
    // Don't throw - cleanup failure shouldn't fail the job
  }
}
