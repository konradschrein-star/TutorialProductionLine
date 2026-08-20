import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  getVAStepDurations,
  getScriptTimeByDow,
  getIntradayProduction,
} from "@/lib/repositories/tutorial-step-metrics-repository";

export const dynamic = "force-dynamic";

/**
 * Industry-4.0 step metrics for the Tutorial Studio Dashboard:
 * per-VA step durations + bottleneck, scripting-time by day-of-week, and the
 * per-event production timeline (a dot per keyword-claim / audio / recording /
 * completion). Read-only.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const windowDays = Math.min(
    365,
    Math.max(1, parseInt(url.searchParams.get("window") || "28", 10) || 28),
  );

  const [steps, dow, intraday] = await Promise.all([
    getVAStepDurations(windowDays),
    getScriptTimeByDow(90),
    getIntradayProduction(windowDays),
  ]);

  return NextResponse.json({ steps, dow, intraday, windowDays });
}
