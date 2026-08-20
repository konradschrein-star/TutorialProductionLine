import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { startDaemon, isDaemonRunning } from "@/lib/vlm-daemon";

export const dynamic = "force-dynamic";

const StartSchema = z.object({ libraryId: z.string().uuid() });

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    if (isDaemonRunning()) {
      return NextResponse.json(
        { error: "Daemon is already running" },
        { status: 409 },
      );
    }

    const body = await req.json();
    const parsed = StartSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "libraryId required" },
        { status: 400 },
      );
    }

    const { pid } = startDaemon(parsed.data.libraryId);
    return NextResponse.json({ started: true, pid });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to start daemon";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
