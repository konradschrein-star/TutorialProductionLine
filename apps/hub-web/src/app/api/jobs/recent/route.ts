export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { getRecentJobsByFormat } from "@/lib/repositories/format-repository";

/**
 * GET /api/jobs/recent?format=EXPLAINER&limit=20
 *
 * Polling endpoint for the format workstation's recent jobs table.
 * Returns minimal job data for live progress tracking.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:jobs")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const format = req.nextUrl.searchParams.get("format");
  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10),
    50,
  );

  if (!format) {
    return NextResponse.json({ error: "format is required" }, { status: 400 });
  }

  const jobs = await getRecentJobsByFormat(format, limit);

  return NextResponse.json(
    jobs.map((j) => ({
      id: j.id,
      title: j.title,
      status: j.status,
      channel_name: j.channel_name,
      template_name: j.template_name,
      created_at: j.created_at.toISOString(),
      updated_at: j.updated_at.toISOString(),
    })),
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
