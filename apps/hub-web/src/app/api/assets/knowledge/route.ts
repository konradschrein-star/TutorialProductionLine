export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, courses } from "@/lib/db";
import { eq, inArray, and } from "drizzle-orm";

/**
 * GET /api/assets/knowledge
 *
 * Browse knowledge/research content for job creation asset browser.
 * Returns published courses/videos that can be used as research references.
 *
 * Query params:
 * - channel_id (optional): Not used for knowledge, but accepted for API consistency
 * - format (optional): Not used for knowledge, but accepted for API consistency
 * - ids (optional): Comma-separated list of course IDs to fetch
 */
export async function GET(request: NextRequest) {
  // `/api/assets` is on the middleware bypass list, so this handler is the only
  // access control. Gated on view:knowledge (what this actually returns —
  // published courses) rather than view:settings, so knowledge-scoped roles
  // keep working.
  const session = await getSession();
  if (!session || !hasPermission(session, "view:knowledge")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
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
    const conditions = [eq(courses.is_published, true)];

    // NEW: If IDs provided, filter by IDs
    if (ids && ids.length > 0) {
      conditions.push(inArray(courses.id, ids));
    }

    // Get published courses with their chapters and videos
    const publishedCourses = await db
      .select({
        id: courses.id,
        title: courses.title,
        description: courses.description,
        thumbnail_key: courses.thumbnail_key,
      })
      .from(courses)
      .where(and(...conditions))
      .orderBy(courses.title);

    // Transform to asset browser format
    // For now, return courses as browsable items
    // In the future, could expand to show chapters/videos as nested items
    const knowledgeAssets = publishedCourses.map((course) => ({
      id: course.id,
      name: course.title,
      description: course.description,
      type: "knowledge" as const,
      // Return thumbnail URL if thumbnail_key exists
      thumbnail: course.thumbnail_key ? `/api/assets/${course.id}` : null,
    }));

    return NextResponse.json({ success: true, assets: knowledgeAssets });
  } catch (error) {
    console.error("Failed to fetch knowledge:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch knowledge", assets: [] },
      { status: 500 },
    );
  }
}
