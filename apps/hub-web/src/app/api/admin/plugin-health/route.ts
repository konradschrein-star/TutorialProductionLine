import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { getAvailableFormats } from "@/app/actions/formats";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:system-health")) {
    return NextResponse.json(
      { error: "Unauthorized - Admin permission required" },
      { status: 401 },
    );
  }

  const formats = await getAvailableFormats();

  return NextResponse.json({
    formats: formats.map((f) => ({
      id: f.id,
      name: f.name,
      version: f.version,
      enabled: true,
    })),
    timestamp: new Date().toISOString(),
  });
}
