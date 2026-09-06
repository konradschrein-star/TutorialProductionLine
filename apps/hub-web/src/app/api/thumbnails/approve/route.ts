export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, thumbnails } from "@/lib/db";

const Body = z.object({ thumbnailIds: z.array(z.string().uuid()).min(1).max(20) });

/** Marks rendered, video-bound thumbnails ready for the Drive/uploader lane. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || (!hasPermission(session, "manage:thumbnails") && !hasPermission(session, "edit:settings"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Expected thumbnailIds" }, { status: 400 });

  const rows = await db
    .update(thumbnails)
    .set({ review_verdict: "acceptable", reviewed_at: new Date(), updated_at: new Date() })
    .where(inArray(thumbnails.id, parsed.data.thumbnailIds))
    .returning({ id: thumbnails.id, subjectId: thumbnails.subject_id });
  return NextResponse.json({ approved: rows });
}
