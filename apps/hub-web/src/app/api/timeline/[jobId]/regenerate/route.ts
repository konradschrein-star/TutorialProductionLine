import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { getTimelineForJob, saveTimeline } from '@/lib/repositories/timeline-repository';
import { createAIGenerationQueue, createRedisConnection } from '@repo/queue';

export const dynamic = 'force-dynamic';

const RegenerateRequestSchema = z.object({
  scene_index: z.number().int().nonnegative(),
  action: z.enum(['full_regen', 'prompt_delta', 'swap_layout']),
  new_prompt_delta: z.string().optional(),
  new_layout_type: z.enum(['AVATAR_PIP', 'AVATAR_FULLSCREEN', 'AVATAR_SPLIT', 'QUOTE_CARD', 'IMAGE_FULLSCREEN']).optional(),
  aspect_ratio: z.string().max(10).default('16:9'),
});

/**
 * POST /api/timeline/[jobId]/regenerate
 *
 * Dispatches an AI regeneration action for a specific scene in the timeline.
 *
 * For full_regen and prompt_delta actions: dispatches to queue:ai-generation
 * with the scene_image payload type so the AI worker regenerates the image.
 *
 * For swap_layout: updates the timeline in-place without queuing (no AI work).
 *
 * Always appends to scene.regeneration_requests[] for audit trail.
 * Returns 202 Accepted — the actual regen result arrives via SSE.
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = RegenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', issues: parsed.error.issues },
      { status: 422 }
    );
  }

  const { scene_index, action, new_prompt_delta, new_layout_type, aspect_ratio } = parsed.data;

  // Load current timeline (saved or hydrated)
  const timeline = await getTimelineForJob(jobId);
  if (!timeline) {
    return NextResponse.json({ error: 'Timeline not found for job' }, { status: 404 });
  }

  const sceneIdx = timeline.scenes.findIndex((s) => s.scene_index === scene_index);
  if (sceneIdx === -1) {
    return NextResponse.json({ error: `Scene ${scene_index} not found in timeline` }, { status: 404 });
  }

  const username = session.username as string | undefined;
  const now = new Date().toISOString();

  // Append regeneration request to the scene's audit trail
  const regenerationRequest = {
    action: action as 'full_regen' | 'prompt_delta' | 'swap_layout',
    requested_at: now,
    requested_by: username,
    ...(new_prompt_delta ? { new_prompt_delta } : {}),
    ...(new_layout_type ? { new_layout_type: new_layout_type as any } : {}),
    status: 'dispatched' as const,
  };

  // Build updated timeline with the regen request appended
  const updatedScenes = timeline.scenes.map((scene, i) => {
    if (i !== sceneIdx) return scene;
    return {
      ...scene,
      // For prompt_delta: mark the first frame as pending regen
      video_frames: action === 'prompt_delta' && new_prompt_delta
        ? scene.video_frames.map((f, fi) =>
            fi === 0 ? { ...f, pending_regeneration: { new_prompt_delta } } : f
          )
        : scene.video_frames,
      // For swap_layout: update the layout_type in-place
      ...(action === 'swap_layout' && new_layout_type
        ? { layout_type: new_layout_type as any }
        : {}),
      regeneration_requests: [...scene.regeneration_requests, regenerationRequest],
    };
  });

  const updatedTimeline = { ...timeline, scenes: updatedScenes };

  try {
    await saveTimeline(updatedTimeline, username);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save timeline' },
      { status: 500 }
    );
  }

  // For AI actions: dispatch to queue:ai-generation
  if (action === 'full_regen' || action === 'prompt_delta') {
    const scene = timeline.scenes[sceneIdx]!;

    const effectivePrompt = action === 'prompt_delta' && new_prompt_delta
      ? new_prompt_delta
      : scene.image_prompt ?? '';

    const enrichedPrompt = action === 'full_regen'
      ? scene.enriched_image_prompt ?? scene.image_prompt ?? ''
      : new_prompt_delta ?? '';

    const redisUrl = process.env['REDIS_URL'];
    if (!redisUrl) {
      console.error('[timeline/regenerate] REDIS_URL not set — cannot dispatch to queue');
      // Still return success: the audit record was saved, dispatch will be retried manually
      return NextResponse.json(
        { queued: false, reason: 'REDIS_URL not configured', timeline_saved: true },
        { status: 202 }
      );
    }

    let conn;
    try {
      conn = createRedisConnection({ url: redisUrl, mode: 'queue' });
      const queue = createAIGenerationQueue(conn);

      await queue.add(
        `regen:${jobId}:scene_${scene_index}`,
        {
          job_id: jobId,
          generation_type: 'scene_image',
          scene_index,
          image_prompt: effectivePrompt,
          enriched_image_prompt: enrichedPrompt,
          aspect_ratio,
        },
        { jobId: `regen-${jobId}-scene${scene_index}-${Date.now()}` }
      );
    } catch (err) {
      console.error('[timeline/regenerate] Failed to dispatch to queue:', err);
      // Don't fail the request — the audit record is saved and can be retried
    } finally {
      conn?.disconnect();
    }
  }

  return NextResponse.json({ queued: true, timeline_saved: true }, { status: 202 });
}
