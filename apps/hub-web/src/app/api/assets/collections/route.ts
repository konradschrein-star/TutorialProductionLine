import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import {
  listCollections,
  createCollection,
} from '@/lib/repositories/asset-collection-repository';

export const dynamic = 'force-dynamic';

/**
 * GET /api/assets/collections
 *
 * List all asset collections with asset counts
 */
export async function GET() {
  const session = await getSession();
  if (!session || !hasPermission(session, 'view:settings')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }

  try {
    const collections = await listCollections();
    return NextResponse.json({ collections });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list collections' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/assets/collections
 *
 * Create a new asset collection
 *
 * Body: {
 *   name: string (required)
 *   description?: string
 *   color?: string (hex color, default: '#6366F1')
 *   icon?: string (material icon name, default: 'folder')
 * }
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'edit:settings')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }

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

  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const description = typeof data.description === 'string' ? data.description.trim() : undefined;
  const color = typeof data.color === 'string' ? data.color.trim() : undefined;
  const icon = typeof data.icon === 'string' ? data.icon.trim() : undefined;

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  if (name.length > 100) {
    return NextResponse.json({ error: 'name must be 100 characters or less' }, { status: 400 });
  }

  // Validate hex color if provided
  if (color && !/^#[0-9A-F]{6}$/i.test(color)) {
    return NextResponse.json({ error: 'color must be a valid hex color (e.g., #6366F1)' }, { status: 400 });
  }

  try {
    const collection = await createCollection({
      name,
      description,
      color,
      icon,
    });

    return NextResponse.json({ collection }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create collection' },
      { status: 500 }
    );
  }
}
