/**
 * RANKING shot timing — THE single source of truth.
 *
 * ## Why this lives in @repo/contracts
 *
 * Three independent programs have to agree on these numbers *exactly*:
 *
 *   - `apps/worker-render` (Remotion) draws the shots.
 *   - `apps/hub-web` (B-Roll Selection Studio) sizes the VA's green trim bar and
 *     transcript highlight from the same window.
 *   - `apps/worker-orchestrator` (ranking-footage-collection) decides how much
 *     source footage to download per candidate.
 *
 * They used to keep three hand-synced copies, each carrying a "keep byte-for-
 * byte in sync" comment. That is not a mechanism, it is a wish: any drift
 * silently desyncs the VA's trim bar from what the renderer actually draws, so
 * the VA trims to a window the render never uses and nothing fails loudly.
 *
 * @repo/contracts is the only package all three already depend on, and the
 * Remotion browser bundle already resolves value imports from it
 * (`apps/worker-render/src/remotion/Root.tsx` imports DEFAULT_TIER_CONFIG). No
 * import boundary forbids it — the enforced boundaries in this repo
 * (`apps/worker-orchestrator/eslint.config.mjs`) only fence provider clients
 * behind the media/TTS gateways.
 *
 * This module is deliberately dependency-free (no zod, no React, no node
 * builtins) so it is safe in a browser bundle.
 *
 * ---
 *
 * Shot layout — drives the per-item three-beat cinematic cut:
 *
 *   IntroCard          → INTRO_SHOT_SECONDS
 *   For each item:
 *     TierListShot     → TIER_LIST_SHOT_SECONDS  (full-width tier board)
 *     BRollShot        → BROLL_SHOT_SECONDS      (full-screen product footage)
 *     RevealShot       → REVEAL_SHOT_SECONDS     (split: tier left + hero right)
 *   OutroHold          → OUTRO_SHOT_SECONDS      (final tier board)
 *
 * THE ONLY RENDER TIMING MODE is narration-anchored: every item carries a
 * Whisper-derived spoken segment (`narrationStartMs`/`narrationEndMs`) and
 * occupies its REAL spoken span — a TierList beat at the head, a Reveal beat at
 * the tail, and the B-roll filling the middle, so product footage is on screen
 * WHILE the item is discussed.
 *
 * The fixed per-item cadence below is NOT a render fallback and must never
 * become one again. `asset-collection.ts` hard-throws when anchoring is
 * incomplete, and `RankingComposition` / `renderRankingComposition` now throw
 * rather than lay shots out on a fixed cadence. Rendering a fixed-cadence
 * layout against real narration is what produced the 2026-07-09 frozen video
 * (see `MAX_OUTRO_HOLD_SECONDS`): ~8.5s of shots per item against ~40s of
 * speech per item, with the outro absorbing the remaining four minutes.
 *
 * The fixed constants survive for ONE legitimate consumer: the B-Roll Selection
 * Studio (`apps/hub-web/src/lib/ranking-blocks.ts`) uses `BLOCK_DURATION_MS` as
 * the default trim width for an item that has no anchored segment yet, i.e. a
 * UI default before Whisper has run. They are not a timing authority.
 */

export const INTRO_SHOT_SECONDS = 2;
export const TIER_LIST_SHOT_SECONDS = 1.5;
/** Per-item B-roll block length (FIXED-timing fallback only). */
export const BROLL_SHOT_SECONDS = 4;
export const REVEAL_SHOT_SECONDS = 3;
export const OUTRO_SHOT_SECONDS = 3;

/**
 * Hard ceiling on the closing OutroHold, in seconds.
 *
 * ## Why this exists (the 2026-07-09 freeze)
 *
 * The only RANKING render ever produced was frozen on a single static tier
 * board from 48s to 298s — 84% of its runtime. Nothing was broken in the
 * OutroHold component itself. The composition laid its shots out on the FIXED
 * cadence (~48s for 5 items) while the workflow floored total duration to the
 * PROBED AUDIO (298s), and the outro was written as
 * `Math.max(outroFrames, durationInFrames - outroFrom)` — "fill whatever
 * remains". So the outro dutifully absorbed 250 seconds of slack and the render
 * "succeeded".
 *
 * That is the silent-fallback failure mode this codebase forbids: it produced a
 * technically-valid MP4 that no human could publish, and every automated signal
 * was green. The structural fix is that narration-anchored timing is now the
 * ONLY timing mode (see `computeRankingAnchoredFrames`), which makes the slack
 * inherently small — the last shot ends at the last spoken word, so the outro
 * only ever covers the audio's trailing tail.
 *
 * This constant is the backstop for that fix: any outro longer than this means
 * shot layout and audio length have diverged again, and the render must fail
 * LOUDLY rather than emit another frozen video. It is deliberately generous
 * (a real trailing music tail is a few seconds) and still catches 250s by a
 * factor of ~17.
 */
export const MAX_OUTRO_HOLD_SECONDS = 15;

export const PER_ITEM_SHOT_SECONDS =
  TIER_LIST_SHOT_SECONDS + BROLL_SHOT_SECONDS + REVEAL_SHOT_SECONDS;

/** Fixed-timing B-roll block length in ms. Anchored blocks use their own. */
export const BLOCK_DURATION_MS = BROLL_SHOT_SECONDS * 1000;

// ── Narration-anchored window ────────────────────────────────────────────────
export const TIER_BEAT_MS = Math.round(TIER_LIST_SHOT_SECONDS * 1000);
export const REVEAL_BEAT_MS = Math.round(REVEAL_SHOT_SECONDS * 1000);
/** B-roll must always get at least this much of the item's segment. */
export const MIN_BROLL_MS = 1000;

export interface ItemWindow {
  /** ms of TierList beat at the head of the item's segment (clamped). */
  tierBeatMs: number;
  /** ms of Reveal beat at the tail of the item's segment (clamped). */
  revealBeatMs: number;
  /** Absolute ms where the B-roll window starts (segment start + tier beat). */
  brollStartMs: number;
  /** Absolute ms where the B-roll window ends (segment end − reveal beat). */
  brollEndMs: number;
  /** brollEndMs − brollStartMs. */
  brollDurationMs: number;
}

/**
 * Split an item's spoken segment [startMs, endMs] into tier / B-roll / reveal
 * beats. The tier + reveal beats are the fixed constants, scaled DOWN together
 * (never up) when the segment is too short to hold them plus MIN_BROLL_MS, so
 * the B-roll window is always ≥ MIN_BROLL_MS (or the whole segment if the
 * segment itself is shorter than that).
 */
export function computeItemWindow(startMs: number, endMs: number): ItemWindow {
  const segLen = Math.max(0, endMs - startMs);
  let tierBeatMs = TIER_BEAT_MS;
  let revealBeatMs = REVEAL_BEAT_MS;
  if (tierBeatMs + revealBeatMs + MIN_BROLL_MS > segLen) {
    const avail = Math.max(0, segLen - MIN_BROLL_MS);
    const totalBeat = tierBeatMs + revealBeatMs;
    const scale = totalBeat > 0 ? avail / totalBeat : 0;
    tierBeatMs = Math.floor(tierBeatMs * scale);
    revealBeatMs = Math.floor(revealBeatMs * scale);
  }
  const brollStartMs = startMs + tierBeatMs;
  const brollEndMs = endMs - revealBeatMs;
  return {
    tierBeatMs,
    revealBeatMs,
    brollStartMs,
    brollEndMs,
    brollDurationMs: Math.max(0, brollEndMs - brollStartMs),
  };
}

/**
 * True only when EVERY item (in reveal order) carries both narration bounds.
 *
 * This is an all-or-nothing gate, not a preference: a single missing bound
 * means the job CANNOT be rendered, because there is no honest way to place
 * that item's shots on the narration. Callers must throw, never substitute a
 * fixed cadence — see the module header.
 */
export function allItemsAnchored(
  items: Array<{ narrationStartMs?: number; narrationEndMs?: number }>,
): boolean {
  if (items.length === 0) return false;
  return items.every(
    (it) =>
      typeof it.narrationStartMs === "number" &&
      typeof it.narrationEndMs === "number" &&
      it.narrationEndMs > it.narrationStartMs,
  );
}

/**
 * Narration time (ms) at which the B-roll shot for the `revealIndex`-th item
 * (0-based, in reveal order) begins in FIXED-timing mode. = intro + revealIndex
 * full item-blocks + this item's tier-list beat. Fallback only.
 */
export function blockNarrationStartMs(revealIndex: number): number {
  return Math.round(
    (INTRO_SHOT_SECONDS +
      revealIndex * PER_ITEM_SHOT_SECONDS +
      TIER_LIST_SHOT_SECONDS) *
      1000,
  );
}

/**
 * Total composition length, in frames, on the FIXED cadence.
 *
 * NOT a render duration. This is retained only for tests and for reasoning
 * about the legacy cadence. Using it as the composition length against real
 * narration audio is precisely the bug that froze the 2026-07-09 render — the
 * shots end at ~48s, the audio runs to ~298s, and the difference becomes a
 * static frame. `renderRankingComposition` must derive duration from
 * `computeRankingAnchoredFrames` and throw when that returns null.
 */
export function computeRankingTotalFrames(
  itemCount: number,
  fps: number,
): number {
  const introFrames = Math.round(INTRO_SHOT_SECONDS * fps);
  const tierListFrames = Math.round(TIER_LIST_SHOT_SECONDS * fps);
  const brollFrames = Math.round(BROLL_SHOT_SECONDS * fps);
  const revealFrames = Math.round(REVEAL_SHOT_SECONDS * fps);
  const outroFrames = Math.round(OUTRO_SHOT_SECONDS * fps);
  return (
    introFrames +
    itemCount * (tierListFrames + brollFrames + revealFrames) +
    outroFrames
  );
}

/**
 * Narration-anchored base length, in frames: the last item's spoken segment
 * end plus a trailing OutroHold.
 *
 * Returns null when any item is unanchored. The caller MUST treat null as a
 * hard error — there is no fixed-cadence fallback (see the module header). The
 * workflow floors the final duration to the probed audio length so TTS is never
 * truncated, which makes this the lower bound when the probe is unavailable.
 */
export function computeRankingAnchoredFrames(
  items: Array<{ narrationStartMs?: number; narrationEndMs?: number }>,
  fps: number,
): number | null {
  if (!allItemsAnchored(items)) return null;
  const lastEndMs = Math.max(...items.map((it) => it.narrationEndMs as number));
  const outroFrames = Math.round(OUTRO_SHOT_SECONDS * fps);
  return Math.round((lastEndMs / 1000) * fps) + outroFrames;
}

export interface OutroHold {
  /** Frames the closing OutroHold would actually occupy (already capped). */
  outroDurationFrames: number;
  /** Seconds between the last shot ending and the composition ending. */
  slackSeconds: number;
  /** False when the hold exceeds MAX_OUTRO_HOLD_SECONDS — caller MUST throw. */
  withinCap: boolean;
}

/**
 * Size the closing OutroHold, and say whether it is sane.
 *
 * ONE definition, called by both `renderRankingComposition` (which throws
 * before spending a render) and `RankingComposition` (the backstop inside the
 * bundle). Those two used to reason about the outro independently, and the
 * composition's version was the naive `Math.max(outroFrames, durationInFrames -
 * outroFrom)` — "fill whatever remains" — which is how 250 seconds of frozen
 * tier board reached an MP4 with no error anywhere.
 *
 * `withinCap === false` is not a warning. The caller must throw: the only thing
 * a too-long hold can produce is a video that is mostly a still image.
 */
export function computeOutroHold(
  lastShotEndFrames: number,
  totalFrames: number,
  fps: number,
): OutroHold {
  const slackFrames = totalFrames - lastShotEndFrames;
  const maxFrames = Math.round(MAX_OUTRO_HOLD_SECONDS * fps);
  const preferredFrames = Math.round(OUTRO_SHOT_SECONDS * fps);
  return {
    outroDurationFrames: Math.max(
      preferredFrames,
      Math.min(slackFrames, maxFrames),
    ),
    slackSeconds: slackFrames / fps,
    withinCap: slackFrames <= maxFrames,
  };
}

// ── Tier-board geometry ──────────────────────────────────────────────────────

/**
 * Tier-board geometry. The board is full-width; rows scale to fill the
 * vertical space between top and bottom padding. Label holder is a fixed
 * width on the left of each row; the remainder is a single-row tile strip.
 */
export interface TierBoardGeometry {
  topPadding: number;
  bottomPadding: number;
  rowGap: number;
  rowHeight: number;
  labelHolderWidth: number;
  tileSize: number;
  tileGap: number;
}

/** Preferred tile edge, in px, when there is room for it. */
export const MAX_TILE_SIZE = 160;

/**
 * Geometry for the tier board.
 *
 * `capacity` is the maximum number of tiles that can ever land in a SINGLE
 * tier row. Tiles are shrunk so that many fit the strip without clipping.
 *
 * ## Why capacity, and why it is the whole item count
 *
 * The tile strip is one non-wrapping flex row with `overflow: hidden`. At
 * 1920px, with a 240px label holder and 160px tiles, only ~9 tiles fit — so a
 * 12-item ranking that concentrates into one tier silently clipped tiles off
 * the right edge, and `getSlotCoords` happily animated a reveal to a coordinate
 * outside the visible strip.
 *
 * Sizing must also be CONSTANT for the whole video: the board is re-rendered
 * per shot with a growing `placed` set, so deriving the size from "tiles placed
 * so far" would make every tile jump size at each cut, and would move the
 * reveal target mid-animation. The worst case is "every item lands in one
 * tier", so callers pass the total item count. A 12-item ranking then draws
 * 124px tiles in every shot instead of 160px tiles that clip.
 */
export function getTierBoardGeometry(
  width: number,
  height: number,
  tierCount: number,
  capacity: number = 0,
): TierBoardGeometry {
  const topPadding = 110;
  const bottomPadding = 70;
  const rowGap = 8;
  const labelHolderWidth = 240;
  const tileGap = 14;

  const boardHeight = height - topPadding - bottomPadding;
  const rowHeight = Math.floor(
    (boardHeight - (tierCount - 1) * rowGap) / tierCount,
  );

  // Vertical fit: the tile must sit inside the row with breathing room.
  let tileSize = Math.min(MAX_TILE_SIZE, rowHeight - 24);

  // Horizontal fit: `capacity` tiles + gaps must fit the strip beside the
  // label holder (the strip is padded by tileGap on both sides).
  if (capacity > 0) {
    const stripWidth = width - labelHolderWidth - 2 * tileGap;
    const widthLimited = Math.floor(
      (stripWidth - (capacity - 1) * tileGap) / capacity,
    );
    tileSize = Math.min(tileSize, widthLimited);
  }
  // Never emit a zero/negative tile — an absurd capacity should still draw
  // something rather than collapse the board.
  tileSize = Math.max(24, tileSize);

  return {
    topPadding,
    bottomPadding,
    rowGap,
    rowHeight,
    labelHolderWidth,
    tileSize,
    tileGap,
  };
}

/**
 * Compute the (x, y) of a tile slot in the tier board. Used by RevealShot to
 * animate the hero image from a centred preview into its locked slot. MUST be
 * called with the geometry produced by the same `capacity` the board used, or
 * the hero lands beside its slot.
 */
export function getSlotCoords(
  boardWidth: number,
  geom: TierBoardGeometry,
  tierOrder: number,
  slotIndex: number,
): { x: number; y: number } {
  const x =
    geom.labelHolderWidth +
    geom.tileGap +
    slotIndex * (geom.tileSize + geom.tileGap);
  const y =
    geom.topPadding +
    tierOrder * (geom.rowHeight + geom.rowGap) +
    (geom.rowHeight - geom.tileSize) / 2;
  return { x, y };
}

/** Hero preview size during the reveal — big and centred before it slides. */
export const REVEAL_HERO_PREVIEW_SIZE = 520;
