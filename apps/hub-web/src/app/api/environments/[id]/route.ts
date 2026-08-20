import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import {
  getEnvironmentById,
  updateEnvironment,
  deleteEnvironment,
} from '@/lib/repositories/environment-repository';

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
  const env = await getEnvironmentById(id);
  if (!env) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ environment: env });
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
    const env = await updateEnvironment(id, body);
    if (!env) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ environment: env });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update environment' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'edit:settings')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }
  const { id } = await params;
  const env = await getEnvironmentById(id);
  if (!env) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await deleteEnvironment(id);
  return NextResponse.json({ success: true });
}
