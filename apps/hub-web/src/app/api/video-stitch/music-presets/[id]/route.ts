import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { musicPresets } from "@repo/db";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/video-stitch/music-presets/[id]
 * Delete a music preset
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission(session, "create:job")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    await db
      .delete(musicPresets)
      .where(
        and(eq(musicPresets.id, id), eq(musicPresets.user_id, session.userId)),
      );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to delete music preset", err);
    return NextResponse.json(
      { error: "Failed to delete preset" },
      { status: 500 },
    );
  }
}
