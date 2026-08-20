export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, environments, assets } from "@/lib/db";
import { eq, and, or, isNull, inArray } from "drizzle-orm";

/**
 * GET /api/assets/environments
 *
 * Browse environments for job creation asset browser.
 * Filters by channel (and shows global environments with channel_id = null).
 *
 * Query params:
 * - channel_id (optional): Filter to channel-specific + global environments
 * - ids (optional): Comma-separated list of environment IDs to fetch
 * - format (optional): Not used for environments, but accepted for API consistency
 */
export async function GET(request: NextRequest) {
  // `/api/assets` is on the middleware bypass list, so this handler is the only
  // access control. Same permission as GET /api/assets and /api/assets/[id].
  const session = await getSession();
  if (!session || !hasPermission(session, "view:settings")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get("channel_id");
  const idsParam = searchParams.get("ids");

  try {
    // Parse IDs parameter if provided
    const ids = idsParam
      ? idsParam
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      : null;

    // Build where condition
    let whereCondition = undefined;

    // NEW: If IDs provided, filter by IDs (takes precedence)
    if (ids && ids.length > 0) {
      whereCondition = inArray(environments.id, ids);
    } else if (channelId) {
      // Otherwise apply channel filter
      whereCondition = or(
        eq(environments.channel_id, channelId),
        isNull(environments.channel_id),
      );
    }

    // Join with assets table to get background thumbnail
    const query = db
      .select({
        id: environments.id,
        name: environments.name,
        description: environments.description,
        archetype_id: environments.archetype_id,
        channel_id: environments.channel_id,
        background_asset_id: environments.background_asset_id,
        thumbnail_path: assets.file_path,
      })
      .from(environments)
      .leftJoin(assets, eq(environments.background_asset_id, assets.id))
      .where(whereCondition)
      .orderBy(environments.name);

    const results = await query;

    // Transform to asset browser format
    const environmentAssets = results.map((env) => ({
      id: env.id,
      name: env.name,
      description: env.description,
      type: "environments" as const,
      // Return thumbnail URL if background exists
      thumbnail: env.thumbnail_path
        ? `/api/assets/${env.background_asset_id}`
        : null,
    }));

    return NextResponse.json({ success: true, assets: environmentAssets });
  } catch (error) {
    console.error("Failed to fetch environments:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch environments", assets: [] },
      { status: 500 },
    );
  }
}
