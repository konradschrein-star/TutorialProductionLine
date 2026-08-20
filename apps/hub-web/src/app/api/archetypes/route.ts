import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { listArchetypes, createArchetype } from '@/lib/repositories/archetype-repository';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'view:settings')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }
  const activeOnly = request.nextUrl.searchParams.get('active_only') === 'true';
  const archetypes = await listArchetypes(activeOnly);
  return NextResponse.json({ archetypes });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'edit:settings')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const archetype = await createArchetype(body);
    return NextResponse.json({ archetype }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create archetype' },
      { status: 500 }
    );
  }
}
