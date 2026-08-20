import { NextRequest, NextResponse } from 'next/server';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { getAssetById, updateAsset, deleteAsset, isAssetInUse } from '@/lib/repositories/asset-repository';

export const dynamic = 'force-dynamic';

/**
 * GET /api/assets/[id]
 * Stream the asset file from SSD for preview.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'view:settings')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }

  const { id } = await params;
  const asset = await getAssetById(id);
  if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!asset.file_path) {
    return NextResponse.json({ error: 'Asset has no local file path' }, { status: 422 });
  }

  try {
    const fileStat = await stat(asset.file_path);
    const ext = asset.file_format.toLowerCase();
    const contentType =
      ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp'
      : ext === 'svg' ? 'image/svg+xml'
      : 'image/jpeg';

    const stream = createReadStream(asset.file_path);
    const readable = new ReadableStream({
      start(controller) {
        stream.on('data', (chunk) => controller.enqueue(chunk));
        stream.on('end', () => controller.close());
        stream.on('error', (err) => controller.error(err));
      },
    });

    return new NextResponse(readable, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(fileStat.size),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to serve asset' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/assets/[id]
 * Update asset metadata (name, description, status, quality_rating, tags, etc.)
 * Does not replace the file.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'edit:settings')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }
  const { id } = await params;
  try {
    const body = await request.json();
    const asset = await updateAsset(id, body);
    if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ asset });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update asset' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/assets/[id]
 * Delete asset — removes file from SSD and DB record.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'edit:settings')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }
  const { id } = await params;
  const asset = await getAssetById(id);
  if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const usage = await isAssetInUse(id);
  if (usage.inUse) {
    return NextResponse.json(
      { error: `Cannot delete: ${usage.reason}` },
      { status: 409 },
    );
  }

  await deleteAsset(id);
  return NextResponse.json({ success: true });
}
