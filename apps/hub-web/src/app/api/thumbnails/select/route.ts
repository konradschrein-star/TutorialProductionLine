export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { selectThumbnail, getThumbnailById } from "@repo/db";

/**
 * POST /api/thumbnails/select   { thumbnailId }
 *
 * "Use this one." Marks a thumbnail as the chosen one for its subject and
 * clears the flag on its siblings — the uploader pipeline reads
 * `is_selected = true`.
 *
 * This action had NO route and NO caller anywhere in the app before now:
 * `selectThumbnail()` has existed in the repository since the schema landed
 * with zero call sites, so `is_selected` could only ever be written by the
 * automatic rule (selectBestThumbnailForSubject). A human looking at three
 * generated thumbnails had no way to say which one ships.
 */

const Body = z.object({ thumbnailId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (
    !session ||
    (!hasPermission(session, "manage:thumbnails") &&
      !hasPermission(session, "edit:settings"))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Expected { thumbnailId }" },
      { status: 400 },
    );
  }

  const existing = await getThumbnailById(db, parsed.data.thumbnailId);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Only a rendered thumbnail can ship. Selecting a failed/generating row
  // would set is_selected on something with no output_path, and the uploader
  // would publish a video with no thumbnail at all.
  if (existing.status !== "completed" || !existing.output_path) {
    return NextResponse.json(
      {
        error: `Thumbnail is ${existing.status} with no rendered file — only a completed thumbnail can be selected.`,
      },
      { status: 400 },
    );
  }

  const thumbnail = await selectThumbnail(db, parsed.data.thumbnailId);
  return NextResponse.json({ thumbnail });
}
