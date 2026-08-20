import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream, existsSync, type ReadStream } from "node:fs";

/**
 * Local disk storage service for hub-web.
 *
 * Wraps the raw filesystem primitives used by the /api/assets/ proxy to serve
 * Tier 2 assets (archived final videos) directly from local disk instead of R2.
 *
 * Root is configured via LOCAL_MEDIA_ROOT env var (default: /opt/content-forge/media).
 */

const LOCAL_MEDIA_ROOT = process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";

export function getLocalAssetPath(jobId: string, filename: string): string {
  return path.join(LOCAL_MEDIA_ROOT, jobId, filename);
}

export async function localAssetExists(jobId: string, filename: string): Promise<boolean> {
  try {
    await fs.access(getLocalAssetPath(jobId, filename));
    return true;
  } catch {
    return false;
  }
}

export function localAssetExistsSync(jobId: string, filename: string): boolean {
  return existsSync(getLocalAssetPath(jobId, filename));
}

export async function saveLocalAsset(
  jobId: string,
  filename: string,
  buffer: Buffer
): Promise<string> {
  const dir = path.join(LOCAL_MEDIA_ROOT, jobId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export async function deleteLocalAssets(jobId: string): Promise<void> {
  const dir = path.join(LOCAL_MEDIA_ROOT, jobId);
  await fs.rm(dir, { recursive: true, force: true });
}

export function streamLocalAsset(jobId: string, filename: string): ReadStream {
  return createReadStream(getLocalAssetPath(jobId, filename));
}

// ---------------------------------------------------------------------------
// Style Asset Storage
//
// Style assets are reusable reference images (style guides, personas,
// backgrounds) stored under LOCAL_MEDIA_ROOT/style-assets/{format}/{assetType}/
// They are managed separately from per-job media assets.
// ---------------------------------------------------------------------------

const STYLE_ASSETS_ROOT = path.join(LOCAL_MEDIA_ROOT, "style-assets");

export async function saveStyleAsset(
  format: string,
  assetType: string,
  assetUuid: string,
  ext: string,
  buffer: Buffer
): Promise<{ filePath: string; fileName: string }> {
  const dir = path.join(STYLE_ASSETS_ROOT, format.toLowerCase(), assetType);
  await fs.mkdir(dir, { recursive: true });
  const fileName = `${assetUuid}.${ext}`;
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, buffer);
  return { filePath, fileName };
}

// ---------------------------------------------------------------------------
// Universal Asset Storage
//
// General-purpose assets (character states, style references, etc.) stored
// under LOCAL_MEDIA_ROOT/assets/{assetType}/{uuid}.ext — outside style-assets/.
// ---------------------------------------------------------------------------

const ASSETS_ROOT = path.join(LOCAL_MEDIA_ROOT, "assets");

export async function saveAsset(
  assetType: string,
  assetUuid: string,
  ext: string,
  buffer: Buffer
): Promise<{ filePath: string; fileName: string }> {
  const dir = path.join(ASSETS_ROOT, assetType);
  await fs.mkdir(dir, { recursive: true });
  const fileName = `${assetUuid}.${ext}`;
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, buffer);
  return { filePath, fileName };
}

export async function deleteStyleAssetFile(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true });
}

export function streamStyleAsset(filePath: string): ReadStream {
  return createReadStream(filePath);
}

export async function styleAssetFileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function saveLocalFile(
  category: string,
  filename: string,
  ext: string,
  buffer: Buffer
): Promise<{ filePath: string; fileName: string }> {
  const dir = path.join(LOCAL_MEDIA_ROOT, category);
  await fs.mkdir(dir, { recursive: true });
  const fileName = `${filename}.${ext}`;
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, buffer);
  return { filePath, fileName };
}
