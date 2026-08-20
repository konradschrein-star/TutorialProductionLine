/**
 * B-Roll Selection Studio — shared block helpers (RANKING format).
 *
 * Turns a job's `metadata.ranking` into the `Block[]` shape the VA Review
 * Studio API contract exposes, and back. Pure functions only — no DB / no I/O.
 *
 * ## Shot timing
 *
 * The shot constants and `computeItemWindow` are IMPORTED from
 * `@repo/contracts` (`schemas/ranking-timing.ts`) and re-exported here for
 * existing callers. They used to be a hand-maintained duplicate of
 * `apps/worker-render/src/remotion/ranking/constants.ts`, both annotated "keep
 * byte-for-byte in sync" — which is a wish, not a mechanism. The studio sizes
 * its green selection bar and transcript highlight from the SAME window the
 * renderer draws B-roll into, so any drift silently made the VA trim to a
 * window the render never used. There is now one definition; drift is
 * impossible.
 */
import type {
  RankingMetadata,
  RankingItem,
  RankingPlacement,
  FootageCandidate,
  BRollSelection,
} from "@repo/contracts";
import {
  INTRO_SHOT_SECONDS,
  TIER_LIST_SHOT_SECONDS,
  BROLL_SHOT_SECONDS,
  REVEAL_SHOT_SECONDS,
  PER_ITEM_SHOT_SECONDS,
  BLOCK_DURATION_MS,
  TIER_BEAT_MS,
  REVEAL_BEAT_MS,
  MIN_BROLL_MS,
  computeItemWindow,
  blockNarrationStartMs,
} from "@repo/contracts";
import {
  fitSelectionToBlock,
  selectionTotalMs,
  SELECTION_TOLERANCE_MS,
} from "./broll-selection-fit";

export {
  INTRO_SHOT_SECONDS,
  TIER_LIST_SHOT_SECONDS,
  BROLL_SHOT_SECONDS,
  REVEAL_SHOT_SECONDS,
  PER_ITEM_SHOT_SECONDS,
  BLOCK_DURATION_MS,
  TIER_BEAT_MS,
  REVEAL_BEAT_MS,
  MIN_BROLL_MS,
  computeItemWindow,
  blockNarrationStartMs,
};
export type { ItemWindow } from "@repo/contracts";

/**
 * The B-roll window (start + length, ms) for an item — the TRUE window the
 * studio must size its selection bar + word highlight to, and the render draws
 * B-roll into. Anchored when the item has valid Whisper segments; otherwise the
 * fixed-timing formula. This is the single source of truth used by both
 * `buildBlock` and the PATCH validation route.
 */
export function itemBlockWindow(
  item: RankingItem,
  revealIndex: number,
): { narrationStartMs: number; blockDurationMs: number; anchored: boolean } {
  if (
    typeof item.narrationStartMs === "number" &&
    typeof item.narrationEndMs === "number" &&
    item.narrationEndMs > item.narrationStartMs
  ) {
    const win = computeItemWindow(item.narrationStartMs, item.narrationEndMs);
    return {
      narrationStartMs: win.brollStartMs,
      blockDurationMs: win.brollDurationMs,
      anchored: true,
    };
  }
  return {
    narrationStartMs: blockNarrationStartMs(revealIndex),
    blockDurationMs: BLOCK_DURATION_MS,
    anchored: false,
  };
}

/**
 * ±tolerance (ms) allowed between Σ segment durations and the block length.
 * Defined once in `broll-selection-fit` (the browser-safe module the studio
 * client shares) and re-exported here for the API routes.
 */
export { SELECTION_TOLERANCE_MS, fitSelectionToBlock, selectionTotalMs };

export interface BlockCandidate {
  index: number;
  url: string;
  source: string;
  kind: "video" | "photo";
  durationMs?: number;
  thumbnailUrl?: string;
  /** Filmstrip sprite (one image, N frames tiled left→right) + frame count. */
  spriteUrl?: string;
  spriteFrames?: number;
  /** Human-readable source title (real YouTube title for yt-dlp). Row label. */
  title?: string;
  /** Relevance verdict: did the source title mention this item's product?
   *  false = wrong-product warning; true = matched; undefined = not checked. */
  productMatched?: boolean;
  /** Index of the EARLIER candidate holding the identical source clip, when
   *  this row is a duplicate of it (same sourceUrl / url / file fingerprint).
   *  The row stays — indices address the render's `footageCandidates` — but the
   *  studio labels it so "Timeline 1 and Timeline 2 are the same video" is
   *  visible rather than mystifying. */
  duplicateOfIndex?: number;
}

export interface BlockSegment {
  candidateIndex: number;
  startMs: number;
  endMs: number;
}

export interface Block {
  itemId: string;
  itemName: string;
  tierName: string;
  /** Length (ms) of this block's B-roll window. In narration-anchored jobs this
   *  is the middle of the item's spoken segment; in fixed-timing jobs it is the
   *  constant BLOCK_DURATION_MS. Σ of the VA's selected segments must equal it. */
  blockDurationMs: number;
  /** Narration time (ms, absolute in the audio) where this block's B-roll
   *  window starts; the window is [narrationStartMs, narrationStartMs +
   *  blockDurationMs]. Anchored → the item's real spoken B-roll span (after the
   *  tier beat); fixed → the classic per-item offset. Drives the studio's green
   *  selection bar + which narration words are highlighted. */
  narrationStartMs: number;
  /** true → this block's window came from real Whisper narration anchoring;
   *  false → anchoring failed for the job and it fell back to fixed 4s timing
   *  (blocks are too short + misaligned — the studio surfaces a warning). */
  anchored: boolean;
  /** Effective hero image shown in the auto-generated tier-board + reveal shots
   *  (VA override > auto-fetched > operator). The VA can replace it. Resolved to
   *  a client-safe /api/media URL for display. */
  heroImageUrl?: string;
  /** Raw (file://) VA hero override, if any — round-trips through the crop/hero
   *  PATCH so a crop-only save preserves a prior image replacement. */
  heroOverrideRawUrl?: string;
  /** VA's crop rectangle (image-fraction coords) applied to the hero. */
  heroCrop?: { x: number; y: number; w: number; h: number };
  /** Solid background/fill color behind the hero (hex). */
  heroBackground?: string;
  narrationText: string;
  candidates: BlockCandidate[];
  selection: { segments: BlockSegment[] };
  /** true → the stored selection did not sum to `blockDurationMs` and was
   *  rescaled to fit before being sent (see `broll-selection-fit`). The studio
   *  tells the VA rather than silently changing their work. */
  selectionRefitted: boolean;
  /** ms the sources still fall short of the block window after the refit. > 0
   *  means no arrangement of these clips can fill the block — the VA must add a
   *  longer source. Never padded over. */
  selectionShortfallMs: number;
  approved: boolean;
  skipped: boolean;
}

/**
 * Pull the RankingMetadata slice out of a job's `metadata` column. Jobs store
 * it under `metadata.ranking`; some legacy rows may store it at the root.
 * Returns `null` when neither shape is present (caller should 400/404).
 */
export function extractRanking(metadata: unknown): RankingMetadata | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const obj = metadata as Record<string, unknown>;
  const slice =
    "ranking" in obj && obj["ranking"] && typeof obj["ranking"] === "object"
      ? (obj["ranking"] as RankingMetadata)
      : (obj as unknown as RankingMetadata);
  if (!slice || !Array.isArray((slice as RankingMetadata).items)) return null;
  return slice as RankingMetadata;
}

/**
 * Rewrite a `file://<LOCAL_MEDIA_ROOT>/x` (or bare absolute path under the
 * media root) into the client-safe `/api/media/x` URL. Non-file / already-http
 * URLs pass through unchanged. Returns undefined for undefined input.
 */
export function toMediaUrl(
  raw: string | undefined | null,
  mediaRoot: string,
): string | undefined {
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw;

  let path = raw;
  if (path.startsWith("file://")) path = path.slice("file://".length);

  // Normalize both sides to forward slashes for a stable prefix compare.
  const normPath = path.replace(/\\/g, "/");
  const normRoot = mediaRoot.replace(/\\/g, "/").replace(/\/+$/, "");

  let rel: string;
  if (normPath.startsWith(normRoot + "/")) {
    rel = normPath.slice(normRoot.length + 1);
  } else if (normPath === normRoot) {
    rel = "";
  } else {
    // Not under the media root — best effort: strip a leading slash so it still
    // resolves relative to /api/media (the media route re-roots under the root).
    rel = normPath.replace(/^\/+/, "");
  }
  return `/api/media/${rel}`;
}

/** Placements in reveal order. Falls back to items order if no plan. */
export function orderedPlacements(
  ranking: RankingMetadata,
): RankingPlacement[] {
  const placements = ranking.rankingPlan?.placements;
  if (placements && placements.length > 0) {
    return [...placements].sort((a, b) => a.revealOrder - b.revealOrder);
  }
  // No plan yet: synthesize placements from item order so the studio still works.
  return ranking.items.map((item, i) => ({
    itemId: item.id,
    tierIndex: 0,
    revealOrder: i,
  }));
}

function tierName(ranking: RankingMetadata, tierIndex: number): string {
  return ranking.tierConfig?.tiers?.[tierIndex]?.name ?? "";
}

/**
 * Candidates for an item. Prefers the multi-candidate `footageCandidates`
 * (populated by the worker-side fetch). Falls back to legacy `userFootageUrls`
 * so the studio isn't empty before that worker path ships.
 */
export function candidatesForItem(
  item: RankingItem,
  mediaRoot: string,
): BlockCandidate[] {
  const fromCandidates: FootageCandidate[] = item.footageCandidates ?? [];
  if (fromCandidates.length > 0) {
    return fromCandidates.map((c, index) => ({
      index,
      url: toMediaUrl(c.url, mediaRoot) ?? c.url,
      source: c.source,
      kind: c.kind ?? "video",
      ...(c.durationSeconds !== undefined
        ? { durationMs: Math.round(c.durationSeconds * 1000) }
        : {}),
      ...(c.thumbnailUrl
        ? { thumbnailUrl: toMediaUrl(c.thumbnailUrl, mediaRoot) }
        : {}),
      ...(c.spriteUrl ? { spriteUrl: toMediaUrl(c.spriteUrl, mediaRoot) } : {}),
      ...(c.spriteFrames ? { spriteFrames: c.spriteFrames } : {}),
      ...(c.title ? { title: c.title } : {}),
      ...(c.productMatched !== undefined
        ? { productMatched: c.productMatched }
        : {}),
    }));
  }
  const legacy = item.userFootageUrls ?? [];
  return legacy.map((url, index) => ({
    index,
    url: toMediaUrl(url, mediaRoot) ?? url,
    source: "yt-dlp",
    kind: "video" as const,
  }));
}

/** Default single-segment selection covering candidate 0 for the whole block.
 *  `durationMs` defaults to the fixed BLOCK_DURATION_MS; anchored blocks pass
 *  their real window length so the default fill spans the whole window. */
export function defaultSelection(durationMs: number = BLOCK_DURATION_MS): {
  segments: BlockSegment[];
} {
  return {
    segments: [{ candidateIndex: 0, startMs: 0, endMs: durationMs }],
  };
}

/**
 * Best-effort per-block narration: the sentence(s) in the plan script that
 * mention the item by name. Empty string when nothing matches (v1 — the UI
 * script panel degrades gracefully; word-snapping is v1.5).
 */
export function narrationForItem(
  ranking: RankingMetadata,
  item: RankingItem,
): string {
  const script = ranking.rankingPlan?.scriptText;
  if (!script) return "";
  const name = item.name.trim();
  if (!name) return "";
  const sentences = script.split(/(?<=[.!?])\s+/);
  const hits = sentences.filter((s) =>
    s.toLowerCase().includes(name.toLowerCase()),
  );
  return hits.join(" ").trim();
}

/** Build a single Block from an item + its placement.
 *  `revealIndex` is the block's 0-based position in reveal order — it fixes the
 *  block's narration window. */
export function buildBlock(
  ranking: RankingMetadata,
  item: RankingItem,
  placement: RankingPlacement,
  mediaRoot: string,
  revealIndex: number,
): Block {
  const selection: BRollSelection | undefined = item.brollSelection;
  const window = itemBlockWindow(item, revealIndex);
  const candidates = candidatesForItem(item, mediaRoot);
  // Repair a selection that does not sum to the block window before the studio
  // ever sees it. Anchored jobs are seeded with the FIXED 4000ms constant by
  // ranking-footage-collection, which is 5–13× too short for a real narration
  // window — and no studio control can change Σ, so the block would be
  // permanently unapprovable. See `broll-selection-fit` for the full story.
  const fit = fitSelectionToBlock(
    selection?.segments ?? [],
    window.blockDurationMs,
    candidates.map((c) => c.durationMs),
  );
  return {
    itemId: item.id,
    itemName: item.name,
    tierName: tierName(ranking, placement.tierIndex),
    blockDurationMs: window.blockDurationMs,
    narrationStartMs: window.narrationStartMs,
    anchored: window.anchored,
    heroImageUrl: toMediaUrl(
      item.heroSelection?.imageUrl ?? item.heroImageUrl ?? item.imageUrl,
      mediaRoot,
    ),
    ...(item.heroSelection?.imageUrl
      ? { heroOverrideRawUrl: item.heroSelection.imageUrl }
      : {}),
    ...(item.heroSelection?.crop ? { heroCrop: item.heroSelection.crop } : {}),
    ...(item.heroSelection?.background
      ? { heroBackground: item.heroSelection.background }
      : {}),
    narrationText: narrationForItem(ranking, item),
    candidates,
    selection: { segments: fit.segments },
    selectionRefitted: fit.changed,
    selectionShortfallMs: fit.shortfallMs,
    approved: item.vaApproved ?? false,
    skipped: item.vaSkipped ?? false,
  };
}

/** All blocks in reveal order. */
export function buildBlocks(
  ranking: RankingMetadata,
  mediaRoot: string,
): Block[] {
  const byId = new Map(ranking.items.map((it) => [it.id, it]));
  const blocks: Block[] = [];
  let revealIndex = 0;
  for (const placement of orderedPlacements(ranking)) {
    const item = byId.get(placement.itemId);
    if (!item) continue; // placement references a removed item — skip
    blocks.push(buildBlock(ranking, item, placement, mediaRoot, revealIndex));
    revealIndex += 1;
  }
  return blocks;
}

/** Count of blocks not yet approved or skipped. */
export function pendingCount(ranking: RankingMetadata): number {
  return ranking.items.filter((it) => !(it.vaApproved || it.vaSkipped)).length;
}

export function rankedCount(ranking: RankingMetadata): number {
  const placements = ranking.rankingPlan?.placements;
  return placements && placements.length > 0
    ? placements.length
    : ranking.items.length;
}
