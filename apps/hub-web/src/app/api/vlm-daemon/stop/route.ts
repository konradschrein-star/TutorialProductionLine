import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { stopDaemon, isDaemonRunning } from "@/lib/vlm-daemon";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await getSession();
    if (!session)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    if (!isDaemonRunning()) {
      return NextResponse.json(
        { error: "Daemon is not running" },
        { status: 409 },
      );
    }

    stopDaemon();
    return NextResponse.json({ stopped: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to stop daemon";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
