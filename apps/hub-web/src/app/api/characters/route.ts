import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { listCharacters } from "@/lib/repositories/character-repository";
import { createCharacter } from "@/lib/repositories/character-library-repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:settings")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }
  const { searchParams } = request.nextUrl;
  const characters = await listCharacters({
    channel_id: searchParams.get("channel_id") ?? undefined,
    archetype_id: searchParams.get("archetype_id") ?? undefined,
    active_only: searchParams.get("active_only") === "true",
  });
  return NextResponse.json({ characters });
}

/**
 * POST /api/characters — create a character.
 *
 * `channel_id` is deliberately NOT accepted: channel binding is owned by
 * `character_channels` (PUT /api/characters/[id]/channels) and
 * `characters.channel_id` is derived from it by a database trigger. Accepting
 * it here would let a caller believe they had bound a channel when they had not.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }
  try {
    const body = await request.json();
    if (!body?.name?.trim() || !body?.description?.trim()) {
      return NextResponse.json(
        { error: "name and description are required" },
        { status: 400 },
      );
    }
    const character = await createCharacter({
      name: String(body.name).trim(),
      description: String(body.description).trim(),
      role: body.role === "cast" ? "cast" : "host",
      notes: body.notes ? String(body.notes) : null,
    });
    return NextResponse.json({ character }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to create character",
      },
      { status: 500 },
    );
  }
}
