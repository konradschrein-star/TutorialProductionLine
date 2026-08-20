import type { NextRequest } from "next/server";
import { and, desc, eq, gte } from "drizzle-orm";
import { withApiAuth } from "../../_lib/auth";
import { db } from "@/lib/db";
import { cfRawClips } from "@repo/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/clip-forge/raw-clips?persona=&minScore=&status=&limit=&offset=
 */
export async function GET(req: NextRequest) {
  return withApiAuth(req, async () => {
    const url = req.nextUrl;
    const personaId = url.searchParams.get("persona");
    const status = url.searchParams.get("status");
    const minScore = Number(url.searchParams.get("minScore") ?? 0);
    const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));

    const conditions = [gte(cfRawClips.clip_score, minScore)];
    if (personaId) conditions.push(eq(cfRawClips.persona_id, personaId));
    if (status)
      conditions.push(
        eq(
          cfRawClips.status,
          status as
            | "detected"
            | "rendering"
            | "ready"
            | "rejected"
            | "cancelled",
        ),
      );

    const clips = await db
      .select()
      .from(cfRawClips)
      .where(and(...conditions))
      .orderBy(desc(cfRawClips.clip_score))
      .limit(limit)
      .offset(offset);
    return { clips, limit, offset };
  });
}
