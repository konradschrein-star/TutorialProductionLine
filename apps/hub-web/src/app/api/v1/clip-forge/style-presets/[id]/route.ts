import type { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { withApiAuth } from "../../../_lib/auth";
import { db } from "@/lib/db";
import { cfStylePresets } from "@repo/db";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/v1/clip-forge/style-presets/:id
 *
 * Partial update. Any field not present in the body is left untouched.
 * Pass null to explicitly clear a nullable column.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withApiAuth(req, async () => {
    const body = (await req.json().catch(() => ({}))) as Partial<{
      name: string;
      persona_id: string | null;
      subtitle_style_id: string | null;
      caption_style_id: string | null;
      subtitle_style: Record<string, unknown> | null;
      caption_style: Record<string, unknown> | null;
      layout_options: Record<string, unknown>;
      safe_zones: Record<string, unknown>;
      phrase_length_ms: number | null;
      caption_y: number | null;
      subtitle_y: number | null;
      caption_size: number | null;
      subtitle_size: number | null;
      notes: string | null;
    }>;
    const patch: Record<string, unknown> = { updated_at: sql`now()` };
    const KEYS = [
      "name",
      "persona_id",
      "subtitle_style_id",
      "caption_style_id",
      "subtitle_style",
      "caption_style",
      "layout_options",
      "safe_zones",
      "phrase_length_ms",
      "caption_y",
      "subtitle_y",
      "caption_size",
      "subtitle_size",
      "notes",
    ] as const;
    for (const k of KEYS) {
      if (k in body) patch[k] = body[k];
    }
    const [preset] = await db
      .update(cfStylePresets)
      .set(patch)
      .where(eq(cfStylePresets.id, id))
      .returning();
    if (!preset) {
      return new Response(JSON.stringify({ error: "preset not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return { preset };
  });
}

/**
 * DELETE /api/v1/clip-forge/style-presets/:id
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withApiAuth(req, async () => {
    await db.delete(cfStylePresets).where(eq(cfStylePresets.id, id));
    return { ok: true };
  });
}
