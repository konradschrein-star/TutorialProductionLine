import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';

export const maxDuration = 300; // 5 minutes
export const dynamic = 'force-dynamic';

/**
 * POST /api/narration-upload
 *
 * Saves a narration video or audio file to local server storage.
 * Returns the absolute path to be stored in content_jobs.narration_source_path.
 *
 * FormData fields:
 *   - file: File (required) — any video or audio format
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'create:job')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to parse form data: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 }
    );
  }

  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  const mediaRoot = process.env['LOCAL_MEDIA_ROOT'] ?? '/opt/content-forge/media';
  const narrationDir = join(mediaRoot, 'narration');

  try {
    await mkdir(narrationDir, { recursive: true });

    const ext = extname(file.name) || '.mp4';
    const fileId = randomUUID();
    const filename = `${fileId}${ext}`;
    const filePath = join(narrationDir, filename);

    const arrayBuffer = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(arrayBuffer));

    return NextResponse.json({
      success: true,
      path: filePath,
      size_bytes: file.size,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Upload failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
