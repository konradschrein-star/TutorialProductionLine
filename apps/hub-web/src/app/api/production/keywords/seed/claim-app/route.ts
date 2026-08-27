import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/production/keywords/seed/claim-app
 *
 * Batch claim or release all keywords for an entire software app packet.
 * Enables VAs to take ownership of an entire tool (e.g. Xero, Make, Notion) as a whole.
 *
 * Body: { software: string, action: "claim" | "release" }
 */
export async function POST(request: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "create:tutorial-job")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as {
      software?: string;
      action?: "claim" | "release";
    };
    const software = (body.software ?? "").trim();
    const action = body.action ?? "claim";

    if (!software) {
      return NextResponse.json(
        { error: "software name is required" },
        { status: 400 },
      );
    }

    const claimedBy = session.email ?? session.userId ?? "va";

    if (action === "claim") {
      const res = await db.execute(sql`
        UPDATE seed_keywords
        SET status = 'IN_PROGRESS',
            claimed_by = ${claimedBy},
            claimed_at = now()
        WHERE software = ${software}
          AND status = 'NEW'
          AND deleted_at IS NULL
      `);
      return NextResponse.json({
        success: true,
        software,
        action: "claim",
        claimedBy,
      });
    } else {
      const res = await db.execute(sql`
        UPDATE seed_keywords
        SET status = 'NEW',
            claimed_by = NULL,
            claimed_at = NULL
        WHERE software = ${software}
          AND status = 'IN_PROGRESS'
          AND deleted_at IS NULL
      `);
      return NextResponse.json({
        success: true,
        software,
        action: "release",
      });
    }
  } catch (error) {
    console.error("Failed to batch claim/release software app:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown server error",
      },
      { status: 500 },
    );
  }
}
