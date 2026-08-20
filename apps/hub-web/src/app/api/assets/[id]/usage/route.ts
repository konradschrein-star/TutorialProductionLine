import { NextRequest, NextResponse } from "next/server";
import { getAssetUsage } from "@/lib/repositories/asset-repository";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

/**
 * GET /api/assets/[id]/usage?limit=50&offset=0
 *
 * Returns paginated usage information for a media asset:
 * - Total number of jobs using this asset
 * - Paginated list of jobs with details (id, title, status, format, template_name, created_at)
 * - has_more flag indicating if more results exist
 *
 * Query parameters:
 * - limit: Max results per page (default: 50, max: 200)
 * - offset: Number of results to skip (default: 0)
 *
 * Used by the media library to show usage badges and prevent accidental deletion
 * of assets that are actively used in jobs.
 *
 * Returns 200 with usage data or 404 if asset not found.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Auth check
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: assetId } = await params;

    // Parse pagination parameters
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(
      parseInt(searchParams.get("limit") || "50", 10),
      200,
    );
    const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10), 0);

    // Get paginated usage data
    const usage = await getAssetUsage(assetId, { limit, offset });

    return NextResponse.json(usage, { status: 200 });
  } catch (error) {
    console.error("Asset usage API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
