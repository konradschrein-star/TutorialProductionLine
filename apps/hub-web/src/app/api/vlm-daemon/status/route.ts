import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getDaemonStatus, getDaemonLogs } from "@/lib/vlm-daemon";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    if (!session)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const status = getDaemonStatus();
    const logs = getDaemonLogs(60);
    return NextResponse.json({ ...status, logs });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
