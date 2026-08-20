import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import {
  getNarratorByIdWithPoses,
  updateNarrator,
  deleteNarrator,
} from '@/lib/repositories/narrator-repository';

export const dynamic = 'force-dynamic';

/**
 * GET /api/narrators/[id]
 *
 * Get a narrator by ID with all associated pose assets.
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
    const narrator = await getNarratorByIdWithPoses(id);
    if (!narrator) {
      return NextResponse.json({ error: 'Narrator not found' }, { status: 404 });
    }
    return NextResponse.json({ narrator });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to get narrator: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/narrators/[id]
 *
 * Update narrator metadata.
 *
 * Request body:
 *   - name: string (optional)
 *   - description: string (optional)
 *   - is_default: boolean (optional) — auto-unsets previous default if true
 *   - is_active: boolean (optional)
 *   - tags: string[] (optional)
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

  let body: any;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 }
    );
  }

  try {
    const narrator = await updateNarrator(id, body);
    if (!narrator) {
      return NextResponse.json({ error: 'Narrator not found' }, { status: 404 });
    }
    return NextResponse.json({ narrator });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to update narrator: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/narrators/[id]
 *
 * Delete a narrator.
 * Cascade deletes associated pose assets via database ON DELETE CASCADE.
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
    await deleteNarrator(id);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to delete narrator: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 500 }
    );
  }
}
