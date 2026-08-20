import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getDriveHealth, probeDriveHealth } from "@repo/storage";

export const dynamic = "force-dynamic";

/**
 * GET /api/storage/drive/health          - cheap DB-only health (default)
 * GET /api/storage/drive/health?probe=1  - live probe (mints a token, reads
 *                                          the Drive storage quota)
 *
 * This is the seam the System Health page consumes. It owns the catalogue entry
 * and the card; it must read this struct, not reach into storage internals.
 *
 * consentPublishingStatus === "testing" MUST render as a WARNING: a Testing
 * consent screen revokes the refresh token after 7 days (the silent time-bomb).
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:jobs")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const probe = request.nextUrl.searchParams.get("probe") === "1";

  try {
    const health = probe
      ? await probeDriveHealth(db)
      : await getDriveHealth(db);
    return NextResponse.json(health);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to read Drive health",
      },
      { status: 500 },
    );
  }
}
