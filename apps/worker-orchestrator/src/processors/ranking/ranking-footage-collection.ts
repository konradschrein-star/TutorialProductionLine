import { eq } from "drizzle-orm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { join, extname } from "node:path";
import { stat, mkdir } from "node:fs/promises";
import type { DrizzleClient } from "@repo/db";
import { contentJobs } from "@repo/db";
import { getConfig } from "@repo/config";
import {
  RankingMetadataSchema,
  type RankingMetadata,
  type RankingItem,
  type FootageCandidate,
} from "@repo/contracts";
import { defaultBrollSelection } from "./broll-default-selection.js";
import type { FootageResult } from "../../utils/footage-sources/types.js";
import { searchYouTube, downloadYtClip } from "../../utils/yt-dlp-client.js";
import { evaluateClip } from "../../utils/footage-quality-gate.js";
import { footageDataDir } from "../../utils/footage-sources/data-dir.js";
import { searchDDGImages } from "../../utils/duckduckgo-images.js";
import { downloadUrlToFile } from "../../utils/pexels-client.js";
import { createContextLogger } from "@repo/logger";

const logger = createContextLogger("ranking-footage-collection");

/**
 * Per-item footage/hero coverage. Totals cannot answer "which item will show
 * nothing?", which is the only question that matters when the failure mode is a
 * 30-second still frame in the middle of a finished video.
 */
interface ItemCoverage {
  itemId: string;
  name: string;
  hasHero: boolean;
  candidateCount: number;
  /** Candidates the search believed actually depict this product. */
  productMatchedCount: number;
}

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";
const FFPROBE_BIN = process.env["FFPROBE_PATH"] ?? "ffprobe";

/**
 * Frame count tiled left→right into a candidate's filmstrip sprite, scaled to the
 * clip duration (~1 frame per 4s) and clamped so a 10-min source is still
 * scrubbable while a short clip stays reasonable. A 60s clip → 24 tiles (floor),
 * a 10-min clip → 120 tiles (ceiling). Keep IDENTICAL to the copy in hub-web's
 * va-review/upload route (the two generators mirror each other; do not import
 * across apps).
 */
const SPRITE_MIN_FRAMES = 24;
const SPRITE_MAX_FRAMES = 120;
function spriteFrameCount(durationSeconds: number): number {
  const scaled = Math.round(durationSeconds / 4);
  return Math.max(SPRITE_MIN_FRAMES, Math.min(SPRITE_MAX_FRAMES, scaled));
}
/** Guard so a wedged ffmpeg/ffprobe can never stall the collection step. */
const SPRITE_EXEC_TIMEOUT_MS = 60_000;

/**
 * Generate a CapCut-style filmstrip sprite for a single video candidate: ONE JPG
 * with `SPRITE_FRAMES` frames sampled evenly across the clip and tiled
 * left→right. On full success, sets `spriteUrl` + `spriteFrames` on the candidate
 * in place. Skips photos, remote (non-`file://`) urls, and clips whose duration
 * can't be determined. Idempotent: a candidate that already has a sprite (e.g. a
 * shared create-time upload seen on an earlier item) is left untouched.
 */
async function generateCandidateSprite(
  candidate: FootageCandidate,
  jobId: string,
  itemId: string,
  candidateIndex: number,
  spriteDir: string,
): Promise<void> {
  if (candidate.spriteUrl) return;
  if (candidate.kind === "photo") return;
  if (!candidate.url.startsWith("file://")) return; // remote — don't download

  const inputPath = candidate.url.slice("file://".length);

  let durationSeconds = candidate.durationSeconds ?? 0;
  if (!durationSeconds || durationSeconds <= 0) {
    const { stdout } = await execFileAsync(
      FFPROBE_BIN,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=nk=1:nv=1",
        inputPath,
      ],
      { timeout: SPRITE_EXEC_TIMEOUT_MS },
    );
    durationSeconds = parseFloat(stdout.trim());
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return;

  const frames = spriteFrameCount(durationSeconds);
  const fps = frames / durationSeconds;
  const outPath = join(
    spriteDir,
    `${jobId}-${itemId}-cand${candidateIndex}.jpg`,
  );
  await execFileAsync(
    FFMPEG_BIN,
    [
      "-y",
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-vf",
      `fps=${fps},scale=-2:120,tile=${frames}x1`,
      "-q:v",
      "4",
      outPath,
    ],
    { timeout: SPRITE_EXEC_TIMEOUT_MS },
  );

  candidate.spriteUrl = `file://${outPath}`;
  candidate.spriteFrames = frames;
}

interface CollectRankingFootageArgs {
  db: DrizzleClient;
  jobId: string;
  metadata: unknown;
}

/**
 * How much of each source clip to download per candidate. The B-roll block is
 * only BROLL_SHOT_SECONDS long, but we pull a generous window so the VA can
 * slide the selection across the source (skip intros/outros/talking heads) in
 * the studio. Keep in sync with worker-render `BROLL_SHOT_SECONDS`.
 */
/**
 * Clip window (seconds) we pull from each AUTO-searched YouTube result. Longer
 * than the B-roll block itself so the VA has slack to slide/trim the selection
 * in the studio, but deliberately NOT the whole 10-min video: auto-collection
 * downloads several candidates across every item, so a huge per-clip window made
 * ASSET_COLLECTION take over an hour and hang on slow/blocked downloads. 150s is
 * ample trim room. The VA can paste a full-length URL in the studio (add-url
 * route, which pulls up to yt-dlp-client's MAX_CLIP_SECONDS) when they need more.
 */
const CANDIDATE_SOURCE_SECONDS = 150;
/**
 * Max YouTube results we'll actually try to DOWNLOAD per item before giving up.
 * A blocked/geo-restricted item used to churn through all 8 relevant results
 * (each a multi-minute timeout); cap the download attempts so a bad item fails
 * fast instead of dragging the whole collection step.
 */
const MAX_DOWNLOAD_ATTEMPTS = 3;
/** How many YouTube results to inspect (titles/metadata) before downloading one. */
const YT_SEARCH_LIMIT = 8;
// Fixed-timing B-roll block length. Imported from the shared RANKING timing
// module (@repo/contracts/schemas/ranking-timing) — the same definition the
// renderer and the B-Roll Studio use. Was previously a hardcoded `4 * 1000`
// with a "keep in sync" comment, i.e. the third copy of BROLL_SHOT_SECONDS.
const HERO_MIN_WIDTH = 400;
const HERO_MIN_HEIGHT = 400;

/** Map a gateway FootageResult to a studio FootageCandidate. */
function resultToCandidate(r: FootageResult): FootageCandidate {
  const providerUrl = r.providerMeta["url"];
  const providerTitle = r.providerMeta["title"];
  return {
    url: `file://${r.localPath}`,
    source: r.source,
    sourceUrl: typeof providerUrl === "string" ? providerUrl : undefined,
    attribution: r.attribution ?? undefined,
    title: typeof providerTitle === "string" ? providerTitle : undefined,
    kind: "video",
    durationSeconds: r.durationSeconds,
  };
}

/**
 * Query aimed at surfacing real footage of THIS product. We no longer lean on a
 * narrow official-channel whitelist (it's phone-manufacturer-only and misses
 * mice/keyboards/etc.); relevance is enforced downstream by
 * `titleMatchesProduct` against each result's actual title.
 */
function buildBRollQuery(item: RankingItem): string {
  return `${item.name} review`;
}

/**
 * Filler tokens that carry no product identity. Stripped from BOTH the product
 * name and (implicitly, by not requiring them) the title before matching.
 */
const FILLER_TOKENS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "for",
  "with",
  "of",
  "to",
  "in",
  "on",
  "is",
  "it",
  "my",
  "this",
  "that",
  "new",
  "official",
  "review",
  "reviews",
  "unboxing",
  "hands",
  "look",
  "first",
  "impressions",
  "test",
  "testing",
  "full",
  "vs",
  "versus",
  "best",
  "top",
  "worth",
  "buy",
  "price",
  "specs",
  "spec",
  "comparison",
  "compared",
  "edition",
  "trailer",
  "ad",
  "commercial",
  "video",
  "hd",
  "4k",
  "8k",
  "fhd",
  "uhd",
  "60fps",
  "2021",
  "2022",
  "2023",
  "2024",
  "2025",
  "2026",
]);

/**
 * Unit words that turn the number before them into a SIZE, not a model id.
 *
 * "Fezibo Dual Motor 55-inch" tokenises to [fezibo, dual, motor, 55, inch].
 * Rule 1 below treats any digit-bearing token as a mandatory model designator,
 * so "55" became mandatory and rejected "Fezibo Dual Motor White Standing Desk
 * Review" — the correct video, from the correct brand, for the correct product.
 * Every Fezibo result was thrown away this way and the item shipped with zero
 * footage (job 75c0cbe8, 2026-08-05).
 *
 * A size is not an identity: nobody titles a review "55 inch". A model number
 * is ("K552", "1000XM5", "V1"). Demoting number+unit pairs out of the mandatory
 * set keeps rule 1 doing the job it was written for (iPhone 11 ≠ iPhone 12)
 * without letting a tape measure veto the match.
 */
const DIMENSION_UNITS = new Set([
  "inch",
  "inches",
  "in",
  "cm",
  "mm",
  "m",
  "ft",
  "foot",
  "feet",
  "kg",
  "lb",
  "lbs",
  "g",
  "oz",
  "w",
  "watt",
  "watts",
  "hz",
  "l",
  "ml",
]);

/** "79x32", "55x24" — a dimension pair, never a model designator. */
const DIMENSION_PAIR = /^\d+x\d+$/;

/** Lowercase, strip punctuation, split into non-empty tokens. */
function normalizeTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Category nouns derived from the ranking's own topic, singularised.
 *
 * "Best budget standing desks under 400" → {standing, desk}. This is the only
 * signal in the pipeline that knows WHAT is being ranked, and it is free — the
 * VA typed it. See `titleMatchesProduct` for the one place it is allowed to
 * decide anything.
 */
export function categoryTokensFromTopic(topic: string): string[] {
  const stop = new Set([
    ...FILLER_TOKENS,
    "under",
    "below",
    "over",
    "above",
    "cheap",
    "cheapest",
    "budget",
    "affordable",
    "good",
    "great",
    "ranked",
    "ranking",
    "rank",
    "list",
    "dollars",
    "dollar",
    "usd",
    "eur",
    "you",
    "can",
    "money",
    "value",
  ]);
  const out = new Set<string>();
  for (const t of normalizeTokens(topic)) {
    if (stop.has(t)) continue;
    if (/\d/.test(t)) continue;
    if (t.length < 3) continue;
    out.add(singularise(t));
  }
  return [...out];
}

/** Crude but sufficient: keyboards→keyboard, desks→desk, glasses→glasse (harmless). */
function singularise(t: string): string {
  return t.length > 3 && t.endsWith("s") && !t.endsWith("ss")
    ? t.slice(0, -1)
    : t;
}

/**
 * Pure relevance gate: does `title` plausibly refer to the same product as
 * `productName`?
 *
 * Rules, in order:
 *
 *   1. Every MODEL token (a distinctive digit-bearing token that is NOT a size,
 *      e.g. "3s", "12", "g502", "k552") in the product name MUST appear in the
 *      title. Rejects "iPhone 11" when the product is "iPhone 12". Sizes are
 *      demoted — see `DIMENSION_UNITS`.
 *   2. At least one distinctive WORD token must appear.
 *   3. Strong match — ≥half the word tokens present, or any model token
 *      present — is accepted outright.
 *   4. WEAK match (no model token, and fewer than half the word tokens) is
 *      decided by the ranking's category. This is the only case where the
 *      category is consulted, and it cuts both ways:
 *        · title mentions the category → ACCEPT. Rescues the very common shape
 *          where the LLM names an item "Sanodesk Pro Series Dual Motor" but the
 *          reviewer titled it "SANODESK 79x32 — The Ultimate Large Standing
 *          Desk?". Brand + right category is a real match; demanding the LLM's
 *          spec adjectives be echoed in a stranger's video title is not a test
 *          of anything.
 *        · title does not → REJECT. This is what a brand-only overlap actually
 *          is: "Monoprice Workstream Ergonomic Budget Mesh Back CHAIR" scored
 *          2/4 against "Monoprice Workstream Single Motor" and was attached to
 *          a standing-desk ranking as a verified product match (job 75c0cbe8).
 *          Same failure class as the Bowers & Wilkins clip that shipped under a
 *          Sennheiser item.
 *      With no category supplied, rule 4 falls back to the old ≥half threshold
 *      rather than guessing.
 *
 * Tolerant of extra title words: "MX Master 3S" ⊆ "Logitech MX Master 3S
 * Review" → match. Returns false when the product name has no distinctive
 * tokens to check (can't verify → don't claim a match).
 */
export function titleMatchesProduct(
  title: string,
  productName: string,
  categoryTokens: readonly string[] = [],
): boolean {
  const productTokens = normalizeTokens(productName).filter(
    (t) => !FILLER_TOKENS.has(t),
  );
  if (productTokens.length === 0) return false;

  const titleTokens = new Set(normalizeTokens(title));

  // Classify in one pass. A digit token is a SIZE (not a model designator) when
  // it is a WxH pair or is immediately followed by a unit word; the unit word
  // itself is then dropped too, so "55 inch" contributes nothing either way.
  const modelTokens: string[] = [];
  const wordTokens: string[] = [];
  for (let i = 0; i < productTokens.length; i++) {
    const t = productTokens[i] as string;
    const next = productTokens[i + 1];
    if (/\d/.test(t)) {
      if (DIMENSION_PAIR.test(t)) continue;
      if (next !== undefined && DIMENSION_UNITS.has(next)) {
        i += 1; // consume the unit word with the number
        continue;
      }
      modelTokens.push(t);
    } else {
      wordTokens.push(t);
    }
  }

  // Rule 1: every model/version token must be present (exact, e.g. 11 ≠ 12).
  for (const m of modelTokens) {
    if (!titleTokens.has(m)) return false;
  }

  if (wordTokens.length === 0) {
    // Nothing but a model designator to go on — rule 1 already verified it.
    return modelTokens.length > 0;
  }

  const matchedWords = wordTokens.filter((t) => titleTokens.has(t)).length;
  // Rule 2: a title sharing no word token with the product is not about it.
  if (matchedWords === 0) return false;

  // Rule 3: strong evidence — a verified model designator, or every word token
  // present. Neither can be produced by an unrelated product of the same brand,
  // so the category is not consulted and cannot cause a false negative.
  if (modelTokens.length > 0) return true;
  if (matchedWords === wordTokens.length) return true;

  // Rule 4: partial evidence — the category decides. With no category supplied
  // this degrades to the original ≥half threshold rather than guessing.
  if (categoryTokens.length === 0) {
    return matchedWords / wordTokens.length >= 0.5;
  }
  return titleMentionsCategory(titleTokens, categoryTokens);
}

function titleMentionsCategory(
  titleTokens: ReadonlySet<string>,
  categoryTokens: readonly string[],
): boolean {
  for (const t of titleTokens) {
    if (categoryTokens.includes(singularise(t))) return true;
  }
  return false;
}

/**
 * YouTube-first B-roll: search several results, keep only those whose TITLE
 * matches the product, prefer official channels (then longer clips for trim
 * slack), and download ONLY the best relevant one that also passes the quality
 * gate. Returns null (attach nothing) when no result is relevant — we never
 * attach an unrelated clip to fake coverage. Never throws: search failures
 * yield [], download/probe failures are caught and skipped.
 */
async function fetchBestYouTubeFootage(
  item: RankingItem,
  jobId: string,
  categoryTokens: readonly string[],
): Promise<FootageResult | null> {
  const query = buildBRollQuery(item);
  const results = await searchYouTube(query, YT_SEARCH_LIMIT);

  const relevant = results.filter((r) =>
    titleMatchesProduct(r.title, item.name, categoryTokens),
  );
  if (relevant.length === 0) {
    logger.info(
      {
        jobId,
        itemId: item.id,
        query,
        inspected: results.length,
        sampleTitles: results.slice(0, 5).map((r) => r.title),
      },
      "ranking-footage: no YouTube result title matched the product — attaching none",
    );
    return null;
  }

  // Prefer official channels, then longer clips (more room for the VA to trim).
  relevant.sort((a, b) =>
    a.is_official !== b.is_official
      ? Number(b.is_official) - Number(a.is_official)
      : b.duration - a.duration,
  );

  for (const best of relevant.slice(0, MAX_DOWNLOAD_ATTEMPTS)) {
    try {
      const dir = footageDataDir();
      const fileName = `${randomUUID()}.mp4`;
      const destPath = join(dir, fileName);
      const clip = await downloadYtClip(
        best.url,
        destPath,
        0,
        CANDIDATE_SOURCE_SECONDS,
      );
      const evalResult = await evaluateClip(clip.local_path);
      if (!evalResult.accepted) {
        logger.info(
          {
            jobId,
            itemId: item.id,
            url: best.url,
            reasons: evalResult.reasons,
          },
          "ranking-footage: yt-dlp clip rejected by quality gate — trying next relevant result",
        );
        continue;
      }
      return {
        ref: `footage/${fileName}`,
        localPath: clip.local_path,
        source: "yt-dlp",
        durationSeconds: evalResult.metrics.durationSeconds,
        width: evalResult.metrics.width,
        height: evalResult.metrics.height,
        attribution: clip.channel ? `via YouTube — ${clip.channel}` : null,
        providerMeta: {
          url: clip.url,
          title: clip.title || best.title,
          channel: clip.channel || best.channel,
          channel_id: clip.channel_id || best.channel_id,
          is_official: best.is_official,
        },
      };
    } catch (err) {
      logger.warn(
        { jobId, itemId: item.id, url: best.url, err: String(err) },
        "ranking-footage: yt-dlp download/probe failed — trying next relevant result",
      );
    }
  }
  return null;
}

/** Cascade of DDG queries — most specific first. */
function buildHeroImageQueries(item: RankingItem): string[] {
  return [
    `${item.name} product photo`,
    `${item.name} press image`,
    `${item.name} official`,
  ];
}

async function fetchHeroImage(
  item: RankingItem,
  jobId: string,
  heroDir: string,
): Promise<string | null> {
  for (const query of buildHeroImageQueries(item)) {
    try {
      const results = await searchDDGImages(query, 10);
      const candidate =
        results.find(
          (r) => r.width >= HERO_MIN_WIDTH && r.height >= HERO_MIN_HEIGHT,
        ) ?? null;
      if (!candidate) continue;

      const urlExt = extname(new URL(candidate.url).pathname).toLowerCase();
      const ext = [".png", ".jpg", ".jpeg", ".webp"].includes(urlExt)
        ? urlExt
        : ".jpg";
      const destPath = join(heroDir, `${jobId}-${item.id}${ext}`);
      await downloadUrlToFile(candidate.url, destPath);
      const { size } = await stat(destPath);
      if (size < 4_000) {
        logger.warn(
          { jobId, itemId: item.id, query, size },
          "ranking-hero: downloaded image suspiciously small — discarding",
        );
        continue;
      }
      logger.info(
        {
          jobId,
          itemId: item.id,
          query,
          source: candidate.source,
          width: candidate.width,
          height: candidate.height,
        },
        "ranking-hero: image acquired",
      );
      return destPath;
    } catch (err) {
      logger.warn(
        { jobId, itemId: item.id, query, err: String(err) },
        "ranking-hero: DDG attempt failed — trying next query",
      );
    }
  }
  return null;
}

export async function collectRankingFootage({
  db,
  jobId,
  metadata,
}: CollectRankingFootageArgs): Promise<RankingMetadata> {
  const config = getConfig();
  const heroDir = join(config.LOCAL_MEDIA_ROOT, "ranking-hero");
  const spriteDir = join(config.LOCAL_MEDIA_ROOT, "ranking-sprites");
  await mkdir(spriteDir, { recursive: true });

  const rankingSlice =
    metadata && typeof metadata === "object" && "ranking" in metadata
      ? (metadata as { ranking: unknown }).ranking
      : metadata;
  const parsed = RankingMetadataSchema.safeParse(rankingSlice);
  if (!parsed.success) {
    throw new Error(
      `ranking-footage-collection: job metadata.ranking is not RankingMetadata: ${parsed.error.message}`,
    );
  }
  const ranking = parsed.data;

  // Create-time uploads form a shared pool: the operator dropped images/videos
  // in the form before any item existed (freeform mode has no item targeting),
  // so we offer the videos as extra B-roll candidates on EVERY item. The VA
  // decides in the studio which block, if any, each upload fills. Images stay
  // in metadata.ranking.userMedia for the studio's hero picker.
  const userVideoPool: FootageCandidate[] = (ranking.userMedia ?? [])
    .filter((m) => m.kind === "video")
    .map((m) => ({
      url: m.url,
      source: "user-upload",
      kind: "video" as const,
      ...(m.name ? { attribution: m.name } : {}),
    }));

  // What is being ranked, as tokens. Used ONLY to break ties in the relevance
  // gate (see `titleMatchesProduct` rule 4) — never to widen a search.
  const categoryTokens = categoryTokensFromTopic(ranking.topic ?? "");

  const updatedItems: RankingItem[] = [];
  // Per-item coverage, not just totals. Totals cannot answer the question that
  // matters ("which item will show nothing?") and the VA needs to see the gap
  // before recording, not discover it in the finished video.
  const coverage: ItemCoverage[] = [];
  let footageFetched = 0;
  let footageMissing = 0;
  let heroFetched = 0;
  let heroCached = 0;
  let heroMissing = 0;

  for (const item of ranking.items) {
    // ── Hero image ─────────────────────────────────────────────────────────
    let heroImageUrl = item.heroImageUrl;
    if (heroImageUrl) {
      heroCached += 1;
    } else {
      const heroPath = await fetchHeroImage(item, jobId, heroDir);
      if (heroPath) {
        heroImageUrl = `file://${heroPath}`;
        heroFetched += 1;
      } else {
        heroMissing += 1;
      }
    }

    // ── B-roll candidates (the VA picks/trims one per block in the studio) ──
    // Pull a generous source window per candidate so the VA can slide the
    // selection across it. Candidate 0 becomes the full-auto default.
    const candidates: FootageCandidate[] = [];

    // 1. VA-supplied URLs from the create form come first.
    for (const u of item.userFootageUrls ?? []) {
      candidates.push({ url: u, source: "user-url", kind: "video" });
    }

    // 2. YouTube: search several results, keep only those whose TITLE actually
    //    names this product (relevance gate), prefer official channels, and
    //    download only the best relevant clip. If NOTHING is relevant we attach
    //    nothing — never an unrelated clip. Pexels is intentionally NOT used for
    //    RANKING: generic stock can't show a specific product, and the VA is
    //    better served by an honest "no footage" flag than by filler.
    try {
      const yt = await fetchBestYouTubeFootage(item, jobId, categoryTokens);
      if (yt) {
        const cand = resultToCandidate(yt);
        cand.productMatched = true;
        candidates.push(cand);
      }
    } catch (err) {
      logger.warn(
        { jobId, itemId: item.id, err: String(err) },
        "ranking-footage: yt-dlp candidate failed",
      );
    }

    // 3. Shared create-time uploads — appended last so fetched official footage
    //    stays the full-auto default (candidate 0); the VA can switch to these.
    for (const uv of userVideoPool) candidates.push(uv);

    if (candidates.length > 0) footageFetched += 1;
    else footageMissing += 1;

    // ── Filmstrip sprites ──────────────────────────────────────────────────
    // Now that the candidate list is final for this item, generate a tiled
    // sprite per video candidate so the VA studio can render a CapCut-style
    // timeline preview and instant first/last frames without loading full
    // videos. Best-effort per candidate — a sprite failure NEVER fails the job.
    for (const [candidateIndex, candidate] of candidates.entries()) {
      try {
        await generateCandidateSprite(
          candidate,
          jobId,
          item.id,
          candidateIndex,
          spriteDir,
        );
      } catch (err) {
        logger.warn(
          { jobId, itemId: item.id, candidateIndex, err: String(err) },
          "ranking-footage: sprite generation failed",
        );
      }
    }

    // Default fill: candidate 0, from its start, for as much of the item's REAL
    // B-roll window as that clip holds. The VA refines this in the studio;
    // full_auto renders it as-is.
    //
    // This used to be the flat `BLOCK_DURATION_MS` constant — 4000 ms — while a
    // narration-anchored block's window is 44–58 SECONDS. Every studio control
    // is Σ-preserving, so a block seeded 5–13× too short could never satisfy the
    // approve gate and no VA could fix it by hand. See
    // `broll-default-selection.ts` for the full story.
    //
    // Narration anchoring runs AFTER this step (asset-collection.ts calls
    // `computeItemNarrationSegments` on our output), so on a first pass the
    // items here have no spoken segment yet and this resolves to the constant.
    // That is why asset-collection re-seeds through the same helper the moment
    // the anchored window exists; on a re-run the bounds are already present and
    // the right window is written straight away.
    const brollSelection =
      defaultBrollSelection(item, candidates) ?? item.brollSelection;

    // `userFootageUrls` is OPERATOR INPUT (the create form / MCP) and is left
    // exactly as the operator wrote it.
    //
    // This used to be overwritten with `[candidates[0].url]` "so full_auto and
    // the BRollShot default still render something before any VA edit". Both
    // halves of that were wrong:
    //
    //  · It was unnecessary. `BRollShot` reads `footageCandidates` +
    //    `brollSelection` and only falls back to `userFootageUrls[0]` when
    //    there are NO candidates — and this branch only runs when there is at
    //    least one. `ranking-blocks.ts` calls the field "legacy" for the same
    //    reason.
    //  · It was destructive, in two directions. It threw away the URLs an
    //    operator actually supplied, and — because step 1 above re-reads the
    //    field as "VA-supplied URLs" — it fed the previous run's clip back in
    //    as candidate 0 on every subsequent run, ahead of the freshly fetched
    //    one. `defaultBrollSelection` points at candidate 0, so a re-collection
    //    could never replace a bad clip: job 75c0cbe8 (2026-08-05) re-ran with
    //    a fixed relevance gate, fetched the correct desk video for every item,
    //    and still defaulted three of them to the previous run's clips —
    //    including the chair the fix existed to reject.
    const userFootageUrls = item.userFootageUrls;

    const finalCandidates =
      candidates.length > 0 ? candidates : (item.footageCandidates ?? []);
    coverage.push({
      itemId: item.id,
      name: item.name,
      hasHero: Boolean(heroImageUrl),
      candidateCount: finalCandidates.length,
      productMatchedCount: finalCandidates.filter((c) => c.productMatched)
        .length,
    });

    updatedItems.push({
      ...item,
      heroImageUrl,
      userFootageUrls,
      footageCandidates:
        candidates.length > 0 ? candidates : item.footageCandidates,
      brollSelection,
    });
  }

  // Surfaced to the B-Roll Studio so per-item gaps are visible to the VA.
  //
  // Lives INSIDE metadata.ranking, not beside it. A top-level
  // `metadata.footageCoverage` was silently destroyed a few lines later:
  // asset-collection.ts rebuilds `metadata` from a snapshot it read BEFORE
  // calling this function, so anything written here outside `ranking` is
  // overwritten by that later write. Verified on a real production job — the
  // report was written and then simply was not there.
  const coverageReport = {
    checkedAt: new Date().toISOString(),
    items: coverage,
    itemsWithoutFootage: coverage.filter((c) => c.candidateCount === 0).length,
    itemsWithoutHero: coverage.filter((c) => !c.hasHero).length,
    itemsWithNothing: coverage.filter(
      (c) => c.candidateCount === 0 && !c.hasHero,
    ).length,
  };

  const updated: RankingMetadata = {
    ...ranking,
    items: updatedItems,
    footageCoverage: coverageReport,
  };

  const baseMetadata =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const newMetadata = { ...baseMetadata, ranking: updated };

  await db
    .update(contentJobs)
    .set({ metadata: newMetadata, updated_at: new Date() })
    .where(eq(contentJobs.id, jobId));

  logger.info(
    {
      jobId,
      total: ranking.items.length,
      hero: { fetched: heroFetched, cached: heroCached, missing: heroMissing },
      footage: { fetched: footageFetched, missing: footageMissing },
      coverage: {
        itemsWithoutFootage: coverageReport.itemsWithoutFootage,
        itemsWithoutHero: coverageReport.itemsWithoutHero,
        itemsWithNothing: coverageReport.itemsWithNothing,
      },
    },
    "ranking-footage: collection complete",
  );

  // ── Coverage gates ───────────────────────────────────────────────────────
  //
  // The only gate here used to be "zero heroes across ALL items". `footageMissing`
  // was counted and never checked at all, so a ranking where most items had no
  // footage rendered a STATIC HERO IMAGE for the whole of each item's B-roll
  // window — up to 30 seconds of one still picture per item — and reported
  // success. That is the same defect class as the 2026-07-09 freeze, and it now
  // also trips the output QA gate's frozen check at the far end of the pipeline.
  // Catching it here is far cheaper: nothing has been rendered yet, and the item
  // names tell an operator exactly what to fix.
  //
  // Each rule below maps to a concrete provable defect, not to a taste
  // threshold. Anything softer than "nothing can be drawn" is a QUALITY signal
  // and belongs in the coverage report the VA sees, not in a hard throw.

  // 1. An item with neither a hero nor any footage has literally nothing to
  //    put on screen for its entire spoken segment.
  const emptyItems = coverage.filter(
    (c) => c.candidateCount === 0 && !c.hasHero,
  );
  if (emptyItems.length > 0) {
    throw new Error(
      `ranking-footage-collection: ${emptyItems.length} of ${ranking.items.length} items have NO hero image and NO footage (jobId=${jobId}): ` +
        `${emptyItems.map((c) => c.name).join(", ")}. There is nothing to draw for their spoken segments, ` +
        `so the render would hold a blank or repeated frame across each of them. ` +
        `Fix: correct the item names so the footage search can find them, or attach media at create time.`,
    );
  }

  // 2. No item has ANY footage. Every B-roll window would be a still hero, so
  //    the finished video is a slideshow that the output QA gate will reject
  //    for being frozen — fail now instead of after a full render.
  if (footageFetched === 0) {
    throw new Error(
      `ranking-footage-collection: no footage acquired for ANY of ${ranking.items.length} items (jobId=${jobId}). ` +
        `Every B-roll window would render a static hero image, which is a frozen video by any measure. ` +
        `Check that yt-dlp is working (cookies + PO-token) before retrying.`,
    );
  }

  // 3. Keeps the original guarantee: without heroes there are no tiles, so the
  //    tier board itself has nothing to reveal.
  if (heroFetched + heroCached === 0) {
    throw new Error(
      `ranking-footage-collection: no hero images acquired for any of ${ranking.items.length} items (jobId=${jobId}) — refusing to render a slot-less ranking video`,
    );
  }

  // Partial gaps are NOT fatal — the VA is in the loop for clip selection and
  // can supply or accept alternatives. But they must be loud, because the
  // failure mode of staying quiet is a 30s still frame nobody noticed.
  if (coverageReport.itemsWithoutFootage > 0) {
    logger.warn(
      {
        jobId,
        itemsWithoutFootage: coverageReport.itemsWithoutFootage,
        names: coverage
          .filter((c) => c.candidateCount === 0)
          .map((c) => c.name),
      },
      "ranking-footage: items without footage will show a still hero for their whole segment — surfaced to the VA in the coverage report",
    );
  }

  return updated;
}
