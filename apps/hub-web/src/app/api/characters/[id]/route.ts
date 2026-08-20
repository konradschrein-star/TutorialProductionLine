import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { getCharacterWithStates } from "@/lib/repositories/character-repository";
import { updateCharacter } from "@/lib/repositories/character-library-repository";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:settings")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }
  const { id } = await params;
  const character = await getCharacterWithStates(id);
  if (!character)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ character });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }
  const { id } = await params;
  try {
    const body = await request.json();
    // channel_id is derived from character_channels by a DB trigger — never
    // settable here. Use PUT /api/characters/[id]/channels.
    const character = await updateCharacter(id, {
      ...(typeof body.name === "string" ? { name: body.name.trim() } : {}),
      ...(typeof body.description === "string"
        ? { description: body.description.trim() }
        : {}),
      ...(typeof body.role === "string" ? { role: body.role } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(typeof body.is_active === "boolean"
        ? { is_active: body.is_active }
        : {}),
    });
    if (!character)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ character });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to update character",
      },
      { status: 500 },
    );
  }
}
