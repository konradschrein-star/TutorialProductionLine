import { normalizeWord } from "@repo/domain";
import { createContextLogger } from "@repo/logger";
import type { RankingItem, RankingPlacement } from "@repo/contracts";
import type { RankingWordTimestamp } from "./ranking-tts.js";

const logger = createContextLogger("ranking-narration-anchoring");

/**
 * Narration anchoring (RANKING format).
 *
 * The narration is ONE continuous TTS track. Each item's on-screen shots must
 * play WHILE that item is discussed, not at a fixed offset. This module locates
 * every item's dedicated first-mention in the Whisper word stream and derives
 * each item's spoken segment [narrationStartMs, narrationEndMs]:
 *   - start = this item's dedicated first-mention time
 *   - end   = the NEXT item's first-mention time (last item → last spoken word)
 *
 * Design (why this is NOT a shared-prefix, reveal-order matcher):
 *
 *  1. DISTINCTIVE-TOKEN matching, not brand-prefix. Product names in a category
 *     share brand/line words ("Logitech MX Master 3S" vs "Logitech MX Master 4").
 *     Matching on the shared prefix "logitech mx master" makes near-duplicates
 *     collide — the 3S false-matches the 4's mention. Instead we score each
 *     transcript window by the INVERSE-DOCUMENT-FREQUENCY of the item name's
 *     tokens: a token shared by many items (logitech, mx) weighs little; a token
 *     unique to one item (anywhere, ergo, "4") weighs a lot. The window that best
 *     covers an item's *distinctive* tokens wins, so "master 3s" and "master 4"
 *     resolve to different mentions by their differing model token. This also
 *     naturally prefers a dedicated segment intro (full name spoken) over a brief
 *     comparison mention (partial name) elsewhere.
 *
 *  2. Tolerant of Whisper mangling. "3S" is often transcribed "3" and the brand
 *     word is often dropped in the body ("MX Master 3"). Model tokens match on
 *     their numeric core ("3s" ~ "3") and longer tokens match as substrings for
 *     minor misspellings — but a validity gate (below) stops loose collisions.
 *
 *  3. Order derived from the MATCHES, not from placements.revealOrder. The
 *     reveal/tier order stored in the ranking plan does NOT always equal the
 *     narration discussion order (and top-level `placements` can be empty). We
 *     locate every item independently over the FULL transcript, then sort by
 *     first-mention word index to get the true discussion order. A forward
 *     progression is the natural consequence (each item ends where the next
 *     begins).
 *
 * No synthetic/estimated timings (see feedback-no-synthetic-fallbacks): an item
 * that cannot be confidently located is left NULL. We persist segments for every
 * item we DID locate, so a retry costs no TTS and an operator can see exactly
 * which item failed to match.
 *
 * PARTIAL ANCHORING IS NOT SURVIVABLE FOR A RENDER. An earlier version of this
 * comment said an unlocated item simply "falls back to fixed timing for THAT
 * item only". That was wrong, and it was wrong in the expensive direction:
 * `allItemsAnchored` is all-or-nothing, so ONE unlocated item used to revert the
 * WHOLE job to a fixed ~8.5s-per-item cadence while the narration ran ~40s per
 * item. The render succeeded and was completely desynced — that is the
 * 2026-07-09 output that held one frozen frame for 250 of its 298 seconds.
 *
 * The caller (`asset-collection.ts`) therefore THROWS when `anchored` is false,
 * and both the render workflow and the composition throw again as backstops.
 * This function's job is to report honestly, not to paper over the gap.
 */

interface NormWord {
  norm: string;
  start: number;
  end: number;
}

/**
 * Numeric "core" of a model token: "3s" → "3", "4" → "4", "3" → "3". Used to
 * tolerate the common Whisper drop of a model suffix letter ("MX Master 3S"
 * spoken/transcribed as "MX Master 3"). Returns null for non-model tokens
 * (letters-first like "v2" are intentionally excluded — a bare "2" almost never
 * means the product).
 */
function numericCore(t: string): string | null {
  const m = /^(\d+)[a-z]?$/.exec(t);
  return m ? m[1] : null;
}

/**
 * Levenshtein distance, abandoned as soon as it exceeds `max`.
 *
 * Bounded on purpose: we only ever ask "is this within 2 edits", so there is no
 * reason to compute the true distance of two unrelated words.
 */
function withinEditDistance(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(
        prev[j]! + 1, // deletion
        curr[j - 1]! + 1, // insertion
        prev[j - 1]! + cost, // substitution
      );
      curr.push(v);
      if (v < rowBest) rowBest = v;
    }
    // Every alignment through this row already costs more than the budget.
    if (rowBest > max) return false;
    prev = curr;
  }
  return prev[b.length]! <= max;
}

/** Fuzzy per-token match tolerant of model-suffix drop and minor misspelling. */
function wordMatches(whisperWord: string, itemToken: string): boolean {
  if (whisperWord === itemToken) return true;
  // Model-number tolerance: "3s" ~ "3" (Whisper drops the suffix letter).
  const a = numericCore(whisperWord);
  const b = numericCore(itemToken);
  if (a !== null && b !== null && a === b) return true;
  // Substring for longer tokens tolerates misspellings ("Aryan" vs "Arian");
  // gated at ≥4 chars so short Whisper words don't embed in long item tokens.
  const shorter =
    whisperWord.length <= itemToken.length ? whisperWord : itemToken;
  const longer =
    whisperWord.length <= itemToken.length ? itemToken : whisperWord;
  if (shorter.length >= 4 && longer.includes(shorter)) return true;
  // TRANSPOSITIONS. Substring matching cannot see them: Whisper rendered
  // "Keychron" as "Keycrone", and neither string contains the other, so a real
  // production job failed the anchoring gate with 4/5 items located. Two edits
  // apart is well inside "the same brand, misheard".
  //
  // Gated at ≥6 chars because a 2-edit budget on a short token matches almost
  // anything ("bose" ~ "dose" ~ "rose"). The validity gate downstream still
  // requires a strong anchor or two matched tokens, so a single fuzzy hit on a
  // common word cannot carry a match on its own.
  if (shorter.length >= 6 && withinEditDistance(whisperWord, itemToken, 2)) {
    return true;
  }
  return false;
}

/** Significant, de-duplicated tokens of an item name (drops empty tokens). */
function itemTokens(name: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of name.split(/\s+/)) {
    const t = normalizeWord(raw);
    if (t.length === 0 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

interface ItemMatch {
  /** idf-weighted coverage score of the winning window. */
  weight: number;
  /** Narration time (ms) of the item's first matched token in the window. */
  startMs: number;
  /** Whisper index of the item's first matched token (drives ordering). */
  startIdx: number;
}

/**
 * Locate an item's dedicated first-mention. Scans every window of the
 * transcript, scoring by the idf-weight of matched item tokens, and returns the
 * highest-scoring valid window (ties → earliest). Returns null when no window
 * clears the validity gate.
 *
 * Validity gate (stops brand-only and lone-weak-token false matches):
 *   - a STRONG anchor present (a token unique to this item, ≥4 chars, non-numeric
 *     — e.g. "anywhere", "razer", "ergo") → single token suffices; OR
 *   - ≥2 tokens matched AND at least one is a most-distinctive (min-df) token —
 *     so near-duplicates match on stem+model ("master"+"3s"), never brand alone.
 */
function findBestMention(
  tokens: string[],
  df: Map<string, number>,
  whisperNorm: NormWord[],
): ItemMatch | null {
  if (tokens.length === 0) return null;
  const minDf = Math.min(...tokens.map((t) => df.get(t) ?? 1));
  const windowSize = Math.max(tokens.length + 2, 6);

  let best: ItemMatch | null = null;

  for (let i = 0; i < whisperNorm.length; i++) {
    const windowEnd = Math.min(whisperNorm.length, i + windowSize);
    const used = new Set<number>();
    const matched: Array<{ tok: string; idx: number }> = [];

    // Order-insensitive: each item token claims the first unused window word it
    // fuzzy-matches (brand words are frequently reordered/dropped in narration).
    for (const tok of tokens) {
      for (let j = i; j < windowEnd; j++) {
        if (used.has(j)) continue;
        if (wordMatches(whisperNorm[j]!.norm, tok)) {
          matched.push({ tok, idx: j });
          used.add(j);
          break;
        }
      }
    }
    if (matched.length === 0) continue;

    const weight = matched.reduce(
      (sum, m) => sum + 1 / (df.get(m.tok) ?? 1),
      0,
    );
    const hasStrongAnchor = matched.some(
      (m) =>
        (df.get(m.tok) ?? 1) === 1 &&
        m.tok.length >= 4 &&
        numericCore(m.tok) === null,
    );
    const hasMinDf = matched.some((m) => (df.get(m.tok) ?? 1) === minDf);
    const valid = hasStrongAnchor || (matched.length >= 2 && hasMinDf);
    if (!valid) continue;

    const earliestIdx = Math.min(...matched.map((m) => m.idx));
    const startMs = Math.round(whisperNorm[earliestIdx]!.start * 1000);

    if (
      best === null ||
      weight > best.weight + 1e-9 ||
      (Math.abs(weight - best.weight) < 1e-9 && earliestIdx < best.startIdx)
    ) {
      best = { weight, startMs, startIdx: earliestIdx };
    }
  }

  return best;
}

export interface NarrationAnchoringResult {
  /** Items with narrationStartMs/EndMs populated for every located item. */
  items: RankingItem[];
  /** True when EVERY item was located and a segment was written. */
  anchored: boolean;
  /** Names of items that could not be located. Any entry here fails the gate. */
  unmatched: string[];
}

/**
 * Populate per-item narrationStartMs/EndMs from the Whisper word stream.
 *
 * Every item is located independently over the full transcript (distinctive-
 * token, idf-weighted matching), then sorted by first-mention word index to
 * recover the true discussion order. Each located item's segment ends where the
 * next located item begins; the last ends at the last spoken word. Items that
 * cannot be located are left NULL, which makes `anchored` false and fails the
 * caller's gate — there is no per-item fallback. `placements` is accepted for
 * API compatibility but is
 * NOT used to derive order — reveal order does not always equal narration order,
 * and it is frequently empty.
 */
export function computeItemNarrationSegments(args: {
  jobId: string;
  items: RankingItem[];
  placements: RankingPlacement[];
  wordTimestamps: RankingWordTimestamp[];
}): NarrationAnchoringResult {
  const { jobId, items, wordTimestamps } = args;

  // No word timings → nothing to anchor (Whisper unavailable). Not an error.
  if (!wordTimestamps || wordTimestamps.length === 0) {
    logger.warn(
      { jobId },
      "no word timestamps — RANKING job cannot be anchored and will fail the gate",
    );
    return { items, anchored: false, unmatched: [] };
  }

  if (items.length === 0) {
    return { items, anchored: false, unmatched: [] };
  }

  const whisperNorm: NormWord[] = wordTimestamps.map((w) => ({
    norm: normalizeWord(w.word),
    start: w.start,
    end: w.end,
  }));
  const lastWordEndMs = Math.round(
    (whisperNorm[whisperNorm.length - 1]!.end ?? 0) * 1000,
  );

  // Document frequency of each token across the item set. Tokens shared by many
  // items (brand/line words) get low idf weight; unique model tokens dominate.
  const df = new Map<string, number>();
  for (const it of items) {
    for (const tok of itemTokens(it.name)) {
      df.set(tok, (df.get(tok) ?? 0) + 1);
    }
  }

  // Locate every item independently over the FULL transcript.
  const located: Array<{
    item: RankingItem;
    startMs: number;
    startIdx: number;
  }> = [];
  const unmatched: string[] = [];

  for (const item of items) {
    const tokens = itemTokens(item.name);
    const match = findBestMention(tokens, df, whisperNorm);
    if (match === null) {
      unmatched.push(item.name);
      logger.warn(
        { jobId, item_id: item.id, item_name: item.name, tokens },
        "RANKING item not located in narration — job will fail the anchoring gate",
      );
      continue;
    }
    located.push({ item, startMs: match.startMs, startIdx: match.startIdx });
  }

  // Discussion order = matches sorted by first-mention word index (NOT reveal
  // order). Forward progression is the natural consequence.
  located.sort((a, b) => a.startIdx - b.startIdx);

  // Build the segment map: each located item ends where the next begins; the
  // last ends at the last spoken word. A non-positive window (two items landing
  // on the same/inverted position) leaves that item NULL rather than emit junk.
  const segByItemId = new Map<string, { startMs: number; endMs: number }>();
  for (let i = 0; i < located.length; i++) {
    const startMs = located[i]!.startMs;
    const endMs =
      i + 1 < located.length ? located[i + 1]!.startMs : lastWordEndMs;
    if (endMs <= startMs) {
      unmatched.push(located[i]!.item.name);
      logger.warn(
        {
          jobId,
          item_id: located[i]!.item.id,
          start_ms: startMs,
          end_ms: endMs,
        },
        "RANKING item segment non-positive (mentions collide) — job will fail the anchoring gate",
      );
      continue;
    }
    segByItemId.set(located[i]!.item.id, { startMs, endMs });
  }

  const updatedItems = items.map((it) => {
    const seg = segByItemId.get(it.id);
    if (!seg) return it;
    return { ...it, narrationStartMs: seg.startMs, narrationEndMs: seg.endMs };
  });

  const anchored = segByItemId.size === items.length;
  if (anchored) {
    logger.info(
      {
        jobId,
        item_count: segByItemId.size,
        last_end_ms: lastWordEndMs,
      },
      "RANKING narration anchored — per-item segments persisted",
    );
  } else {
    logger.warn(
      {
        jobId,
        matched: segByItemId.size,
        total: items.length,
        unmatched,
      },
      "RANKING narration anchoring PARTIAL — located items persisted; job will fail the anchoring gate",
    );
  }

  return { items: updatedItems, anchored, unmatched };
}
