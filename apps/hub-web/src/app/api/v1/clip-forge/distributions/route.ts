import type { NextRequest } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { withApiAuth } from "../../_lib/auth";
import { db } from "@/lib/db";
import { cfDistributions } from "@repo/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/clip-forge/distributions?account=&platform=&status=&limit=&offset=
 */
export async function GET(req: NextRequest) {
  return withApiAuth(req, async () => {
    const url = req.nextUrl;
    const accountId = url.searchParams.get("account");
    const platform = url.searchParams.get("platform");
    const status = url.searchParams.get("status");
    const limit = Math.min(500, Number(url.searchParams.get("limit") ?? 100));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));

    const conditions = [] as Array<ReturnType<typeof eq>>;
    if (accountId) conditions.push(eq(cfDistributions.account_id, accountId));
    if (platform)
      conditions.push(
        eq(
          cfDistributions.platform,
          platform as "tiktok" | "instagram" | "youtube_shorts",
        ),
      );
    if (status)
      conditions.push(
        eq(
          cfDistributions.status,
          status as
            | "pooled"
            | "assigned"
            | "rendered"
            | "qc_pass"
            | "qc_flag"
            | "qc_fail"
            | "queued"
            | "uploaded"
            | "live"
            | "failed"
            | "skipped"
            | "cancelled",
        ),
      );

    const distributions = await db
      .select()
      .from(cfDistributions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(cfDistributions.created_at))
      .limit(limit)
      .offset(offset);
    return { distributions, limit, offset };
  });
}
