import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  upsertWatchProgress,
  getWatchProgress,
} from "@/lib/repositories/knowledge-repository";

export const dynamic = "force-dynamic";

const ProgressBody = z.object({
  videoId: z.string().uuid(),
  lastPositionSeconds: z.number().int().min(0),
  isCompleted: z.boolean(),
});

/**
 * POST /api/knowledge/progress
 *
 * Upserts per-user watch progress for a video.
 * Called by the client player on timeupdate (debounced) and on completion.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:knowledge")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid JSON in request body",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }

  const parsed = ProgressBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request body format",
        details: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const { videoId, lastPositionSeconds, isCompleted } = parsed.data;

  const progress = await upsertWatchProgress(
    session.userId,
    videoId,
    lastPositionSeconds,
    isCompleted,
  );

  return NextResponse.json({ progress });
}

/**
 * GET /api/knowledge/progress?videoId=<uuid>
 *
 * Returns current watch progress for a video (for the requesting user).
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:knowledge")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const videoId = request.nextUrl.searchParams.get("videoId");
  if (!videoId) {
    return NextResponse.json({ error: "Missing videoId" }, { status: 400 });
  }

  const progress = await getWatchProgress(session.userId, videoId);
  return NextResponse.json({ progress });
}
