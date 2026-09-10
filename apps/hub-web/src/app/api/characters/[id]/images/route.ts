export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { characterUploadPaths, commitCharacterImage } from '@/lib/characters/image-path';
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  addCharacterImage,
  getCharacterWithImages,
  listCharacterImages,
} from "@/lib/repositories/character-library-repository";
import {
  normaliseCharacterReference,
  parsePoseFromFilename,
} from "@repo/media-core/images";

/**
 * GET  /api/characters/[id]/images   — the character's images in cycle order
 * POST /api/characters/[id]/images   — upload one more (multipart: file)
 *
 * The upload is normalised through the SAME `normaliseCharacterReference` the
 * import CLI uses, so an image added from the UI is byte-for-byte the same kind
 * of reference as one added from the command line. Two normalisation
 * implementations is how the two paths drift.
 *
 * NO SYNTHETIC FALLBACKS: if normalisation fails the upload fails — a character
 * image that the gateway will later reject is worse than no image, because the
 * cycle would land on it and the whole generation would die mid-pipeline.
 */

const CHARACTER_MEDIA_DIR =
  process.env["CHARACTER_MEDIA_DIR"] ?? "/opt/content-forge/media/characters";
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:settings")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }
  const { id } = await params;
  return NextResponse.json({ images: await listCharacterImages(id) });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }
  const { id } = await params;

  const character = await getCharacterWithImages(id);
  if (!character) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "expected multipart form" },
      { status: 400 },
    );
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json(
      { error: `unsupported file type: ${file.type || "unknown"}` },
      { status: 400 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "file exceeds 25 MB" }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) {
    return NextResponse.json({ error: "empty file" }, { status: 400 });
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "file exceeds 25 MB" }, { status: 400 });
  }

  const sortOrder =
    character.images.reduce((m, i) => Math.max(m, i.sort_order), -1) + 1;
  const { outDir, originalPath, refPath, scratch } = characterUploadPaths(CHARACTER_MEDIA_DIR, id, file.name, sortOrder);
  let ownsScratch = false;
  try {
    const root = resolve(CHARACTER_MEDIA_DIR);
    if (await realpath(root) !== root) throw new Error('Unsafe character media root');
    for (const directory of [outDir, dirname(originalPath)]) {
      await mkdir(directory).catch((e) => { if (e.code !== 'EEXIST') throw e; });
      if (await realpath(directory) !== directory) throw new Error('Unsafe character media directory');
    }
    await mkdir(scratch);
    ownsScratch = true;
    await writeFile(originalPath, bytes, { flag: 'wx' });
    const stagedPath = join(scratch, 'reference.jpg');
    const norm = await normaliseCharacterReference(originalPath, stagedPath);
    // Atomic create-only commit: even a collision cannot alter historic bytes.
    await commitCharacterImage(stagedPath, refPath);
    const { pose, expression } = parsePoseFromFilename(file.name);
    const image = await addCharacterImage({
      character_id: id,
      image_path: refPath,
      original_path: originalPath,
      pose: (form.get("pose") as string | null)?.trim() || pose,
      expression:
        (form.get("expression") as string | null)?.trim() || expression,
      source_filename: file.name,
      width: norm.width,
      height: norm.height,
      byte_size: norm.byteSize,
      sort_order: sortOrder,
    });
    return NextResponse.json({ image }, { status: 201 });
  } catch {
    return NextResponse.json(
      {
        error: "Could not prepare this reference image. Check the image format and ask an admin to verify image storage. Existing images were not replaced.",
      },
      { status: 500 },
    );
  } finally {
    if (ownsScratch) await rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}
