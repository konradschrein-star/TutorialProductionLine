import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { getTimelineForJob, saveTimeline } from '@/lib/repositories/timeline-repository';
import { createRenderHeavyQueue, createRedisConnection } from '@repo/queue';

export const dynamic = 'force-dynamic';

// Minimum gap between re-queuing the same job (ms) — prevents accidental double-dispatch.
const REQUEUE_COOLDOWN_MS = 60_000;

/**
 * POST /api/timeline/[jobId]/render
 *
 * Saves the current timeline edit layer then dispatches a render job to
 * queue:render-heavy. Returns immediately with { queued: true }.
 *
 * Idempotency: if the timeline already has a render_queued_at timestamp
 * within the last 60 seconds the request is rejected with 409 to prevent
 * accidental double-renders.
 *
 * Requires edit:job permission.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'edit:job')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }

  const { jobId } = await params;

  const timeline = await getTimelineForJob(jobId);
  if (!timeline) {
    return NextResponse.json({ error: 'Timeline not found for job' }, { status: 404 });
  }

  // Cooldown check
  const lastQueued = timeline.render_queued_at;
  if (lastQueued) {
    const msSinceLast = Date.now() - new Date(lastQueued).getTime();
    if (msSinceLast < REQUEUE_COOLDOWN_MS) {
      return NextResponse.json(
        { error: 'Render already queued', retry_after_ms: REQUEUE_COOLDOWN_MS - msSinceLast },
        { status: 409 }
      );
    }
  }

  // Stamp render_queued_at on the timeline and save it before dispatch
  const timedTimeline = {
    ...timeline,
    render_queued_at: new Date().toISOString(),
  };

  try {
    await saveTimeline(timedTimeline, session.username as string | undefined);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save timeline before render' },
      { status: 500 }
    );
  }

  // Dispatch to queue:render-heavy
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) {
    return NextResponse.json(
      { error: 'REDIS_URL not configured — cannot dispatch render job' },
      { status: 503 }
    );
  }

  let conn;
  try {
    conn = createRedisConnection({ url: redisUrl, mode: 'queue' });
    const queue = createRenderHeavyQueue(conn);

    await queue.add(
      `render:${jobId}`,
      { job_id: jobId, priority: 5 },
      { jobId: `render-${jobId}-${Date.now()}` }
    );
  } catch (err) {
    console.error('[timeline/render] Failed to dispatch render job:', err);
    return NextResponse.json(
      { error: 'Failed to dispatch render job to queue' },
      { status: 500 }
    );
  } finally {
    conn?.disconnect();
  }

  return NextResponse.json({ queued: true }, { status: 202 });
}
