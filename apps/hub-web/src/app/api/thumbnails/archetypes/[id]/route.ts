export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  getArchetype,
  updateArchetype,
  deleteArchetype,
} from "@/lib/repositories/thumbnail-studio-repository";

/**
 * GET    /api/thumbnails/archetypes/[id]
 * PATCH  /api/thumbnails/archetypes/[id]
 * DELETE /api/thumbnails/archetypes/[id]
 *
 * `channel_id: null` in a PATCH promotes an archetype to GLOBAL.
 */

const ASPECTS = ["16:9", "9:16", "1:1"] as const;
const RESOLUTIONS = ["1k", "2k", "4k"] as const;

const PatchSchema = z
  .object({
    name: z.string().min(1).max(120),
    channel_id: z.string().uuid().nullable(),
    description: z.string().max(2000).nullable(),
    reference_image_path: z.string().min(1),
    extra_reference_paths: z.array(z.string()).max(6),
    layout_instructions: z.string().max(4000).nullable(),
    base_prompt: z.string().max(4000).nullable(),
    features_logo: z.boolean(),
    category: z.string().max(80),
    formats: z.array(z.string()),
    aspect_ratio: z.enum(ASPECTS),
    resolution: z.enum(RESOLUTIONS),
    sort_order: z.number().int(),
    is_active: z.boolean(),
  })
  .partial();

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:settings")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const archetype = await getArchetype(id);
  if (!archetype) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ archetype });
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
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Empty patch" }, { status: 400 });
  }

  const { id } = await params;
  try {
    const archetype = await updateArchetype(id, parsed.data);
    if (!archetype) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ archetype });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to update archetype",
      },
      { status: 500 },
    );
  }
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
  const deleted = await deleteArchetype(id);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
