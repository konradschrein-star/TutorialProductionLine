export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  listThumbnailLibrary,
  countThumbnails,
} from "@/lib/repositories/thumbnail-studio-repository";

/**
 * GET /api/thumbnails/library
 *   ?scope=all|global|<channelId>
 *   &archetypeId=<uuid>
 *   &completedOnly=true      only rows with a rendered file
 *   &pinnedOnly=true
 *   &limit=60&offset=0
 *
 * Newest-first history of generated thumbnails. Backs both the Studio history
 * view and the "reuse an existing thumbnail as a reference" picker.
 *
 * Failed rows are returned too (unless completedOnly) and carry their
 * error_message — a failed generation must be visible, not hidden. Every
 * thumbnail in production has been failing silently since 2026-07-17 precisely
 * because nothing surfaced them.
 */

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:settings")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const scope = sp.get("scope") ?? "all";
  const completedOnly = sp.get("completedOnly") === "true";
  const limit = Number(sp.get("limit") ?? "60");
  const offset = Number(sp.get("offset") ?? "0");

  const [thumbnails, total] = await Promise.all([
    listThumbnailLibrary({
      scope,
      ...(sp.get("archetypeId") ? { archetypeId: sp.get("archetypeId")! } : {}),
      completedOnly,
      pinnedOnly: sp.get("pinnedOnly") === "true",
      limit: Number.isFinite(limit) ? limit : 60,
      offset: Number.isFinite(offset) ? offset : 0,
    }),
    countThumbnails({ scope, completedOnly }),
  ]);

  return NextResponse.json({ thumbnails, total });
}
