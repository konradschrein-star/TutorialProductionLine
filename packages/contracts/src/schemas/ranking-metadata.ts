import { z } from "zod";

/**
 * An OPTIONAL string on a schema an LLM fills in directly.
 *
 * `z.string().optional()` accepts `undefined` but REJECTS `null`, and a model
 * asked for an object with an optional field emits `"pronunciation": null` at
 * least as often as it omits the key — both are ordinary, correct JSON for
 * "there isn't one". On 2026-08-04 that rejection failed a real RANKING job at
 * ranking-analysis after the script had already been written and paid for:
 *
 *     path: ["items", 3, "pronunciation"] — Expected string, received null
 *
 * Nulls are normalised to `undefined` so every downstream consumer keeps the
 * clean `string | undefined` type and nothing has to learn about a third state.
 *
 * This is NOT a synthetic fallback: it does not invent a value, it recognises
 * that null and absent are the same statement. A field that is genuinely
 * REQUIRED must never use this — it would turn a missing value into a silent
 * `undefined`, which is exactly the substitution this codebase forbids.
 */
const llmOptionalString = () =>
  z
    .string()
    .nullish()
    .transform((v) => v ?? undefined);

/**
 * Single item to be ranked. `id` is stable across processing passes;
 * `name` is what the host says out loud; `pronunciation` overrides TTS
 * default for tricky names; `userFootageUrls` lets the operator (or MCP
 * caller) attach pre-fetched footage instead of relying on yt-dlp.
 */
/**
 * One fetched footage option for an item. The VA Review Studio shows all of
 * these per item; the VA picks one and trims it. `url` is a `file://` local
 * path (VPS-local, served by the render bundle server) or an http URL.
 * `source` is the origin: yt-dlp | pexels | clip-library | va-upload.
 */
export const FootageCandidateSchema = z.object({
  url: z.string().min(1),
  source: z.string().min(1),
  sourceUrl: z.string().optional(),
  attribution: z.string().optional(),
  /**
   * Human-readable source title — for yt-dlp this is the actual YouTube video
   * title, so the VA (and a cheap string-match relevance check) can tell at a
   * glance whether the clip is the right product. Shown as the source-row label
   * instead of "Source N — yt-dlp video".
   */
  title: z.string().optional(),
  /**
   * Relevance verdict from the footage collection step: did the source title
   * mention this item's product? `false` flags a clip the VA should scrutinise
   * (wrong product), `true` = matched, `undefined` = not checked (e.g. uploads).
   */
  productMatched: z.boolean().optional(),
  kind: z.enum(["video", "photo"]).default("video"),
  durationSeconds: z.number().nonnegative().optional(),
  thumbnailUrl: z.string().optional(),
  /**
   * Filmstrip sprite: ONE image holding `spriteFrames` frames tiled left→right,
   * sampled evenly across the clip. Powers the studio's CapCut-style timeline
   * preview AND the instant first/last-frame panels (tile lookup, no video
   * load). Generated best-effort by footage-collection; absent for photos or
   * when ffmpeg fails (the studio falls back to `thumbnailUrl` / `<video>`).
   */
  spriteUrl: z.string().optional(),
  spriteFrames: z.number().int().positive().optional(),
});
export type FootageCandidate = z.infer<typeof FootageCandidateSchema>;

/**
 * One piece of a block's fill: the region `[startMs, endMs)` of source clip
 * `candidateIndex` (index into the item's `footageCandidates`). Segments play
 * back-to-back; the sum of their durations equals the block's fixed length.
 */
export const BRollSegmentSchema = z.object({
  candidateIndex: z.number().int().min(0),
  startMs: z.number().nonnegative(),
  endMs: z.number().positive(),
});
export type BRollSegment = z.infer<typeof BRollSegmentSchema>;

/**
 * The VA's full fill for a B-roll block: an ordered list of segments. This one
 * shape covers every case the studio supports:
 *   - a single pick            → one segment
 *   - a within-source split    → two segments with the SAME candidateIndex
 *     (skip a bad stretch in the middle of one source clip)
 *   - a multi-source split     → segments with DIFFERENT candidateIndex
 *     (fill the block from several fetched clips or a VA upload)
 * The render plays them in order inside the framed block.
 */
export const BRollSelectionSchema = z.object({
  segments: z.array(BRollSegmentSchema).min(1),
});
export type BRollSelection = z.infer<typeof BRollSelectionSchema>;

/** The VA's hero-image pick: an override URL and/or a crop (0..1 relative). */
export const HeroSelectionSchema = z.object({
  imageUrl: z.string().optional(),
  /**
   * Crop rectangle in image-fraction coords (0..1 relative to the source
   * image), mapped to fill the square hero output frame. Values MAY fall
   * outside [0,1] when the VA zooms out / re-centres — the out-of-bounds area
   * is filled with `background` (never distorted) so every hero ends up at the
   * same aspect with the product framed as the VA arranged it.
   */
  crop: z
    .object({
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
    })
    .optional(),
  /** Solid fill (hex) behind the hero + for any out-of-crop area. Default white. */
  background: z.string().optional(),
});
export type HeroSelection = z.infer<typeof HeroSelectionSchema>;

export const RankingItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  // Same LLM-null tolerance as the plan schema — items are backfilled straight
  // from RankingPlanItem, so a null here arrives by the same route.
  pronunciation: llmOptionalString(),
  userFootageUrls: z.array(z.string().url()).optional(),
  imageUrl: z.string().url().optional(),
  /**
   * Product hero image (a clean product shot on a plain/neutral background —
   * NOT transparent; visual consistency across items beats transparency).
   * Populated by ranking-footage-collection via DDG image search, used by
   * the reveal shot and tier-board tiles. Distinct from `imageUrl`, which
   * is the operator-supplied override.
   */
  heroImageUrl: z.string().url().optional(),

  // ── Narration anchoring (Whisper) ───────────────────────────────────────
  /**
   * This item's spoken segment in the narration audio, in milliseconds
   * (absolute; the audio plays from frame 0). Computed by ranking-analysis by
   * locating the item's mention in the Whisper word timestamps: the segment
   * runs from this item's first mention to the next item's first mention. The
   * render anchors this item's shots to [narrationStartMs, narrationEndMs] and
   * the B-roll fills the middle, so footage is on screen WHILE the item is
   * discussed. The studio uses the same window for the green selection bar +
   * narration highlight. Absent only when Whisper is unavailable.
   */
  narrationStartMs: z.number().nonnegative().optional(),
  narrationEndMs: z.number().positive().optional(),

  // ── VA Review Studio (per-item, human-in-the-loop) ──────────────────────
  /** All fetched footage options for this item (VA picks one). */
  footageCandidates: z.array(FootageCandidateSchema).optional(),
  /** VA's chosen candidate + trim; render uses this over the default. */
  brollSelection: BRollSelectionSchema.optional(),
  /** VA's hero-image override / crop. */
  heroSelection: HeroSelectionSchema.optional(),
  /** Review status set in the studio. */
  vaApproved: z.boolean().optional(),
  vaSkipped: z.boolean().optional(),
});
export type RankingItem = z.infer<typeof RankingItemSchema>;

/** A single tier row on the board. `order` 0 = top (best). */
export const RankingTierSchema = z.object({
  name: z.string().min(1),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  order: z.number().int().min(0),
});
export type RankingTier = z.infer<typeof RankingTierSchema>;

export const RankingTierConfigSchema = z.object({
  tiers: z.array(RankingTierSchema).min(2).max(10),
});
export type RankingTierConfig = z.infer<typeof RankingTierConfigSchema>;

export const RankingPlacementSchema = z.object({
  itemId: z.string().min(1),
  tierIndex: z.number().int().min(0),
  revealOrder: z.number().int().min(0),
});
export type RankingPlacement = z.infer<typeof RankingPlacementSchema>;

/**
 * An item the LLM decided on itself when the operator gave no explicit items
 * (freeform-brief mode). The script-gen step reads these back out of the plan
 * and persists them as the job's `metadata.ranking.items` so footage-collection
 * and the render have real names/ids to work with. Absent when the operator
 * supplied the items up front (then `metadata.ranking.items` is the source).
 */

export const RankingPlanItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  pronunciation: llmOptionalString(),
});
export type RankingPlanItem = z.infer<typeof RankingPlanItemSchema>;

export const RankingPlanSchema = z.object({
  placements: z.array(RankingPlacementSchema).min(1),
  scriptText: z.string().min(1),
  targetRuntimeSeconds: z.number().positive(),
  /**
   * Present only in freeform-brief mode (operator gave no items). The list of
   * items the LLM chose, in the same id-space its placements reference.
   */
  items: z.array(RankingPlanItemSchema).optional(),
});
export type RankingPlan = z.infer<typeof RankingPlanSchema>;

/**
 * A create-time media upload (image or video) attached in the job form before
 * the job exists. Stored VPS-local; `url` is a `file://` path (or http). These
 * become a shared candidate pool: footage-collection offers the videos as extra
 * B-roll candidates on every item so the VA can place them in the studio, and
 * the images as hero-image options.
 */
export const RankingUserMediaSchema = z.object({
  url: z.string().min(1),
  kind: z.enum(["photo", "video"]),
  name: z.string().optional(),
});
export type RankingUserMedia = z.infer<typeof RankingUserMediaSchema>;

/**
 * Top-level RANKING job metadata. Cross-referential validation
 * (`rankingPlan.placements[*].itemId` must exist in `items[]`,
 * `tierIndex` must reference a tier in `tierConfig.tiers[]`) is
 * intentionally NOT enforced here — that's the ranking-analysis
 * processor's job at runtime.
 */
export const RankingMetadataSchema = z.object({
  topic: z.string().min(1),
  /**
   * Freeform operator input: a pasted script, a rough list of things to rank,
   * or a one-line description. The single required input in the simplified
   * create form. When `items` is empty the script-gen step reads this brief and
   * decides the items itself (DeepSeek), then backfills `items`.
   */
  brief: z.string().optional(),
  /**
   * Explicit items to rank. OPTIONAL now: min(0). When the operator specifies
   * them they win; when empty the LLM derives them from `brief` and the
   * script-gen step backfills this array before footage-collection runs.
   */
  items: z.array(RankingItemSchema).min(0),
  context: z.string(),
  tierConfig: RankingTierConfigSchema,
  /** Create-time image/video uploads shared as a candidate pool across items. */
  userMedia: z.array(RankingUserMediaSchema).optional(),
  rankingPlan: RankingPlanSchema.optional(),
  /**
   * Local narration audio, written as `file://<abs path>` by the RANKING
   * asset-collection step (TTS). The render worker rewrites it to an HTTP URL
   * served off LOCAL_MEDIA_ROOT before handing it to the composition.
   */
  audioUrl: z.string().optional(),
  /**
   * Review gating. `asset_quality_loop` (default for RANKING) pauses the job
   * at AWAITING_VA_REVIEW so a VA picks/trims footage per item before render.
   * `full_auto` skips review and renders the first-fetched candidates.
   */
  jobMode: z.enum(["full_auto", "asset_quality_loop"]).optional(),
  /**
   * Per-item footage/hero coverage from ranking-footage-collection, surfaced to
   * the B-Roll Studio so a VA sees which items have no usable footage BEFORE
   * they start, rather than discovering a 30-second still frame in the finished
   * video. Advisory only — the hard gates throw inside the collector.
   */
  footageCoverage: z
    .object({
      checkedAt: z.string(),
      itemsWithoutFootage: z.number().int().nonnegative(),
      itemsWithoutHero: z.number().int().nonnegative(),
      itemsWithNothing: z.number().int().nonnegative(),
      items: z.array(
        z.object({
          itemId: z.string(),
          name: z.string(),
          hasHero: z.boolean(),
          candidateCount: z.number().int().nonnegative(),
          productMatchedCount: z.number().int().nonnegative(),
        }),
      ),
    })
    .optional(),
  /**
   * Whisper word-level timestamps for the narration (seconds).
   *
   * RENDER-CRITICAL. This previously read "best-effort ... a UI aid, never
   * render-critical", which is the opposite of the truth and would lead a
   * maintainer to treat an empty array as harmless. EVERY shot boundary in the
   * composition derives from these: narration anchoring turns them into each
   * item's [narrationStartMs, narrationEndMs], and without them there is no
   * timing at all — asset-collection hard-throws, and the render workflow and
   * composition throw again as backstops. There is no fixed-cadence fallback;
   * the one that existed produced the 2026-07-09 video that was a frozen frame
   * for 84% of its runtime.
   *
   * They additionally power the B-roll studio's word-snapping and the
   * script-highlight showing which narration text a block covers.
   */
  wordTimestamps: z
    .array(
      z.object({
        word: z.string(),
        start: z.number(),
        end: z.number(),
      }),
    )
    .optional(),
});
export type RankingMetadata = z.infer<typeof RankingMetadataSchema>;

/**
 * Phase 1 default tier set. Product-flavoured labels; colour gradient from
 * "Instant Buy" (green) at top to "Hard Pass" (red) at bottom.
 *
 * Phase 2 will read this from the job's tierConfig when the UI lets users
 * customise it. The schema already supports variable tier counts.
 */
export const DEFAULT_TIER_CONFIG: RankingTierConfig = {
  tiers: [
    { name: "Instant Buy", colorHex: "#3ddc84", order: 0 },
    { name: "Worth It", colorHex: "#a4d65e", order: 1 },
    { name: "Maybe", colorHex: "#f7d038", order: 2 },
    { name: "Skip", colorHex: "#f5a623", order: 3 },
    { name: "Hard Pass", colorHex: "#e74c3c", order: 4 },
  ],
};
