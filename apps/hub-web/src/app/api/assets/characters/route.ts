export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, characters, assets } from "@/lib/db";
import { eq, and, or, isNull, inArray } from "drizzle-orm";

/**
 * GET /api/assets/characters
 *
 * Browse characters for job creation asset browser.
 * Filters by channel (and shows global characters with channel_id = null).
 *
 * Query params:
 * - channel_id (optional): Filter to channel-specific + global characters
 * - ids (optional): Comma-separated list of character IDs to fetch
 * - format (optional): Not used for characters, but accepted for API consistency
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

    // Build where conditions
    const conditions = [eq(characters.is_active, true)];

    // NEW: If IDs provided, filter by IDs (takes precedence)
    if (ids && ids.length > 0) {
      conditions.push(inArray(characters.id, ids));
    } else if (channelId) {
      // Otherwise apply channel filter
      conditions.push(
        or(
          eq(characters.channel_id, channelId),
          isNull(characters.channel_id),
        )!,
      );
    }

    // Join with assets table to get reference sheet thumbnail
    const query = db
      .select({
        id: characters.id,
        name: characters.name,
        description: characters.description,
        archetype_id: characters.archetype_id,
        channel_id: characters.channel_id,
        reference_sheet_asset_id: characters.reference_sheet_asset_id,
        thumbnail_path: assets.file_path,
      })
      .from(characters)
      .leftJoin(assets, eq(characters.reference_sheet_asset_id, assets.id))
      .where(and(...conditions))
      .orderBy(characters.name);

    const results = await query;

    // Transform to asset browser format
    const characterAssets = results.map((char) => ({
      id: char.id,
      name: char.name,
      description: char.description,
      type: "characters" as const,
      // Return thumbnail URL if reference sheet exists
      thumbnail: char.thumbnail_path
        ? `/api/assets/${char.reference_sheet_asset_id}`
        : null,
    }));

    return NextResponse.json({ success: true, assets: characterAssets });
  } catch (error) {
    console.error("Failed to fetch characters:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch characters", assets: [] },
      { status: 500 },
    );
  }
}
