import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import {
  getAssetCollections,
  addAssetToCollection,
  removeAssetFromCollection,
} from '@/lib/repositories/asset-collection-repository';

export const dynamic = 'force-dynamic';

/**
 * GET /api/assets/[id]/collections
 *
 * Get all collections that this asset belongs to
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

  try {
    const collections = await getAssetCollections(id);
    return NextResponse.json({ collections });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get asset collections' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/assets/[id]/collections
 *
 * Add an asset to a collection
 *
 * Body: {
 *   collection_id: string (required)
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'edit:settings')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }

  const { id: assetId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Body must be an object' }, { status: 400 });
  }

  const data = body as Record<string, unknown>;
  const collectionId = typeof data.collection_id === 'string' ? data.collection_id.trim() : '';

  if (!collectionId) {
    return NextResponse.json({ error: 'collection_id is required' }, { status: 400 });
  }

  try {
    const membership = await addAssetToCollection(assetId, collectionId);
    return NextResponse.json({ membership }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to add asset to collection' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/assets/[id]/collections
 *
 * Remove an asset from a collection
 *
 * Body: {
 *   collection_id: string (required)
 * }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'edit:settings')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }

  const { id: assetId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Body must be an object' }, { status: 400 });
  }

  const data = body as Record<string, unknown>;
  const collectionId = typeof data.collection_id === 'string' ? data.collection_id.trim() : '';

  if (!collectionId) {
    return NextResponse.json({ error: 'collection_id is required' }, { status: 400 });
  }

  try {
    const deleted = await removeAssetFromCollection(assetId, collectionId);

    if (!deleted) {
      return NextResponse.json({ error: 'Asset not in collection' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to remove asset from collection' },
      { status: 500 }
    );
  }
}
