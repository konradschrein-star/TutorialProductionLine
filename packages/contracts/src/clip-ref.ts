/**
 * Clip reference identity helpers.
 *
 * `ref_base` is the human-readable, source-anchored prefix every clip
 * inherits. The hierarchy comes from how a video was acquired:
 *
 *   movie   → work_slug + ('/' + work_part)?
 *   series  → work_slug + '/' + season + '/' + episode
 *   youtube → youtube_id
 *   stock   → external_provider + '/' + external_id
 *   upload  → work_slug + '/' + external_id
 *   other   → work_slug + '/' + external_id
 *
 * `external_ref` is `ref_base + '/' + lpad(clip_index, 4, '0')`, e.g.
 *   star-wars-episode-iv/0042
 *   the-clone-wars/3/12/0042
 *   dQw4w9WgXcQ/0042
 *   pexels/12345-fire-burning/0042
 *
 * Stable, prompt-safe, and lets a sidebar query find the clip immediately
 * before or after any given clip without joining through prev/next pointers.
 */

export interface RefBaseSource {
  source_kind:
    | "movie"
    | "series"
    | "youtube"
    | "stock"
    | "upload"
    | "other"
    | null;
  work_slug: string | null;
  work_part: number | null;
  season: number | null;
  episode: number | null;
  youtube_id: string | null;
  external_provider: string | null;
  external_id: string | null;
}

/**
 * Build the `ref_base` prefix for a source_video.
 * Throws if required identity fields for the chosen source_kind are missing.
 */
export function buildRefBase(source: RefBaseSource): string {
  switch (source.source_kind) {
    case "movie": {
      if (!source.work_slug) {
        throw new Error("movie source requires work_slug");
      }
      return source.work_part != null
        ? `${source.work_slug}/${source.work_part}`
        : source.work_slug;
    }
    case "series": {
      if (!source.work_slug) {
        throw new Error("series source requires work_slug");
      }
      if (source.season == null || source.episode == null) {
        throw new Error("series source requires season and episode");
      }
      return `${source.work_slug}/${source.season}/${source.episode}`;
    }
    case "youtube": {
      if (!source.youtube_id) {
        throw new Error("youtube source requires youtube_id");
      }
      return source.youtube_id;
    }
    case "stock": {
      if (!source.external_provider || !source.external_id) {
        throw new Error(
          "stock source requires external_provider and external_id",
        );
      }
      return `${source.external_provider}/${source.external_id}`;
    }
    case "upload":
    case "other": {
      if (!source.work_slug || !source.external_id) {
        throw new Error(
          `${source.source_kind} source requires work_slug and external_id`,
        );
      }
      return `${source.work_slug}/${source.external_id}`;
    }
    default:
      throw new Error(
        `unknown source_kind: ${String(source.source_kind ?? "null")}`,
      );
  }
}

/**
 * Compose the per-clip external_ref from its source's ref_base and its
 * 0-based index. 4-digit zero-padding gives us up to 9999 clips per source
 * (more than enough for a single film) while keeping sort order intact.
 */
export function composeExternalRef(refBase: string, clipIndex: number): string {
  return `${refBase}/${String(clipIndex).padStart(4, "0")}`;
}

/**
 * Extract a YouTube video id from any of the common URL shapes:
 *   https://www.youtube.com/watch?v=dQw4w9WgXcQ
 *   https://youtu.be/dQw4w9WgXcQ
 *   https://www.youtube.com/shorts/dQw4w9WgXcQ
 *   https://www.youtube.com/embed/dQw4w9WgXcQ
 *   https://www.youtube.com/live/dQw4w9WgXcQ
 *   dQw4w9WgXcQ (bare id)
 * Returns null if no id can be found. Regex-only so it works in both Node
 * and Edge runtime without depending on the WHATWG URL global.
 */
export function parseYoutubeId(url: string): string | null {
  if (isYoutubeIdShape(url)) return url;
  const patterns: RegExp[] = [
    /[?&]v=([A-Za-z0-9_-]{8,20})/,
    /youtu\.be\/([A-Za-z0-9_-]{8,20})/i,
    /youtube\.com\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{8,20})/i,
  ];
  for (const re of patterns) {
    const m = re.exec(url);
    if (m && m[1] && isYoutubeIdShape(m[1])) return m[1];
  }
  return null;
}

function isYoutubeIdShape(id: string): boolean {
  // Standard ids are 11 chars; Shorts and edge cases can be slightly longer.
  return /^[A-Za-z0-9_-]{8,20}$/.test(id);
}
