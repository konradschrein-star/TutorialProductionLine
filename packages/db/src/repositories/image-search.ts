/**
 * Image Search Repository — mirror of clip-search for the parallel images
 * table. Same RRF formula across dense + sparse + text channels, minus the
 * audio_class / transcript channels that don't apply to stills.
 *
 * Use searchImages() directly when you want just images, or searchMedia()
 * (exported from the index) which UNIONs clips + images for the unified
 * "best media for this shot" query the selection layer wants.
 */

import { sql } from "drizzle-orm";
import type { DrizzleClient } from "../client.js";

export interface ImageSearchParams {
  library_id: string;
  library_ids?: string[];
  query_dense: number[];
  query_sparse: { indices: number[]; values: number[] };
  query_text: string;
  limit?: number;
  shot_scale_preference?: string[];
  character_filter?: string[];
  clip_types?: string[];
  exclude_clip_types?: string[];
  lighting_styles?: string[];
  color_temperatures?: string[];
}

export interface ImageSearchResult {
  image_id: string;
  rrf_score: number;
  dense_rank: number | null;
  sparse_rank: number | null;
  text_rank: number | null;
  match_reason: string;
}

function rrfScore(ranks: (number | null)[]): number {
  return ranks.reduce<number>((sum, rank) => {
    if (rank === null) return sum;
    return sum + 1 / (60 + rank);
  }, 0);
}

export async function searchImages(
  db: DrizzleClient,
  params: ImageSearchParams,
): Promise<ImageSearchResult[]> {
  const {
    library_id,
    library_ids,
    query_dense,
    query_sparse,
    query_text,
    limit = 20,
    shot_scale_preference = [],
    character_filter = [],
    clip_types = [],
    exclude_clip_types = [],
    lighting_styles = [],
    color_temperatures = [],
  } = params;

  if (query_dense.length === 0) {
    throw new Error(
      "searchImages: empty dense vector — sidecar unavailable. Sequential fallback is disabled.",
    );
  }

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
  const lightingClause =
    lighting_styles.length > 0
      ? sql`AND (lighting_style IS NULL OR lighting_style = ANY(${lighting_styles}::text[]))`
      : sql``;
  const colorClause =
    color_temperatures.length > 0
      ? sql`AND (color_temperature IS NULL OR color_temperature = ANY(${color_temperatures}::text[]))`
      : sql``;

  const denseVecStr = `[${query_dense.join(",")}]`;

  // ── Channel 1: Dense ────────────────────────────────────────────────
  const denseRows = (await db.execute(sql`
    SELECT
      id,
      ROW_NUMBER() OVER (ORDER BY embedding <=> ${denseVecStr}::halfvec(384)) AS dense_rank,
      shot_scale,
      tags_characters
    FROM images
    WHERE ${libraryClause}
      AND review_status = 'approved'
      AND embedding IS NOT NULL
      AND duplicate_of_id IS NULL
      ${clipTypeClause}
      ${excludeClipTypeClause}
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

  if (denseRows.length === 0) return [];

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

  // ── Channel 2: Text ─────────────────────────────────────────────────
  const safeQueryText = query_text.replace(/['"\\]/g, " ").trim() || "image";
  let textRankById = new Map<string, number>();
  try {
    const textRows = (await db.execute(sql`
      SELECT
        id,
        ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(
            to_tsvector('english', COALESCE(ai_description, '')),
            plainto_tsquery('english', ${safeQueryText})
          ) DESC
        ) AS text_rank
      FROM images
      WHERE id = ANY(${topIds}::uuid[])
        AND to_tsvector('english', COALESCE(ai_description, ''))
            @@ plainto_tsquery('english', ${safeQueryText})
      LIMIT 50
    `)) as Array<{ id: string; text_rank: string }>;
    textRankById = new Map(textRows.map((r) => [r.id, Number(r.text_rank)]));
  } catch {
    textRankById = new Map();
  }

  // ── Channel 3: Sparse (jsonb overlap approximation) ─────────────────
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
        FROM images
        WHERE id = ANY(${topIds}::uuid[])
          AND embedding_sparse IS NOT NULL
        ORDER BY sparse_overlap DESC
      `)) as Array<{ id: string; sparse_overlap: string }>;
      sparseRows.forEach((r, idx) => {
        if (Number(r.sparse_overlap) > 0) sparseRankById.set(r.id, idx + 1);
      });
    } catch {
      sparseRankById = new Map();
    }
  }

  // ── Merge + soft boosts ─────────────────────────────────────────────
  const characterSet = new Set(character_filter);
  const shotScaleSet = new Set(shot_scale_preference);

  interface Scored {
    image_id: string;
    rrf_score: number;
    dense_rank: number | null;
    sparse_rank: number | null;
    text_rank: number | null;
    shot_scale: string | null;
    tags_characters: string[];
  }

  const candidates: Scored[] = topIds.map((id) => {
    const dr = denseRankById.get(id) ?? null;
    const sr = sparseRankById.get(id) ?? null;
    const tr = textRankById.get(id) ?? null;
    return {
      image_id: id,
      rrf_score: rrfScore([dr, sr, tr]),
      dense_rank: dr,
      sparse_rank: sr,
      text_rank: tr,
      shot_scale: shotScaleById.get(id) ?? null,
      tags_characters: tagsCharactersById.get(id) ?? [],
    };
  });

  for (const c of candidates) {
    if (
      shot_scale_preference.length > 0 &&
      c.shot_scale &&
      shotScaleSet.has(c.shot_scale)
    ) {
      c.rrf_score += 0.1;
    }
    if (
      character_filter.length > 0 &&
      c.tags_characters.some((ch) => characterSet.has(ch))
    ) {
      c.rrf_score += 0.15;
    }
  }

  candidates.sort((a, b) => b.rrf_score - a.rrf_score);

  return candidates.slice(0, limit).map((c) => {
    const channels: string[] = [];
    if (c.dense_rank !== null) channels.push(`dense#${c.dense_rank}`);
    if (c.sparse_rank !== null) channels.push(`sparse#${c.sparse_rank}`);
    if (c.text_rank !== null) channels.push(`text#${c.text_rank}`);
    return {
      image_id: c.image_id,
      rrf_score: c.rrf_score,
      dense_rank: c.dense_rank,
      sparse_rank: c.sparse_rank,
      text_rank: c.text_rank,
      match_reason: `rrf(${channels.join(",") || "dense-only"})`,
    };
  });
}
