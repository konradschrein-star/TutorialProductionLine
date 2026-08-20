import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import {
  listNarratorsByChannel,
  createNarrator,
} from '@/lib/repositories/narrator-repository';

export const dynamic = 'force-dynamic';

/**
 * GET /api/narrators
 *
 * List narrators for a specific channel.
 * Query params:
 *   - channel_id (required) — channel UUID
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  // Allow users with create:job permission to read narrators for job creation
  if (!session || !(hasPermission(session, 'view:settings') || hasPermission(session, 'create:job'))) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get('channel_id');

  if (!channelId) {
    return NextResponse.json({ error: 'channel_id is required' }, { status: 400 });
  }

  try {
    const narrators = await listNarratorsByChannel(channelId);
    return NextResponse.json({ narrators });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to list narrators: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/narrators
 *
 * Create a new narrator.
 *
 * Request body:
 *   - name: string (required)
 *   - description: string (required)
 *   - channel_id: string (required)
 *   - is_default: boolean (optional) — auto-unsets previous default if true
 *   - tags: string[] (optional)
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'edit:settings')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }

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

  const { name, description, channel_id, is_default, tags } = body;

  // Validation
  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (!description?.trim()) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 });
  }
  if (!channel_id) {
    return NextResponse.json({ error: 'channel_id is required' }, { status: 400 });
  }

  try {
    const narrator = await createNarrator({
      name: name.trim(),
      description: description.trim(),
      channel_id,
      is_default: is_default ?? false,
      tags: tags ?? [],
    });

    return NextResponse.json({ narrator }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to create narrator: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 500 }
    );
  }
}
