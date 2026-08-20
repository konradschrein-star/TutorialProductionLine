export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { getArchetype } from "@/lib/repositories/thumbnail-studio-repository";

/**
 * GET /api/thumbnails/archetypes/[id]/image?i=<n>
 *
 * Serves an archetype's reference image. `i=0` (default) is the primary
 * reference; `i=1..n` index into `extra_reference_paths`.
 *
 * The path is read from the DB, never from user input, so this cannot be used
 * for path traversal — the only thing a caller controls is which archetype.
 */

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  // Read-only: the archetype preview shown in the thumbnail picker.
  if (
    !session ||
    (!hasPermission(session, "view:settings") &&
      !hasPermission(session, "manage:thumbnails"))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const archetype = await getArchetype(id);
  if (!archetype) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const index = Number(req.nextUrl.searchParams.get("i") ?? "0");
  const path =
    index > 0
      ? archetype.extra_reference_paths[index - 1]
      : archetype.reference_image_path;
  if (!path) {
    return NextResponse.json({ error: "No such reference" }, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(path);
  } catch {
    // Surfaced rather than swallowed: a missing reference file is exactly what
    // makes a generation silently produce a wrong-looking thumbnail.
    return NextResponse.json(
      { error: `Reference file missing on disk: ${path}` },
      { status: 404 },
    );
  }

  // D2: a per-preset Download action asks for the file as an attachment rather
  // than an inline image.
  const asDownload = req.nextUrl.searchParams.get("download") === "1";
  const ext = extname(path).toLowerCase() || ".jpg";
  const safeName =
    `${archetype.name}`
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "preset";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": CONTENT_TYPES[ext] ?? "image/jpeg",
      "Cache-Control": "private, max-age=3600",
      ...(asDownload
        ? { "Content-Disposition": `attachment; filename="${safeName}${ext}"` }
        : {}),
    },
  });
}
