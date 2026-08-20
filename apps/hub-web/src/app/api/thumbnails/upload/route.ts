export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";

/**
 * POST /api/thumbnails/upload  (multipart/form-data)
 *
 * Uploads a reference thumbnail image used to seed a thumbnail archetype.
 * The file is written to
 *   THUMBNAIL_MEDIA_DIR/archetypes/<randomUUID>.<ext>
 * and the absolute path is returned so the caller can pass it straight
 * into POST /api/thumbnails/archetypes as `reference_image_path` (the
 * worker reads this path directly as an i2i reference).
 *
 * Fields: file (File, required, image/*).
 */

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "expected multipart form" },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    return NextResponse.json(
      { error: `unsupported file type: ${file.type || "unknown"}` },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) {
    return NextResponse.json({ error: "empty file" }, { status: 400 });
  }
  if (buffer.length > MAX_BYTES) {
    return NextResponse.json({ error: "file exceeds 20 MB" }, { status: 400 });
  }

  const mediaRoot =
    process.env["THUMBNAIL_MEDIA_DIR"] ?? "/opt/content-forge/media/thumbnails";
  const dir = join(mediaRoot, "archetypes");
  await mkdir(dir, { recursive: true });

  const ext = extname(file.name).replace(/^\./, "").toLowerCase() || "jpg";
  const fileName = `${randomUUID()}.${ext}`;
  const abs = join(dir, fileName);
  await writeFile(abs, buffer);

  return NextResponse.json({ path: abs });
}
