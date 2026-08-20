import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { getArchetypeById, updateArchetype } from '@/lib/repositories/archetype-repository';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'view:settings')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }
  const { id } = await params;
  const archetype = await getArchetypeById(id);
  if (!archetype) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ archetype });
}

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
    const archetype = await updateArchetype(id, body);
    if (!archetype) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ archetype });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update archetype' },
      { status: 500 }
    );
  }
}
