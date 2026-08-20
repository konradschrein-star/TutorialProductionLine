/**
 * Unified media search — runs searchClips + searchImages with the same
 * embedding query in parallel, merges results by RRF score, returns rows
 * with a `kind` discriminator. Selection code asks for "best media for
 * shot X" and gets the strongest candidate of either kind.
 *
 * Filters cover both surfaces. Filters that apply to only one kind
 * (motion_level_max, source_kinds — video-only; lighting_styles +
 * character_filter — both) are forwarded to the underlying repos.
 */
import type { DrizzleClient } from "../client.js";
import { searchClips, type ClipSearchParams } from "./clip-search.js";
import { searchImages, type ImageSearchParams } from "./image-search.js";

export type MediaKind = "clip" | "image";

export interface MediaSearchParams
  extends
    Omit<ClipSearchParams, never>,
    Partial<Pick<ImageSearchParams, never>> {
  /** Restrict to one kind. Defaults to both. */
  kinds?: MediaKind[];
}

export interface MediaSearchResult {
  kind: MediaKind;
  /** clip_id when kind='clip'; image_id when kind='image'. */
  media_id: string;
  rrf_score: number;
  match_reason: string;
}

export async function searchMedia(
  db: DrizzleClient,
  params: MediaSearchParams,
): Promise<MediaSearchResult[]> {
  const kinds = params.kinds ?? ["clip", "image"];
  const wantsClips = kinds.includes("clip");
  const wantsImages = kinds.includes("image");

  const [clipResults, imageResults] = await Promise.all([
    wantsClips ? searchClips(db, params) : Promise.resolve([]),
    wantsImages
      ? searchImages(db, {
          library_id: params.library_id,
          library_ids: params.library_ids,
          query_dense: params.query_dense,
          query_sparse: params.query_sparse,
          query_text: params.query_text,
          limit: params.limit,
          shot_scale_preference: params.shot_scale_preference,
          character_filter: params.character_filter,
          clip_types: params.clip_types,
          exclude_clip_types: params.exclude_clip_types,
          lighting_styles: params.lighting_styles,
          color_temperatures: params.color_temperatures,
        })
      : Promise.resolve([]),
  ]);

  const merged: MediaSearchResult[] = [
    ...clipResults.map((r) => ({
      kind: "clip" as const,
      media_id: r.clip_id,
      rrf_score: r.rrf_score,
      match_reason: `clip:${r.match_reason}`,
    })),
    ...imageResults.map((r) => ({
      kind: "image" as const,
      media_id: r.image_id,
      rrf_score: r.rrf_score,
      match_reason: `image:${r.match_reason}`,
    })),
  ];

  merged.sort((a, b) => b.rrf_score - a.rrf_score);

  const cap = params.limit ?? 20;
  return merged.slice(0, cap);
}
