import type { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { withApiAuth } from "../../_lib/auth";
import { db } from "@/lib/db";
import { cfAccounts } from "@repo/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/clip-forge/accounts
 * POST /api/v1/clip-forge/accounts
 *   Body: { persona_id, platform, handle, variant_seed?, posts_per_day?,
 *           proxy_endpoint?, browser_profile_id?, niche? }
 */
export async function GET(req: NextRequest) {
  return withApiAuth(req, async () => {
    const rows = await db
      .select()
      .from(cfAccounts)
      .orderBy(desc(cfAccounts.created_at));
    return { accounts: rows };
  });
}

export async function POST(req: NextRequest) {
  return withApiAuth(req, async () => {
    const body = (await req.json().catch(() => ({}))) as {
      persona_id?: string;
      platform?: "tiktok" | "instagram" | "youtube_shorts";
      handle?: string;
      variant_seed?: number;
      posts_per_day?: number;
      proxy_endpoint?: string;
      browser_profile_id?: string;
      niche?:
        | "wisdom"
        | "funny"
        | "controversial"
        | "story"
        | "educational"
        | "hot_take"
        | "hype"
        | "insight"
        | "reaction"
        | "rant"
        | "wholesome"
        | "other";
    };
    if (!body.persona_id || !body.platform || !body.handle) {
      return new Response(
        JSON.stringify({
          error: "persona_id, platform, and handle are required",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    const [account] = await db
      .insert(cfAccounts)
      .values({
        persona_id: body.persona_id,
        platform: body.platform,
        handle: body.handle,
        variant_seed:
          body.variant_seed ?? Math.floor(Math.random() * 9000) + 1000,
        posts_per_day: body.posts_per_day ?? 1,
        proxy_endpoint: body.proxy_endpoint ?? null,
        browser_profile_id: body.browser_profile_id ?? null,
        niche: body.niche ?? null,
        active: true,
      })
      .returning();
    return { account };
  });
}
