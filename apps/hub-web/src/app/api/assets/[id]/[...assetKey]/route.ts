import { NextRequest, NextResponse } from 'next/server';
import { getJobById } from '@/lib/repositories/job-repository';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { statSync, createReadStream } from 'fs';

/**
 * Asset Download/Stream API Route
 *
 * GET /api/assets/[id]/[...assetKey]
 *
 * Supports HTTP Range requests (206 Partial Content) for video seeking/playback.
 * All assets are stored on local disk — the key in r2_asset_manifest is an
 * absolute local file path.
 *
 * Query params:
 * - ?download=1 — force Content-Disposition: attachment
 */

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{
    id: string;
    assetKey: string[];
  }>;
}

function parseRange(rangeHeader: string, totalSize: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) return null;
  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;
  if (start > end || end >= totalSize) return null;
  return { start, end };
}

function contentTypeFromKey(key: string): string {
  const lower = key.toLowerCase();
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

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session || !hasPermission(session, 'view:job-detail')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: jobId, assetKey } = await params;
    // The stored key is now an absolute local file path
    const localPath = assetKey.map(decodeURIComponent).join('/');
    const forceDownload = request.nextUrl.searchParams.get('download') === '1';
    const rangeHeader = request.headers.get('range');

    // Verify job access
    const job = await getJobById(jobId);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Verify asset is in manifest
    const manifest = (job.r2_asset_manifest as Array<{ key: string; type: string; size_bytes: number }>) || [];
    const assetInfo = manifest.find(a => a.key === localPath);
    if (!assetInfo) {
      return NextResponse.json(
        { error: 'Asset not found in manifest', key: localPath },
        { status: 404 }
      );
    }

    const filename = localPath.split('/').pop() || 'download';
    const contentType = contentTypeFromKey(localPath);
    const disposition = forceDownload
      ? `attachment; filename="${filename}"`
      : `inline; filename="${filename}"`;

    let fileSize: number;
    try {
      fileSize = statSync(localPath).size;
    } catch {
      return NextResponse.json({ error: 'Asset file not found on disk' }, { status: 404 });
    }

    const baseHeaders: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Disposition': disposition,
      'Cache-Control': 'private, max-age=3600',
      'Accept-Ranges': 'bytes',
    };

    if (rangeHeader && !forceDownload) {
      const range = parseRange(rangeHeader, fileSize);
      if (!range) {
        return new NextResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${fileSize}` },
        });
      }
      const { start, end } = range;
      const chunkSize = end - start + 1;
      const fileStream = createReadStream(localPath, { start, end });
      const webStream = new ReadableStream<Uint8Array>({
        start(controller) {
          fileStream.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
          fileStream.on('end', () => controller.close());
          fileStream.on('error', (err) => controller.error(err));
        },
        cancel() { fileStream.destroy(); },
      });

      return new NextResponse(webStream as unknown as BodyInit, {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Length': String(chunkSize),
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        },
      });
    }

    // Full file
    const fileStream = createReadStream(localPath);
    const webStream = new ReadableStream<Uint8Array>({
      start(controller) {
        fileStream.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
        fileStream.on('end', () => controller.close());
        fileStream.on('error', (err) => controller.error(err));
      },
      cancel() { fileStream.destroy(); },
    });
    return new NextResponse(webStream as unknown as BodyInit, {
      headers: {
        ...baseHeaders,
        'Content-Length': String(fileSize),
      },
    });
  } catch (error) {
    console.error('Failed to stream asset:', error);
    return NextResponse.json({ error: 'Failed to stream asset' }, { status: 500 });
  }
}
