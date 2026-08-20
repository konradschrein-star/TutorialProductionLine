import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { canEditUploadQueue } from '@/lib/auth/upload-queue-permissions';
import { updateJobMetadata } from '@/lib/repositories/upload-repository';

const metadataSchema = z.object({
  youtube_title: z.string().max(100).optional(),
  youtube_description: z.string().optional(),
  youtube_tags: z.string().optional(),
});

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. Validate session and permissions
  const session = await getSession();
  if (!session || !canEditUploadQueue(session)) {
    return NextResponse.json(
      { error: 'Insufficient permissions' },
      { status: 403 }
    );
  }

  // 2. Validate and extract job ID
  const { id: jobId } = await params;
  if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json(
      { error: 'Invalid job ID' },
      { status: 400 }
    );
  }

  // 3. Parse and validate request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON' },
      { status: 400 }
    );
  }

  const result = metadataSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: result.error.issues },
      { status: 400 }
    );
  }

  // 4. Update database
  try {
    const updatedJob = await updateJobMetadata(jobId, result.data);
    return NextResponse.json({ success: true, job: updatedJob });
  } catch (err: any) {
    console.error('Failed to update job metadata:', err);

    if (err.message === 'Job not found') {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: 'Database error' },
      { status: 500 }
    );
  }
}
