import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { getTimelineForJob, saveTimeline } from '@/lib/repositories/timeline-repository';
import { VideoTimelineSchema } from '@repo/contracts';

export const dynamic = 'force-dynamic';

/**
 * GET /api/timeline/[jobId]
 *
 * Returns the VideoTimeline for the given job.
 * Tries the saved edit layer first; falls back to live hydration from assembly_manifest.
 * Returns 404 if the job has no assembly_manifest yet (too early in pipeline).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'view:job-detail')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }

  const { jobId } = await params;

  try {
    const timeline = await getTimelineForJob(jobId);
    if (!timeline) {
      return NextResponse.json(
        { error: 'No timeline available — job may not have reached scene analysis yet' },
        { status: 404 }
      );
    }
    return NextResponse.json({ timeline });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load timeline' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/timeline/[jobId]
 *
 * Saves an updated VideoTimeline for the given job.
 * The full timeline is validated with VideoTimelineSchema before persisting.
 * Version is incremented automatically by the repository.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'edit:job')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }

  const { jobId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = VideoTimelineSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid timeline data', issues: parsed.error.issues },
      { status: 422 }
    );
  }

  // Ensure the body job_id matches the URL param
  if (parsed.data.job_id !== jobId) {
    return NextResponse.json(
      { error: 'job_id in body does not match URL' },
      { status: 422 }
    );
  }

  try {
    const username = session.username as string | undefined;
    const saved = await saveTimeline(parsed.data, username);
    return NextResponse.json({ timeline: saved });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save timeline' },
      { status: 500 }
    );
  }
}
