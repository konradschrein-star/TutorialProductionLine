import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import {
  getCollection,
  updateCollection,
  deleteCollection,
  getCollectionAssets,
} from '@/lib/repositories/asset-collection-repository';

export const dynamic = 'force-dynamic';

/**
 * GET /api/assets/collections/[id]
 *
 * Get a single collection with its assets
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
    const collection = await getCollection(id);

    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
    }

    const assets = await getCollectionAssets(id);

    return NextResponse.json({ collection, assets });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get collection' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/assets/collections/[id]
 *
 * Update a collection
 *
 * Body: {
 *   name?: string
 *   description?: string
 *   color?: string (hex color)
 *   icon?: string (material icon name)
 * }
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

  const updates: {
    name?: string;
    description?: string;
    color?: string;
    icon?: string;
  } = {};

  if (typeof data.name === 'string') {
    const name = data.name.trim();
    if (!name) {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    }
    if (name.length > 100) {
      return NextResponse.json({ error: 'name must be 100 characters or less' }, { status: 400 });
    }
    updates.name = name;
  }

  if (typeof data.description === 'string') {
    updates.description = data.description.trim();
  }

  if (typeof data.color === 'string') {
    const color = data.color.trim();
    if (!/^#[0-9A-F]{6}$/i.test(color)) {
      return NextResponse.json({ error: 'color must be a valid hex color (e.g., #6366F1)' }, { status: 400 });
    }
    updates.color = color;
  }

  if (typeof data.icon === 'string') {
    updates.icon = data.icon.trim();
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  try {
    const collection = await updateCollection(id, updates);

    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
    }

    return NextResponse.json({ collection });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update collection' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/assets/collections/[id]
 *
 * Delete a collection (assets remain, only memberships are removed)
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

  try {
    const deleted = await deleteCollection(id);

    if (!deleted) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete collection' },
      { status: 500 }
    );
  }
}
