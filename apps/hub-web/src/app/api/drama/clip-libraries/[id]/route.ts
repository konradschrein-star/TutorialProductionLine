import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth/jwt";
import { getClipLibraryById, updateClipLibrary } from "@repo/db/repositories";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/drama/clip-libraries/[id]
 *
 * Body: { name, character_block, script_prompt, music_mode, music_volume_db }
 *
 * Accepts the drama subset of clip_libraries columns (the original
 * clip-pipeline system's columns are managed elsewhere).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = (await cookies()).get("hub_session")?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await verifyToken(token);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }
  const existing = await getClipLibraryById(id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<{
    name: string;
    character_block: string;
    script_prompt: string;
    music_mode: "generate" | "library";
    music_volume_db: number;
    use_reference_scripts: boolean;
  }>;

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name.slice(0, 120);
  if (typeof body.character_block === "string") {
    patch.character_block = body.character_block.slice(0, 8000);
  }
  if (typeof body.script_prompt === "string") {
    patch.script_prompt = body.script_prompt.slice(0, 16000);
  }
  if (body.music_mode === "generate" || body.music_mode === "library") {
    patch.music_mode = body.music_mode;
  }
  if (typeof body.music_volume_db === "number") {
    const clamped = Math.max(
      -60,
      Math.min(0, Math.round(body.music_volume_db)),
    );
    patch.music_volume_db = clamped;
  }
  if (typeof body.use_reference_scripts === "boolean") {
    patch.use_reference_scripts = body.use_reference_scripts;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  await updateClipLibrary(id, patch);
  const updated = await getClipLibraryById(id);
  return NextResponse.json({ ok: true, library: updated });
}
