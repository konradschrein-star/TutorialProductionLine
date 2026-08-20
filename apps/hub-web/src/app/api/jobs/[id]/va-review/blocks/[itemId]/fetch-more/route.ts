import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { loadRankingJob } from "@/lib/va-review-job";
import { candidatesForItem } from "@/lib/ranking-blocks";

export const dynamic = "force-dynamic";

const MEDIA_ROOT =
  process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";

/**
 * POST /api/jobs/[id]/va-review/blocks/[itemId]/fetch-more
 *
 * v1 stub: the worker-side multi-candidate fetch is being built separately, so
 * this returns the item's current candidates unchanged with a `note`. The
 * endpoint exists so the UI can wire the button now; a follow-up will trigger a
 * live re-fetch (yt-dlp + Pexels) from the worker.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id, itemId } = await params;
  const loaded = await loadRankingJob(id);
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }

  const item = loaded.ranking.items.find((it) => it.id === itemId);
  if (!item) {
    return NextResponse.json(
      { error: `Item ${itemId} not found in ranking` },
      { status: 404 },
    );
  }

  return NextResponse.json({
    candidates: candidatesForItem(item, MEDIA_ROOT),
    note: "server-side fetch-more not yet wired",
  });
}
