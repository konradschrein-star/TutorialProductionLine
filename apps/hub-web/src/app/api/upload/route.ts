import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { uploadAsset, generateAssetKey } from '@/lib/services/r2-service';

// Route segment config — allow large file uploads (up to 15GB)
export const maxDuration = 600; // 10 minutes
export const dynamic = 'force-dynamic';

/**
 * POST /api/upload
 *
 * Dedicated upload endpoint for large files (video).
 * Bypasses server action FormData size limits.
 * Saves to local media storage and returns the asset key + metadata.
 *
 * FormData fields:
 *   - file: File (required)
 *   - channel_id: string (required)
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'create:job')) {
    return NextResponse.json(
      { error: 'Permission denied' },
      { status: 403 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to parse form data: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 }
    );
  }

  const file = formData.get('file') as File | null;
  const channelId = formData.get('channel_id') as string | null;

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  if (!channelId) {
    return NextResponse.json(
      { error: 'channel_id is required' },
      { status: 400 }
    );
  }

  // Max 15GB
  if (file.size > 15 * 1024 * 1024 * 1024) {
    return NextResponse.json(
      { error: `File too large: ${Math.round(file.size / 1024 / 1024)}MB (max 15GB)` },
      { status: 413 }
    );
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const ext = file.name.split('.').pop() ?? 'mp4';
    const assetUuid = randomUUID();

    const assetKey = generateAssetKey(
      channelId,
      assetUuid,
      'heygen-footage',
      ext
    );

    const assetInfo = await uploadAsset({
      key: assetKey,
      buffer,
      contentType: ext === 'mov' ? 'video/quicktime' : 'video/mp4',
      metadata: {
        asset_type: 'video/raw-va-footage',
        original_filename: file.name,
        uploaded_by: session.userId,
        upload_source: 'staging-table',
      },
    });

    return NextResponse.json({
      success: true,
      key: assetInfo.key,
      type: 'video/raw-va-footage',
      size_bytes: assetInfo.size_bytes,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Upload failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 }
    );
  }
}
