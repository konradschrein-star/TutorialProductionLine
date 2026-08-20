import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { loadRankingJob } from "@/lib/va-review-job";
import { buildBlocks, toMediaUrl } from "@/lib/ranking-blocks";
import {
  backfillCandidateDurations,
  findDuplicateIndices,
} from "@/lib/va-review-candidate-identity";

export const dynamic = "force-dynamic";

const MEDIA_ROOT =
  process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";

/**
 * GET /api/jobs/[id]/va-review
 *
 * Full session payload for the B-Roll Selection Studio.
 * → { job:{id,topic,status}, narration:{ audioUrl, wordTimestamps },
 *     blocks: [ Block ] }
 * Block order = reveal order. All media URLs rewritten to /api/media/...
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const loaded = await loadRankingJob(id);
  if (!loaded.ok) {
    return NextResponse.json(
      { error: loaded.error },
      { status: loaded.status },
    );
  }

  const { job, ranking } = loaded;

  // Probe any candidate stored without a duration BEFORE building blocks — the
  // selection fit clamps segments to their source length, and the studio sizes
  // each source row's time scale from it. An unknown duration made a row
  // undraggable (maxStart collapses to 0) and mis-scaled its filmstrip.
  await Promise.all(
    ranking.items.map((item) =>
      item.footageCandidates
        ? backfillCandidateDurations(item.footageCandidates, MEDIA_ROOT)
        : Promise.resolve(),
    ),
  );

  const blocks = buildBlocks(ranking, MEDIA_ROOT);

  // Flag source rows that are byte-identical to an earlier row. Two paths
  // (create-time upload pool + yt-dlp fetch, or a pasted URL) regularly land
  // the SAME video twice under different filenames, which made "Timeline 1"
  // and "Timeline 2" indistinguishable on screen and in the render. We label
  // rather than collapse: segment.candidateIndex and the renderer both address
  // the raw `footageCandidates` array by index, so reindexing on read would
  // desync the studio from the render.
  const byItemId = new Map(ranking.items.map((it) => [it.id, it]));
  await Promise.all(
    blocks.map(async (block) => {
      const item = byItemId.get(block.itemId);
      const raw = item?.footageCandidates;
      if (!raw || raw.length < 2) return;
      const dupes = await findDuplicateIndices(raw, MEDIA_ROOT);
      block.candidates.forEach((cand, i) => {
        const of = dupes[i];
        if (of !== undefined) cand.duplicateOfIndex = of;
      });
    }),
  );

  return NextResponse.json({
    job: {
      id: job.id,
      topic: ranking.topic ?? job.title ?? "",
      status: job.status,
    },
    narration: {
      audioUrl: toMediaUrl(ranking.audioUrl, MEDIA_ROOT) ?? null,
      wordTimestamps: ranking.wordTimestamps ?? [],
    },
    blocks,
  });
}
