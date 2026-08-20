import fs from "node:fs/promises";
import { createReadStream, existsSync, type ReadStream } from "node:fs";
import path from "node:path";

/**
 * Local disk storage utilities for Tier 2 (archived finished assets).
 *
 * Final rendered videos are moved from R2 to local disk after render completes.
 * This keeps R2 costs low while keeping finished content accessible via the
 * existing /api/assets/ proxy (which checks local first, falls back to R2).
 *
 * Default root: /opt/content-forge/media
 * Per-job layout:  {root}/{jobId}/final.mp4
 */

export function getLocalAssetPath(root: string, jobId: string, filename: string): string {
  return path.join(root, jobId, filename);
}

export async function localAssetExists(root: string, jobId: string, filename: string): Promise<boolean> {
  try {
    await fs.access(getLocalAssetPath(root, jobId, filename));
    return true;
  } catch {
    return false;
  }
}

export async function saveLocalAsset(
  root: string,
  jobId: string,
  filename: string,
  buffer: Buffer
): Promise<string> {
  const dir = path.join(root, jobId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export async function deleteLocalAssets(root: string, jobId: string): Promise<void> {
  const dir = path.join(root, jobId);
  await fs.rm(dir, { recursive: true, force: true });
}

export function streamLocalAsset(root: string, jobId: string, filename: string): ReadStream {
  return createReadStream(getLocalAssetPath(root, jobId, filename));
}

/** Check whether the path exists synchronously (for cases where async is inconvenient). */
export function localAssetExistsSync(root: string, jobId: string, filename: string): boolean {
  return existsSync(getLocalAssetPath(root, jobId, filename));
}
