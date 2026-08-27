import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { VERIFIED_37_SOFTWARES } from "@/lib/tutorial/seed-softwares";
import { ensure37KeywordsSeeded } from "../route";

export const dynamic = "force-dynamic";

export interface SoftwareAppSummary {
  software: string;
  total: number;
  toDo: number;
  inProgress: number;
  done: number;
  claimedBy: string | null;
}

/**
 * GET /api/production/keywords/seed/apps
 *
 * Returns summary stats per software application packet to render claimable app sections.
 */
export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Ensure DB contains strictly the 37 business software keywords and zero phone/gaming items
  await ensure37KeywordsSeeded();

  try {
    const queryResult = await db.execute<{
      software: string;
      status: string;
      claimed_by: string | null;
      n: number;
    }>(
      sql`
        SELECT software, status, claimed_by, COUNT(*)::int AS n
        FROM seed_keywords
        WHERE deleted_at IS NULL AND software IS NOT NULL
        GROUP BY software, status, claimed_by
        ORDER BY software ASC
      `,
    );

    const rows: Array<{
      software: string;
      status: string;
      claimed_by: string | null;
      n: number;
    }> = Array.isArray(queryResult)
      ? queryResult
      : Array.isArray((queryResult as { rows?: unknown[] })?.rows)
        ? ((queryResult as { rows: Array<{ software: string; status: string; claimed_by: string | null; n: number }> }).rows)
        : [];

    const map = new Map<string, SoftwareAppSummary>();


    // Initialize all 37 softwares
    for (const soft of VERIFIED_37_SOFTWARES) {
      map.set(soft, {
        software: soft,
        total: 0,
        toDo: 0,
        inProgress: 0,
        done: 0,
        claimedBy: null,
      });
    }

    for (const r of rows) {
      if (!map.has(r.software)) {
        map.set(r.software, {
          software: r.software,
          total: 0,
          toDo: 0,
          inProgress: 0,
          done: 0,
          claimedBy: null,
        });
      }
      const item = map.get(r.software)!;
      const count = Number(r.n) || 0;
      item.total += count;
      if (r.status === "NEW") {
        item.toDo += count;
      } else if (r.status === "IN_PROGRESS") {
        item.inProgress += count;
        if (r.claimed_by && !item.claimedBy) {
          item.claimedBy = r.claimed_by;
        }
      } else if (r.status === "DONE") {
        item.done += count;
      }
    }

    const apps = Array.from(map.values()).sort((a, b) =>
      a.software.localeCompare(b.software),
    );

    return NextResponse.json({
      apps,
      totalSoftwares: apps.length,
    });
  } catch (error) {
    console.error("Failed to fetch software apps summary:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
