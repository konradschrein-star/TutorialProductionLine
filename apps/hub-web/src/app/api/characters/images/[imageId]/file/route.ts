export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { getCharacterImageById } from "@/lib/repositories/character-library-repository";
import { resolveCharacterImagePath } from '@/lib/characters/image-path';

/**
 * GET /api/characters/images/[imageId]/file
 *
 * Serves a character reference image. The path is read from the DB row, never
 * from the URL, so there is no traversal surface.
 */
const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ imageId: string }> },
) {
  const session = await getSession();
  if (
    !session ||
    (!hasPermission(session, "view:settings") &&
      !hasPermission(session, "manage:thumbnails"))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { imageId } = await params;
  const row = await getCharacterImageById(imageId);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let buffer: Buffer;
  try {
    const path = await resolveCharacterImagePath(process.env.CHARACTER_MEDIA_DIR ?? '/opt/content-forge/media/characters', row.image_path);
    buffer = await readFile(path);
  } catch {
    return NextResponse.json(
      { error: 'Character image unavailable. Ask an admin to check the preserved image.', code: 'CHARACTER_IMAGE_UNAVAILABLE' },
      { status: 404 },
    );
  }
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        CONTENT_TYPES[extname(row.image_path).toLowerCase()] ?? "image/jpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
