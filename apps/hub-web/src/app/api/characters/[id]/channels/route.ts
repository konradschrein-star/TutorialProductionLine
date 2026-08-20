export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  getCharacterWithImages,
  setCharacterChannels,
} from "@/lib/repositories/character-library-repository";

/**
 * PUT /api/characters/[id]/channels
 * Body: { channels: [{ channel_id, role?, is_primary? }] }
 *
 * Replaces the character's channel bindings. `character_channels` is the
 * AUTHORITATIVE binding — `characters.channel_id` is derived from it by a
 * database trigger, so there is nothing else to keep in step.
 *
 * A channel can have at most ONE primary host (partial unique index). A clash
 * surfaces as a 409 naming the constraint rather than silently rebinding a face
 * out from under another channel.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }
  const { id } = await params;
  if (!(await getCharacterWithImages(id))) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  let body: {
    channels?: Array<{
      channel_id: string;
      role?: string;
      is_primary?: boolean;
    }>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const bindings = (body.channels ?? []).filter((b) => !!b.channel_id);

  try {
    await setCharacterChannels(id, bindings);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/idx_character_channels_one_primary_host/.test(msg)) {
      return NextResponse.json(
        {
          error:
            "One of those channels already has a different primary host " +
            "character. Unbind it there first — a channel resolving two faces " +
            "is exactly the ambiguity this constraint exists to prevent.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const character = await getCharacterWithImages(id);
  return NextResponse.json({ character });
}
