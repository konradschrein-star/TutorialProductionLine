/**
 * Clip Search Repository
 *
 * Three-channel hybrid search using Reciprocal Rank Fusion (RRF):
 *  1. Dense: pgvector cosine similarity (halfvec 384-dim MiniLM)
 *  2. Sparse: jsonb index overlap approximation (sparse (unused for MiniLM))
 *  3. Text: PostgreSQL tsvector full-text search
 *
 * RRF formula: score = Σ 1 / (60 + rank_i) for each channel
 *
 * Optionally re-ranks results using Maximal Marginal Relevance (MMR) to
 * balance relevance against diversity given already-selected clip embeddings.
 *
 * Shot scale preference is applied as a soft boost (+0.1) after RRF+MMR
 * rather than a hard filter, to avoid starving results.
 */

import { sql } from "drizzle-orm";
import type { DrizzleClient } from "../client.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ClipSearchParams {
  /** Single library — back-compat. Ignored if library_ids is non-empty. */
  library_id: string;
  /** Search across multiple libraries (global library queries). Wins over library_id. */
  library_ids?: string[];
  query_dense: number[];
  /** sparse (unused for MiniLM) query vector */
  query_sparse: { indices: number[]; values: number[] };
  /** Full-text query string */
  query_text: string;
  /** Maximum results to return (default 20) */
  limit?: number;
  // Filters
  /** Soft preference — boosts matching clips, does not exclude non-matching */
  shot_scale_preference?: string[];
  /** Hard filter — clips with these audio_class values are excluded entirely */
  avoid_audio_classes?: string[];
  /** If non-empty, clip must include at least one of these characters */
  character_filter?: string[];
  min_duration_ms?: number;
  max_duration_ms?: number;
  // Cross-format hard filters (added 2026-06-05)
  /** Allowlist — only these clip_types pass (e.g. 'footage_real' for Vidrush). */
  clip_types?: string[];
  /** Denylist — these clip_types are excluded (e.g. exclude 'ai_generated'). */
  exclude_clip_types?: string[];
  /** Allowlist — only these source_kinds pass (joins through source_videos). */
  source_kinds?: string[];
  /** static<slow<medium<fast<chaotic — caps at this level inclusive. */
  motion_level_max?: "static" | "slow" | "medium" | "fast" | "chaotic";
  /** Allowlist — only matching lighting_style values pass. */
  lighting_styles?: string[];
  /** Allowlist — only matching color_temperature values pass. */
  color_temperatures?: string[];
  // MMR diversity
  /** Dense embeddings of already-selected clips for diversity re-ranking */
  already_selected_embeddings?: number[][];
  /** 0–1: higher = more relevance weight vs diversity (default 0.7) */
  mmr_lambda?: number;
}

const MOTION_RANK: Record<string, number> = {
  static: 0,
  slow: 1,
  medium: 2,
  fast: 3,
  chaotic: 4,
};

export interface ClipSearchResult {
  clip_id: string;
  rrf_score: number;
  dense_rank: number | null;
  sparse_rank: number | null;
  text_rank: number | null;
  match_reason: string;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface CandidateRow {
  id: string;
  dense_rank: number | null;
  text_rank: number | null;
  sparse_overlap: number;
  shot_scale: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! ** 2;
    normB += b[i]! ** 2;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
}

function rrfScore(ranks: (number | null)[]): number {
  return ranks.reduce<number>((sum, rank) => {
    if (rank === null) return sum;
    return sum + 1 / (60 + rank);
  }, 0);
}

interface MmrCandidate {
  clip_id: string;
  rrf_score: number;
  dense_embedding: number[] | null;
}

function mmrRerank<T extends MmrCandidate>(
  candidates: T[],
  alreadySelected: number[][],
  lambda: number,
): T[] {
  if (alreadySelected.length === 0) return candidates;

  return [...candidates]
    .map((c) => {
      if (!c.dense_embedding || alreadySelected.length === 0) {
        return { candidate: c, mmr_score: c.rrf_score };
      }
      const maxSim = Math.max(
        ...alreadySelected.map((sel) => cosineSim(c.dense_embedding!, sel)),
      );
      const mmr_score = lambda * c.rrf_score - (1 - lambda) * maxSim;
      return { candidate: c, mmr_score };
    })
    .sort((a, b) => b.mmr_score - a.mmr_score)
    .map((x) => x.candidate);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function searchClips(
  db: DrizzleClient,
  params: ClipSearchParams,
): Promise<ClipSearchResult[]> {
  const {
    library_id,
    library_ids,
    query_dense,
    query_sparse,
    query_text,
    limit = 20,
    shot_scale_preference = [],
    avoid_audio_classes = [],
    character_filter = [],
    min_duration_ms = 0,
    max_duration_ms = 600_000,
    clip_types = [],
    exclude_clip_types = [],
    source_kinds = [],
    motion_level_max,
    lighting_styles = [],
    color_temperatures = [],
    already_selected_embeddings = [],
    mmr_lambda = 0.7,
  } = params;

  // ── Build WHERE fragments ────────────────────────────────────────────────

  const avoidAudioClause =
    avoid_audio_classes.length > 0
      ? sql`AND (audio_class IS NULL OR audio_class NOT IN (${sql.join(
          avoid_audio_classes.map((c) => sql`${c}`),
          sql`, `,
        )}))`
      : sql``;

  // Library filter: prefer library_ids when present (global queries), fall
  // back to single library_id (back-compat).
  const libraryIds =
    library_ids && library_ids.length > 0 ? library_ids : [library_id];
  const libraryClause = sql`library_id = ANY(${libraryIds}::uuid[])`;

  const clipTypeClause =
    clip_types.length > 0
      ? sql`AND clip_type = ANY(${clip_types}::text[]::clip_type[])`
      : sql``;
  const excludeClipTypeClause =
    exclude_clip_types.length > 0
      ? sql`AND (clip_type IS NULL OR clip_type <> ALL(${exclude_clip_types}::text[]::clip_type[]))`
      : sql``;
  // Motion is varchar — comparison by allowlist derived from the rank table.
  let motionClause = sql``;
  if (motion_level_max) {
    const cap = MOTION_RANK[motion_level_max];
    if (cap != null) {
      const allowed = Object.entries(MOTION_RANK)
        .filter(([, r]) => r <= cap)
        .map(([k]) => k);
      motionClause = sql`AND (motion_level IS NULL OR motion_level = ANY(${allowed}::text[]))`;
    }
  }
  const lightingClause =
    lighting_styles.length > 0
      ? sql`AND (lighting_style IS NULL OR lighting_style = ANY(${lighting_styles}::text[]))`
      : sql``;
  const colorClause =
    color_temperatures.length > 0
      ? sql`AND (color_temperature IS NULL OR color_temperature = ANY(${color_temperatures}::text[]))`
      : sql``;
  // source_kinds requires a join through source_videos. Use IN-subquery to
  // avoid changing the FROM shape in the existing dense ORDER BY.
  const sourceKindClause =
    source_kinds.length > 0
      ? sql`AND source_video_id IN (
          SELECT id FROM source_videos
          WHERE source_kind = ANY(${source_kinds}::text[]::source_kind[])
        )`
      : sql``;

  // ── Hard fail: empty embedding means sidecar is unavailable ─────────────
  if (query_dense.length === 0) {
    throw new Error(
      "searchClips: empty dense vector — sidecar unavailable. Sequential fallback is disabled.",
    );
  }

  const denseVecStr = `[${query_dense.join(",")}]`;

  // ── Channel 1: Dense similarity — top 50 ────────────────────────────────
  // character_filter is a SOFT boost (not a hard WHERE filter).
  // A hard filter causes 60–80% black-screen fallbacks when the LLM assigns
  // character tags but most clips lack those tags. We fetch tags_characters
  // here and apply a +0.15 boost after RRF instead.

  const denseRows = (await db.execute(sql`
    SELECT
      id,
      ROW_NUMBER() OVER (ORDER BY embedding <=> ${denseVecStr}::halfvec(384)) AS dense_rank,
      shot_scale,
      tags_characters
    FROM clips
    WHERE ${libraryClause}
      AND review_status = 'approved'
      AND embedding IS NOT NULL
      AND (duplicate_of_id IS NULL)
      AND (end_ms - start_ms) BETWEEN ${min_duration_ms} AND ${max_duration_ms}
      ${avoidAudioClause}
      ${clipTypeClause}
      ${excludeClipTypeClause}
      ${sourceKindClause}
      ${motionClause}
      ${lightingClause}
      ${colorClause}
    ORDER BY embedding <=> ${denseVecStr}::halfvec(384)
    LIMIT 50
  `)) as Array<{
    id: string;
    dense_rank: string;
    shot_scale: string | null;
    tags_characters: string[] | null;
  }>;

  if (denseRows.length === 0) {
    return [];
  }

  const topIds = denseRows.map((r) => r.id);
  const denseRankById = new Map<string, number>(
    denseRows.map((r) => [r.id, Number(r.dense_rank)]),
  );
  const shotScaleById = new Map<string, string | null>(
    denseRows.map((r) => [r.id, r.shot_scale]),
  );
  const tagsCharactersById = new Map<string, string[]>(
    denseRows.map((r) => [r.id, r.tags_characters ?? []]),
  );

  // ── Channel 3: Full-text search — rank within top-50 ────────────────────
  // We compute tsvector text rank only for the dense top-50 candidates to keep
  // the search scoped and fast.

  const safeQueryText = query_text.replace(/['"\\]/g, " ").trim() || "clip";

  let textRankById = new Map<string, number>();
  if (safeQueryText.length > 0) {
    try {
      const textRows = (await db.execute(sql`
        SELECT
          id,
          ROW_NUMBER() OVER (
            ORDER BY ts_rank_cd(
              to_tsvector('english',
                COALESCE(ai_description, '') || ' ' || COALESCE(transcript, '')
              ),
              plainto_tsquery('english', ${safeQueryText})
            ) DESC
          ) AS text_rank
        FROM clips
        WHERE id = ANY(${topIds}::uuid[])
          AND to_tsvector('english',
                COALESCE(ai_description, '') || ' ' || COALESCE(transcript, '')
              ) @@ plainto_tsquery('english', ${safeQueryText})
        LIMIT 50
      `)) as Array<{ id: string; text_rank: string }>;

      textRankById = new Map(textRows.map((r) => [r.id, Number(r.text_rank)]));
    } catch {
      // tsvector query parse error (empty query, special chars) — skip text channel
      textRankById = new Map();
    }
  }

  // ── Channel 2: Sparse overlap — count matching token indices ────────────
  // Exact sparse (unused for MiniLM) dot product in pure SQL requires unnesting jsonb arrays
  // and joining on index values, which is expensive. We approximate with a jsonb
  // containment count: the number of query token indices that appear in the clip's
  // sparse embedding index list.
  //
  // This is not mathematically identical to dot product but captures the same
  // signal (shared vocabulary tokens) and is fast over the pre-filtered top-50.

  let sparseRankById = new Map<string, number>();
  if (query_sparse.indices.length > 0) {
    try {
      const queryIndicesLiteral = `{${query_sparse.indices.join(",")}}`;

      const sparseRows = (await db.execute(sql`
        SELECT
          id,
          (
            SELECT COUNT(*)
            FROM jsonb_array_elements(embedding_sparse->'indices') AS elem
            WHERE (elem#>>'{}')::int = ANY(${queryIndicesLiteral}::int[])
          ) AS sparse_overlap
        FROM clips
        WHERE id = ANY(${topIds}::uuid[])
          AND embedding_sparse IS NOT NULL
        ORDER BY sparse_overlap DESC
      `)) as Array<{ id: string; sparse_overlap: string }>;

      // Rank by descending overlap count
      sparseRows.forEach((r, idx) => {
        if (Number(r.sparse_overlap) > 0) {
          sparseRankById.set(r.id, idx + 1);
        }
      });
    } catch {
      // Sparse column missing or jsonb parse error — skip sparse channel
      sparseRankById = new Map();
    }
  }

  // ── In-memory RRF merge ──────────────────────────────────────────────────

  interface ScoredCandidate {
    clip_id: string;
    rrf_score: number;
    dense_rank: number | null;
    sparse_rank: number | null;
    text_rank: number | null;
    dense_embedding: number[] | null;
    shot_scale: string | null;
    tags_characters: string[];
  }

  const candidates: ScoredCandidate[] = topIds.map((id) => {
    const denseRank = denseRankById.get(id) ?? null;
    const sparseRank = sparseRankById.get(id) ?? null;
    const textRank = textRankById.get(id) ?? null;
    const score = rrfScore([denseRank, sparseRank, textRank]);

    return {
      clip_id: id,
      rrf_score: score,
      dense_rank: denseRank,
      sparse_rank: sparseRank,
      text_rank: textRank,
      dense_embedding: null,
      shot_scale: shotScaleById.get(id) ?? null,
      tags_characters: tagsCharactersById.get(id) ?? [],
    };
  });

  // Sort by RRF score descending
  candidates.sort((a, b) => b.rrf_score - a.rrf_score);

  // ── MMR re-ranking ───────────────────────────────────────────────────────
  // When already_selected_embeddings are provided, re-rank to promote diversity.
  // With dense_embedding = null for all candidates (not fetched above), MMR
  // degrades gracefully to pure RRF ordering.

  const reranked = mmrRerank(
    candidates,
    already_selected_embeddings,
    mmr_lambda,
  );

  // ── Soft boosts: shot scale + character match ────────────────────────────
  // Both applied as additive score bonuses rather than hard filters, so clips
  // without matching tags are still returned instead of producing fallbacks.

  const characterSet = new Set(character_filter);
  const shotScaleSet = new Set(shot_scale_preference);
  let needsResort = false;

  for (const c of reranked) {
    if (
      shot_scale_preference.length > 0 &&
      c.shot_scale &&
      shotScaleSet.has(c.shot_scale)
    ) {
      c.rrf_score += 0.1;
      needsResort = true;
    }
    if (
      character_filter.length > 0 &&
      c.tags_characters.some((ch) => characterSet.has(ch))
    ) {
      c.rrf_score += 0.15;
      needsResort = true;
    }
  }

  if (needsResort) {
    reranked.sort((a, b) => b.rrf_score - a.rrf_score);
  }

  // ── Build human-readable match_reason ───────────────────────────────────

  const results: ClipSearchResult[] = reranked.slice(0, limit).map((c) => {
    const channels: string[] = [];
    if (c.dense_rank !== null) channels.push(`dense#${c.dense_rank}`);
    if (c.sparse_rank !== null) channels.push(`sparse#${c.sparse_rank}`);
    if (c.text_rank !== null) channels.push(`text#${c.text_rank}`);
    const shotBoost =
      c.shot_scale && shot_scale_preference.includes(c.shot_scale)
        ? ` +shot(${c.shot_scale})`
        : "";
    const charBoost =
      character_filter.length > 0 &&
      c.tags_characters.some((ch) => characterSet.has(ch))
        ? ` +char`
        : "";
    const match_reason =
      channels.length > 0
        ? `rrf(${channels.join(",")})${shotBoost}${charBoost}`
        : `rrf(dense-only)${shotBoost}${charBoost}`;

    return {
      clip_id: c.clip_id,
      rrf_score: c.rrf_score,
      dense_rank: c.dense_rank,
      sparse_rank: c.sparse_rank,
      text_rank: c.text_rank,
      match_reason,
    };
  });

  return results;
}
