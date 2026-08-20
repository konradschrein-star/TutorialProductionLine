export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  getThumbnail,
  setThumbnailPinned,
  deleteThumbnail,
} from "@/lib/repositories/thumbnail-studio-repository";

/**
 * GET    /api/thumbnails/item/[id]   single generated thumbnail
 * PATCH  /api/thumbnails/item/[id]   { pinned: boolean }
 * DELETE /api/thumbnails/item/[id]
 *
 * Lives under /item rather than /[id] so it does not collide with the
 * /[subjectKind]/[subjectId] route.
 */

const PatchSchema = z.object({ pinned: z.boolean() });

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:settings")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const thumbnail = await getThumbnail(id);
  if (!thumbnail) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ thumbnail });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { pinned }" }, { status: 400 });
  }
  const { id } = await params;
  const thumbnail = await setThumbnailPinned(id, parsed.data.pinned);
  if (!thumbnail) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ thumbnail });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const deleted = await deleteThumbnail(id);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
