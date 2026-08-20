import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { db, contentJobs } from "@/lib/db";
import { loadRankingJob } from "@/lib/va-review-job";
import {
  buildBlock,
  orderedPlacements,
  candidatesForItem,
  itemBlockWindow,
  fitSelectionToBlock,
  selectionTotalMs,
  SELECTION_TOLERANCE_MS,
} from "@/lib/ranking-blocks";
import { backfillCandidateDurations } from "@/lib/va-review-candidate-identity";
import {
  BRollSelectionSchema,
  HeroSelectionSchema,
  type RankingItem,
} from "@repo/contracts";

export const dynamic = "force-dynamic";

const MEDIA_ROOT =
  process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";

const patchBodySchema = z.object({
  selection: BRollSelectionSchema.optional(),
  approved: z.boolean().optional(),
  skipped: z.boolean().optional(),
  // VA hero-image override for the auto-generated tier-board + reveal shots.
  // null clears it (falls back to the auto-fetched hero).
  heroSelection: HeroSelectionSchema.nullable().optional(),
});

/**
 * PATCH /api/jobs/[id]/va-review/blocks/[itemId]
 *
 * Merge the VA's edits into metadata.ranking.items[i].{brollSelection,
 * vaApproved,vaSkipped}. When approved:true, Σ segment durations must be within
 * ±SELECTION_TOLERANCE_MS of the block length. Returns the updated Block.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id, itemId } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const loaded = await loadRankingJob(id);
  if (!loaded.ok) {
    return NextResponse.json(
      { error: loaded.error },
      { status: loaded.status },
    );
  }
  const { job, ranking } = loaded;

  const idx = ranking.items.findIndex((it) => it.id === itemId);
  if (idx < 0) {
    return NextResponse.json(
      { error: `Item ${itemId} not found in ranking` },
      { status: 404 },
    );
  }

  // This block's true B-roll window length — narration-anchored when the item
  // has Whisper segments, else the fixed BLOCK_DURATION_MS. Validation + the
  // default fill must both use THIS, not the constant, or anchored (variable-
  // length) blocks would reject every valid selection.
  const ordered = orderedPlacements(ranking);
  const revealIndex = ordered.findIndex((p) => p.itemId === itemId);
  const { blockDurationMs } = itemBlockWindow(
    ranking.items[idx],
    revealIndex >= 0 ? revealIndex : idx,
  );

  // Resolve the effective selection: incoming > existing.
  //
  // The stored selection is NOT trusted to already sum to the block window:
  // ranking-footage-collection seeds every item with the fixed 4000ms constant
  // even on narration-anchored jobs, where the real window is 44–58s. GET
  // already hands the studio a refitted selection, so an approve normally
  // arrives with a correct `body.selection` — but an approve WITHOUT one (a
  // bare {approved:true}) must refit the stale stored value too, or it would
  // 400 on a selection the VA was never shown and cannot influence.
  // Same duration backfill GET does, so the fit here clamps against the same
  // source lengths the studio was shown (otherwise an approve could be judged
  // against different constraints than the ones on screen).
  if (ranking.items[idx].footageCandidates) {
    await backfillCandidateDurations(
      ranking.items[idx].footageCandidates,
      MEDIA_ROOT,
    );
  }
  const candidateDurations = candidatesForItem(
    ranking.items[idx],
    MEDIA_ROOT,
  ).map((c) => c.durationMs);
  const incoming =
    body.selection?.segments ??
    ranking.items[idx].brollSelection?.segments ??
    [];
  const fitted = fitSelectionToBlock(
    incoming,
    blockDurationMs,
    candidateDurations,
  );
  const effectiveSelection =
    body.selection !== undefined && !fitted.changed
      ? body.selection
      : { segments: fitted.segments };

  // Validate duration sum only when the VA is approving the block.
  if (body.approved === true) {
    const total = selectionTotalMs(effectiveSelection.segments);
    if (Math.abs(total - blockDurationMs) > SELECTION_TOLERANCE_MS) {
      const shortBy = blockDurationMs - total;
      return NextResponse.json(
        {
          error:
            fitted.shortfallMs > 0
              ? `Sources are ${(fitted.shortfallMs / 1000).toFixed(1)}s too short to fill this ${(blockDurationMs / 1000).toFixed(1)}s block — add a longer clip (paste a URL or upload) and split the block across sources.`
              : `Selection is ${(Math.abs(shortBy) / 1000).toFixed(1)}s ${shortBy > 0 ? "shorter" : "longer"} than the ${(blockDurationMs / 1000).toFixed(1)}s block — use “Fit to block” to rescale it.`,
          selectedMs: total,
          blockDurationMs,
          shortfallMs: fitted.shortfallMs,
        },
        { status: 400 },
      );
    }
  }

  // Merge into a fresh item; preserve every other field.
  const updatedItem: RankingItem = { ...ranking.items[idx] };
  if (body.selection !== undefined || fitted.changed) {
    updatedItem.brollSelection = effectiveSelection;
  }
  if (body.approved !== undefined) {
    updatedItem.vaApproved = body.approved;
    if (body.approved) updatedItem.vaSkipped = false;
  }
  if (body.skipped !== undefined) {
    updatedItem.vaSkipped = body.skipped;
    if (body.skipped) updatedItem.vaApproved = false;
  }
  if (body.heroSelection !== undefined) {
    if (body.heroSelection === null) delete updatedItem.heroSelection;
    else updatedItem.heroSelection = body.heroSelection;
  }

  const updatedItems = ranking.items.map((it, i) =>
    i === idx ? updatedItem : it,
  );
  const updatedRanking = { ...ranking, items: updatedItems };
  const newMetadata = { ...job.metadata, ranking: updatedRanking };

  await db
    .update(contentJobs)
    .set({ metadata: newMetadata, updated_at: new Date() })
    .where(eq(contentJobs.id, id));

  // Rebuild the block for the response using this item's placement. The
  // reveal-order index fixes the block's narration window (see buildBlock).
  const placement = ordered.find((p) => p.itemId === itemId) ?? {
    itemId,
    tierIndex: 0,
    revealOrder: idx,
  };
  const block = buildBlock(
    updatedRanking,
    updatedItem,
    placement,
    MEDIA_ROOT,
    revealIndex >= 0 ? revealIndex : idx,
  );

  return NextResponse.json(block);
}
