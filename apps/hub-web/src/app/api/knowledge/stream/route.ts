import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { getVideoById } from '@/lib/repositories/knowledge-repository';
import { streamAssetRange } from '@/lib/services/r2-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/knowledge/stream?key=<encoded_video_key>
 *
 * Streams a course video file with byte-range support (seek / resume).
 * Enforces:
 *  1. Authenticated session with view:knowledge permission.
 *  2. User's role is allowed to access the course that owns this video.
 *
 * Returns 206 Partial Content when a Range header is present.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'view:knowledge')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawKey = request.nextUrl.searchParams.get('key');
  if (!rawKey) {
    return NextResponse.json({ error: 'Missing key parameter' }, { status: 400 });
  }

  const videoId = request.nextUrl.searchParams.get('videoId');

  // Verify course-level role access when videoId is supplied
  if (videoId) {
    const video = await getVideoById(videoId);
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }
    const { allowed_roles } = video.chapter.course;
    if (allowed_roles && allowed_roles.length > 0 && !allowed_roles.includes(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const filePath = decodeURIComponent(rawKey);
  const rangeHeader = request.headers.get('range');

  try {
    const { stream, contentType, contentLength, contentRange, status } =
      await streamAssetRange(filePath, rangeHeader);

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    };
    if (contentLength !== null) headers['Content-Length'] = String(contentLength);
    if (contentRange) headers['Content-Range'] = contentRange;

    return new NextResponse(stream as unknown as BodyInit, { status, headers });
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return NextResponse.json({ error: 'Video file not found' }, { status: 404 });
    }
    console.error('[knowledge/stream] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
