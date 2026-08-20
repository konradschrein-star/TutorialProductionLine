import type { NextRequest } from "next/server";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { withApiAuth } from "../../_lib/auth";
import { db } from "@/lib/db";
import { cfStylePresets } from "@repo/db";

export const dynamic = "force-dynamic";

/**
 * GET  /api/v1/clip-forge/style-presets?persona=<uuid>
 *      Lists global presets + presets scoped to the given persona.
 * POST /api/v1/clip-forge/style-presets
 *      Body: { name, persona_id?, subtitle_style_id?, caption_style_id?,
 *              layout_options?, caption_y?, subtitle_y?, caption_size?,
 *              subtitle_size?, notes? }
 */
export async function GET(req: NextRequest) {
  return withApiAuth(req, async () => {
    const personaId = req.nextUrl.searchParams.get("persona");
    const rows = await db
      .select()
      .from(cfStylePresets)
      .where(
        personaId
          ? or(
              eq(cfStylePresets.persona_id, personaId),
              isNull(cfStylePresets.persona_id),
            )
          : undefined,
      )
      .orderBy(desc(cfStylePresets.created_at));
    return { presets: rows };
  });
}

export async function POST(req: NextRequest) {
  return withApiAuth(req, async () => {
    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      persona_id?: string | null;
      subtitle_style_id?: string;
      caption_style_id?: string;
      subtitle_style?: Record<string, unknown>;
      caption_style?: Record<string, unknown>;
      layout_options?: Record<string, unknown>;
      safe_zones?: Record<string, unknown>;
      phrase_length_ms?: number;
      caption_y?: number;
      subtitle_y?: number;
      caption_size?: number;
      subtitle_size?: number;
      notes?: string;
    };
    if (!body.name?.trim()) {
      return new Response(JSON.stringify({ error: "name is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const [preset] = await db
      .insert(cfStylePresets)
      .values({
        name: body.name.trim().slice(0, 128),
        persona_id: body.persona_id ?? null,
        subtitle_style_id: body.subtitle_style_id ?? null,
        caption_style_id: body.caption_style_id ?? null,
        subtitle_style: body.subtitle_style ?? null,
        caption_style: body.caption_style ?? null,
        layout_options: body.layout_options ?? {},
        safe_zones: body.safe_zones ?? {},
        phrase_length_ms: body.phrase_length_ms ?? null,
        caption_y: body.caption_y ?? null,
        subtitle_y: body.subtitle_y ?? null,
        caption_size: body.caption_size ?? null,
        subtitle_size: body.subtitle_size ?? null,
        notes: body.notes ?? null,
      })
      .returning();
    return { preset };
  });
}
