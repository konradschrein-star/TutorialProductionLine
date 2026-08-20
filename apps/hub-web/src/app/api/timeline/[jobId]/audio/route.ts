import { NextRequest, NextResponse } from 'next/server';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { db, contentJobs } from '@/lib/db';
import { generatePresignedUrl } from '@/lib/services/r2-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/timeline/[jobId]/audio
 *
 * Serves the TTS narration audio file for the timeline editor's playback.
 *
 * Priority:
 * 1. r2_asset_manifest entry with type "audio/tts" → presigned R2 URL redirect (TTL: 5 min)
 * 2. narration_source_path on disk → stream directly
 * 3. Neither → 404
 *
 * The timeline editor uses this as the <audio> element src so playback
 * can be synchronised to the playhead position.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'view:job-detail')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { jobId } = await params;

  const rows = await db
    .select({
      narration_source_path: contentJobs.narration_source_path,
      r2_asset_manifest: contentJobs.r2_asset_manifest,
    })
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const job = rows[0]!;
  const manifest = (job.r2_asset_manifest ?? []) as Array<{
    key: string;
    type: string;
    size_bytes: number;
  }>;

  // 1. R2 audio/tts entry
  const audioEntry = manifest.find((a) => a.type === 'audio/tts');
  if (audioEntry?.key) {
    try {
      const url = await generatePresignedUrl(audioEntry.key, 300); // 5-min TTL
      return NextResponse.redirect(url, { status: 302 });
    } catch (err) {
      console.error('[timeline/audio] R2 presigned URL failed:', err);
      // Fall through to disk path
    }
  }

  // 2. Disk file (pre-uploaded narration at ingest)
  if (job.narration_source_path) {
    try {
      const fileStat = await stat(job.narration_source_path);
      const ext = job.narration_source_path.split('.').pop()?.toLowerCase() ?? 'wav';
      const contentType =
        ext === 'mp3' ? 'audio/mpeg'
        : ext === 'ogg' ? 'audio/ogg'
        : ext === 'aac' ? 'audio/aac'
        : 'audio/wav';

      const stream = createReadStream(job.narration_source_path);
      const readable = new ReadableStream<Uint8Array>({
        start(controller) {
          stream.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
          stream.on('end', () => controller.close());
          stream.on('error', (err) => controller.error(err));
        },
        cancel() { stream.destroy(); },
      });

      return new NextResponse(readable as unknown as BodyInit, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(fileStat.size),
          'Cache-Control': 'private, max-age=300',
          'Accept-Ranges': 'bytes',
        },
      });
    } catch {
      // Fall through to 404
    }
  }

  return NextResponse.json({ error: 'No audio available for this job' }, { status: 404 });
}
