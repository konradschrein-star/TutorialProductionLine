import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { getVaEventTimeline } from "@/lib/repositories/tutorial-step-metrics-repository";

export const dynamic = "force-dynamic";

/**
 * Per-VA daily event timeline for the Tutorial Studio Dashboard.
 *
 * Returns every original job in the window with its VA-action timestamps
 * (created = render/generate, recorded = upload, completed = finish). The client
 * plots each as an event on a 24h-per-day axis so the owner can read the VA's
 * real working window, the noon-pause length, and videos-per-day. Read-only,
 * `view:production` gated. Kept separate from /tutorial-metrics so its larger
 * row-level payload does not slow the main metrics load.
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

  const jobs = await getVaEventTimeline(windowDays);
  return NextResponse.json({ jobs, windowDays });
}
