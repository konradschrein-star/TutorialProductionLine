import { NextRequest, NextResponse } from 'next/server';
import { stat, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { getAssetById } from '@/lib/repositories/asset-repository';

export const dynamic = 'force-dynamic';

/**
 * GET /api/timeline/image/[assetId]
 *
 * Serves an asset image for the canvas compositor.
 * Lookup by asset UUID (from scene_frame_sequences.asset_id).
 *
 * Priority:
 * 1. file_path present → stream from SSD (fastest)
 * 2. r2_key present → treat as local file path and stream
 * 3. Neither → 404
 *
 * The canvas compositor uses this as the `src` for Konva Image nodes.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'view:job-detail')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { assetId } = await params;

  const asset = await getAssetById(assetId);
  if (!asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  }

  const ext = (asset.file_format ?? '').toLowerCase();
  const contentType =
    ext === 'png' ? 'image/png'
    : ext === 'webp' ? 'image/webp'
    : ext === 'gif' ? 'image/gif'
    : 'image/jpeg';

  // Prefer explicit file_path; fall back to r2_key (now a local path)
  const filePath = asset.file_path ?? asset.r2_key ?? null;

  if (filePath) {
    try {
      const fileStat = await stat(filePath);
      const stream = createReadStream(filePath);
      const readable = new ReadableStream<Uint8Array>({
        start(controller) {
          stream.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
          stream.on('end', () => controller.close());
          stream.on('error', (err) => controller.error(err));
        },
        cancel() { stream.destroy(); },
      });
      return new NextResponse(readable as unknown as BodyInit, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(fileStat.size),
          'Cache-Control': 'private, max-age=300',
        },
      });
    } catch {
      // Fall through to 404
    }
  }

  return NextResponse.json(
    { error: 'Asset has no accessible file_path or local key' },
    { status: 422 }
  );
}
