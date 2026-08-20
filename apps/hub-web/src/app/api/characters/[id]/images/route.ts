export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
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
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) {
    return NextResponse.json({ error: "empty file" }, { status: 400 });
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "file exceeds 25 MB" }, { status: 400 });
  }

  const outDir = join(CHARACTER_MEDIA_DIR, id);
  const origDir = join(outDir, "originals");
  await mkdir(origDir, { recursive: true });

  const safeStem = basename(file.name, extname(file.name))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const sortOrder =
    character.images.reduce((m, i) => Math.max(m, i.sort_order), -1) + 1;
  const stamp = randomUUID().slice(0, 8);
  const originalPath = join(
    origDir,
    `${String(sortOrder).padStart(2, "0")}-${stamp}${extname(file.name).toLowerCase() || ".jpg"}`,
  );
  const refPath = join(
    outDir,
    `${String(sortOrder).padStart(2, "0")}-${safeStem || stamp}.jpg`,
  );

  const scratch = join(tmpdir(), `cf-char-${stamp}`);
  try {
    await writeFile(originalPath, bytes);
    const norm = await normaliseCharacterReference(originalPath, refPath);
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
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Could not prepare that image as an i2i reference: ${err.message}`
            : "normalisation failed",
      },
      { status: 500 },
    );
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}
