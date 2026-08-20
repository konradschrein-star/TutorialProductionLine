export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  deleteCharacterImage,
  getCharacterImageById,
  setCharacterImageActive,
} from "@/lib/repositories/character-library-repository";

/**
 * PATCH  /api/characters/images/[imageId]   { is_active: boolean }
 * DELETE /api/characters/images/[imageId]
 *
 * Deactivating is the preferred operation: it removes an image from the
 * generation cycle while keeping the row (and therefore the record of what past
 * thumbnails were made from). Deleting is for genuine mistakes.
 *
 * NOTE: the file on disk is intentionally left in place on delete. A thumbnail
 * row's `reference_paths.persona` points at it, and a dangling path in the
 * history is a lie about what was generated.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ imageId: string }> },
) {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }
  const { imageId } = await params;
  const row = await getCharacterImageById(imageId);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: { is_active?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof body.is_active !== "boolean") {
    return NextResponse.json(
      { error: "is_active (boolean) is required" },
      { status: 400 },
    );
  }
  await setCharacterImageActive(imageId, body.is_active);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ imageId: string }> },
) {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }
  const { imageId } = await params;
  const row = await getCharacterImageById(imageId);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await deleteCharacterImage(imageId);
  return NextResponse.json({ ok: true });
}
