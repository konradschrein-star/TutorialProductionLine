import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { listEnvironments, createEnvironment } from '@/lib/repositories/environment-repository';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'view:settings')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }
  const { searchParams } = request.nextUrl;
  const envs = await listEnvironments({
    archetype_id: searchParams.get('archetype_id') ?? undefined,
    channel_id: searchParams.get('channel_id') ?? undefined,
  });
  return NextResponse.json({ environments: envs });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'edit:settings')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const env = await createEnvironment(body);
    return NextResponse.json({ environment: env }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create environment' },
      { status: 500 }
    );
  }
}
