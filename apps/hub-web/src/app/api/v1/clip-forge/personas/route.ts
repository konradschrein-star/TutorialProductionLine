import type { NextRequest } from "next/server";
import { withApiAuth } from "../../_lib/auth";
import { db } from "@/lib/db";
import { cfPersonas } from "@repo/db";

export const dynamic = "force-dynamic";

/**
 * GET  /api/v1/clip-forge/personas — list all personas
 * POST /api/v1/clip-forge/personas — create one
 *   { name, rights_confirmed?, payout_model?, payout_rate?, face_detection_hints? }
 */
export async function GET(req: NextRequest) {
  return withApiAuth(req, async () => {
    const rows = await db.select().from(cfPersonas);
    return { personas: rows };
  });
}

export async function POST(req: NextRequest) {
  return withApiAuth(req, async () => {
    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      rights_confirmed?: boolean;
      payout_model?: "per_view" | "per_clip" | "flat";
      payout_rate?: number;
      face_detection_hints?: Record<string, unknown>;
      default_language?: string;
    };
    if (!body.name) {
      return new Response(JSON.stringify({ error: "name is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const [persona] = await db
      .insert(cfPersonas)
      .values({
        name: body.name,
        rights_confirmed: body.rights_confirmed ?? false,
        payout_model: body.payout_model ?? "per_view",
        payout_rate: body.payout_rate ?? 0,
        face_detection_hints: body.face_detection_hints ?? {},
        default_language: (body.default_language ?? "en")
          .toLowerCase()
          .slice(0, 8),
      })
      .returning();
    return { persona };
  });
}
