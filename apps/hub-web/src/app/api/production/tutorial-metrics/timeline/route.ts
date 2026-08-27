import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  getVaEventTimeline,
  getKnownVAs,
} from "@/lib/repositories/tutorial-step-metrics-repository";

export const dynamic = "force-dynamic";

/**
 * Per-VA daily event timeline for the Tutorial Studio Dashboard.
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
    90,
    Math.max(1, parseInt(url.searchParams.get("window") || "14", 10) || 14),
  );

  const [jobs, vas] = await Promise.all([
    getVaEventTimeline(windowDays),
    getKnownVAs(),
  ]);

  return NextResponse.json({ jobs, vas, windowDays });
}
