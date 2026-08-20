import { readFile, writeFile, unlink, stat, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Local Storage Service (formerly Cloudflare R2 service)
 *
 * All asset storage now happens on the local VPS filesystem under LOCAL_MEDIA_ROOT.
 * The exported function names and signatures are preserved for call-site compatibility.
 *
 * The `key` parameter throughout is now an absolute local file path.
 */

export interface UploadAssetParams {
  key: string;
  buffer: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface AssetInfo {
  key: string;
  size_bytes: number;
  type: string;
}

/**
 * Save asset to local filesystem (formerly uploaded to R2).
 */
export async function uploadAsset(
  params: UploadAssetParams
): Promise<AssetInfo> {
  await mkdir(dirname(params.key), { recursive: true });
  await writeFile(params.key, params.buffer);

  return {
    key: params.key,
    size_bytes: params.buffer.length,
    type: params.metadata?.asset_type || 'unknown',
  };
}

/**
 * Generate a local HTTP URL for serving an asset via the existing /api/assets/ proxy.
 *
 * Previously generated a presigned R2 URL. Now returns a path reference that
 * the timeline editor can use via /api/timeline/image-by-key?key=<encoded_key>.
 *
 * @param key - Asset file path (absolute)
 * @param _expiresIn - Ignored (no expiry on local files)
 */
export async function generatePresignedUrl(
  key: string,
  _expiresIn: number = 3600
): Promise<string> {
  // Return a URL pointing at the image-by-key proxy endpoint which now serves
  // files from the local filesystem. The key is URL-encoded for the query string.
  return `/api/timeline/image-by-key?key=${encodeURIComponent(key)}`;
}

/**
 * Delete asset from local filesystem.
 */
export async function deleteAsset(key: string): Promise<void> {
  try {
    await unlink(key);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
    // Already gone — not an error
  }
}

/**
 * Delete multiple assets from local filesystem.
 */
export async function deleteAssets(keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => deleteAsset(key)));
}

/**
 * Download asset from local filesystem (full buffer).
 */
export async function downloadAsset(key: string): Promise<{ buffer: Buffer; contentType: string }> {
  const buffer = await readFile(key);
  return {
    buffer,
    contentType: inferContentType(key),
  };
}

/**
 * Stream an asset from local filesystem with optional byte-range support.
 */
export async function streamAssetRange(
  key: string,
  rangeHeader?: string | null
): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number | null;
  contentRange: string | null;
  status: 200 | 206;
}> {
  const fileStat = await stat(key);
  const totalSize = fileStat.size;
  const contentType = inferContentType(key);

  let start = 0;
  let end = totalSize - 1;
  let isPartial = false;

  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (match) {
      start = match[1] ? parseInt(match[1], 10) : 0;
      end = match[2] ? parseInt(match[2], 10) : totalSize - 1;
      isPartial = true;
    }
  }

  const nodeStream = createReadStream(key, isPartial ? { start, end } : undefined);
  const webStream = new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      nodeStream.on('end', () => controller.close());
      nodeStream.on('error', (err) => controller.error(err));
    },
    cancel() { nodeStream.destroy(); },
  });

  return {
    stream: webStream,
    contentType,
    contentLength: isPartial ? end - start + 1 : totalSize,
    contentRange: isPartial ? `bytes ${start}-${end}/${totalSize}` : null,
    status: isPartial ? 206 : 200,
  };
}

/**
 * Build a local file path for a job asset.
 * Convention: {LOCAL_MEDIA_ROOT}/{channel_id}/{job_id}/{asset_type}.{ext}
 */
export function generateAssetKey(
  channelId: string,
  jobId: string,
  assetType: string,
  extension: string
): string {
  const localMediaRoot = process.env['LOCAL_MEDIA_ROOT'] ?? '/opt/content-forge/media';
  return `${localMediaRoot}/${channelId}/${jobId}/${assetType}.${extension}`;
}

function inferContentType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  return 'application/octet-stream';
}
