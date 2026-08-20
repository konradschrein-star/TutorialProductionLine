import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { canEditUploadQueue } from '@/lib/auth/upload-queue-permissions';
import { cancelJob } from '@/lib/repositories/upload-repository';

const cancelSchema = z.object({
  reason: z.string().min(10, 'Reason must be at least 10 characters'),
});

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. Validate session
  const session = await getSession();
  if (!session || !canEditUploadQueue(session)) {
    return NextResponse.json(
      { error: 'Insufficient permissions' },
      { status: 403 }
    );
  }

  // 2. Validate job ID
  const { id: jobId } = await params;
  if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json(
      { error: 'Invalid job ID' },
      { status: 400 }
    );
  }

  // 3. Parse and validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON' },
      { status: 400 }
    );
  }

  const result = cancelSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: result.error.issues },
      { status: 400 }
    );
  }

  // 4. Cancel job
  try {
    const cancelledJob = await cancelJob(
      jobId,
      result.data.reason,
      session.userId
    );
    return NextResponse.json({ success: true, job: cancelledJob });
  } catch (err: any) {
    console.error('Failed to cancel job:', err);

    // Handle specific error types
    if (err.message.includes('not found')) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    if (err.message.includes('invalid state') || err.message.includes('Cannot cancel')) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }

    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
