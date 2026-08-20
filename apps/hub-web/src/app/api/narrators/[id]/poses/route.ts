import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { saveLocalFile } from '@/lib/services/local-storage-service';
import {
  listNarratorPoses,
  createNarratorPose,
} from '@/lib/repositories/narrator-repository';

export const dynamic = 'force-dynamic';

/**
 * GET /api/narrators/[id]/poses
 *
 * List all poses for a narrator.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'view:settings')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }

  const { id } = await params;

  try {
    const poses = await listNarratorPoses(id);
    return NextResponse.json({ poses });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to list narrator poses: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/narrators/[id]/poses
 *
 * Upload a new narrator pose image.
 *
 * FormData fields:
 *   - file: File (required) — PNG image (preferably transparent background)
 *   - pose_name: string (required) — e.g. "pointing_left", "neutral", "excited"
 *   - description: string (optional)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'edit:settings')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }

  const { id: narratorId } = await params;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to parse form data: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 400 }
    );
  }

  const file = formData.get('file') as File | null;
  const poseName = (formData.get('pose_name') as string | null)?.trim();
  const description = (formData.get('description') as string | null)?.trim();

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (!poseName) return NextResponse.json({ error: 'pose_name is required' }, { status: 400 });

  // Max 10MB for narrator pose images
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: `File too large: ${Math.round(file.size / 1024 / 1024)}MB (max 10MB)` },
      { status: 413 }
    );
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png';
    const poseUuid = randomUUID();

    // Save to LOCAL_MEDIA_ROOT/narrators/{narratorId}/{poseUuid}.{ext}
    const category = `narrators/${narratorId}`;
    const { filePath, fileName } = await saveLocalFile(category, poseUuid, ext, buffer);

    // Get image dimensions if available
    let width: number | undefined;
    let height: number | undefined;
    try {
      const sharp = (await import('sharp')).default;
      const metadata = await sharp(buffer).metadata();
      width = metadata.width;
      height = metadata.height;
    } catch (err) {
      // Image metadata extraction failed, continue without dimensions
      console.warn('Failed to extract image metadata:', err);
    }

    const poseAsset = await createNarratorPose({
      narrator_id: narratorId,
      pose_name: poseName,
      file_path: filePath,
      file_name: fileName,
      file_format: ext,
      width,
      height,
      size_bytes: file.size,
      description,
    });

    return NextResponse.json({ pose: poseAsset }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to create narrator pose: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 500 }
    );
  }
}
