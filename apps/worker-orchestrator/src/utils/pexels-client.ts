/**
 * Pexels API client.
 *
 * https://www.pexels.com/api/documentation/
 *
 * Fetches photo metadata + a download URL by Pexels photo id or search query.
 * License is Pexels-standard (free for use, attribution recommended).
 */
import { createContextLogger } from "@repo/logger";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const logger = createContextLogger("pexels");

const PEXELS_API_BASE = "https://api.pexels.com/v1";
const PEXELS_VIDEO_BASE = "https://api.pexels.com/videos";

/**
 * Pexels applies a short-window BURST throttle on top of the hourly quota and
 * answers 429 `{"code":"Too Many Requests","message":"Throttle limit exceeded"}`
 * while the quota still has thousands of calls left. A sequential sourcing pass
 * over a dozen scenes trips it, and the throttle clears in a second or two.
 *
 * This retries the transient statuses only (429 and 5xx) with exponential
 * backoff and honours `Retry-After` when the server sends one. It changes
 * NOTHING about what is accepted: a 4xx that is not 429 is returned to the
 * caller on the first attempt, and after the last attempt the real response is
 * returned so the caller still throws with the real status and body.
 */
const PEXELS_RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const PEXELS_MAX_ATTEMPTS = 5;
const PEXELS_BACKOFF_BASE_MS = 1_500;

async function fetchPexelsWithBackoff(
  url: string,
  apiKey: string,
  timeoutMs: number,
): Promise<Response> {
  let response: Response | undefined;
  for (let attempt = 1; attempt <= PEXELS_MAX_ATTEMPTS; attempt++) {
    response = await fetch(url, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!PEXELS_RETRY_STATUSES.has(response.status)) return response;
    if (attempt === PEXELS_MAX_ATTEMPTS) return response;

    const retryAfterRaw = response.headers.get("retry-after");
    const retryAfterMs =
      retryAfterRaw !== null && Number.isFinite(Number(retryAfterRaw))
        ? Number(retryAfterRaw) * 1_000
        : null;
    const waitMs = retryAfterMs ?? PEXELS_BACKOFF_BASE_MS * 2 ** (attempt - 1);
    logger.warn(
      { url, status: response.status, attempt, wait_ms: waitMs },
      "Pexels throttled the request; backing off and retrying",
    );
    await new Promise((done) => setTimeout(done, waitMs));
  }
  // Unreachable: the loop returns on the last attempt.
  throw new Error(
    `Pexels retry loop exited without a response for ${url}. This is an internal invariant violation.`,
  );
}

interface PexelsPhotoResponse {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  photographer_id: number;
  avg_color: string;
  alt: string | null;
  src: {
    original: string;
    large2x: string;
    large: string;
    medium: string;
    small: string;
    portrait: string;
    landscape: string;
    tiny: string;
  };
}

export interface PexelsPhoto {
  id: number;
  /** Download URL for the ORIGINAL upload — the only Pexels render whose size matches `width`/`height`. */
  download_url: string;
  width: number;
  height: number;
  alt: string | null;
  attribution: {
    provider: "pexels";
    photographer: string;
    photographer_url: string;
    photographer_id: number;
    source_url: string;
  };
  license: {
    name: "Pexels License";
    url: "https://www.pexels.com/license/";
    /** Pexels allows free use with optional attribution; commercial OK. */
    commercial_ok: true;
    attribution_required: false;
  };
  /** Pexels-supplied average hex color (#rrggbb). Cheap palette hint. */
  avg_color_hex: string;
}

export interface PexelsVideo {
  id: number;
  /** Duration in seconds. */
  duration: number;
  /** Best available mp4 URL (highest resolution ≤ 1920px wide). */
  download_url: string;
  width: number;
  height: number;
  attribution: {
    provider: "pexels";
    photographer: string;
    source_url: string;
  };
}

interface PexelsSearchResponse {
  total_results: number;
  page: number;
  per_page: number;
  photos: PexelsPhotoResponse[];
  next_page?: string;
}

interface PexelsVideoFile {
  id: number;
  quality: string;
  file_type: string;
  width: number | null;
  height: number | null;
  link: string;
}

interface PexelsVideoItem {
  id: number;
  width: number;
  height: number;
  duration: number;
  url: string;
  user: { name: string; url: string };
  video_files: PexelsVideoFile[];
}

interface PexelsVideoSearchResponse {
  total_results: number;
  videos: PexelsVideoItem[];
}

/**
 * Fetch a Pexels photo by id and normalise into our PexelsPhoto shape.
 * Throws on non-2xx (caller decides retry).
 */
export async function fetchPexelsPhoto(
  photoId: string | number,
  apiKey: string,
): Promise<PexelsPhoto> {
  if (!apiKey) {
    throw new Error("PEXELS_API_KEY not configured");
  }

  const url = `${PEXELS_API_BASE}/photos/${photoId}`;
  const response = await fetchPexelsWithBackoff(url, apiKey, 20_000);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Pexels API ${response.status} for photo ${photoId}: ${body.slice(0, 200)}`,
    );
  }

  const data = (await response.json()) as PexelsPhotoResponse;
  logger.info(
    { photo_id: data.id, photographer: data.photographer },
    "pexels photo fetched",
  );

  return {
    id: data.id,
    // `original` — NOT `large2x`. Pexels renders `large2x` at a fixed
    // w=940&dpr=2, i.e. exactly 1880px wide for every photo in the library, so
    // it can never satisfy a 1920px floor. `width`/`height` below describe the
    // ORIGINAL upload, so returning `large2x` also made this object describe an
    // asset it was not handing back.
    download_url: data.src.original ?? data.src.large2x ?? data.src.large,
    width: data.width,
    height: data.height,
    alt: data.alt,
    attribution: {
      provider: "pexels",
      photographer: data.photographer,
      photographer_url: data.photographer_url,
      photographer_id: data.photographer_id,
      source_url: data.url,
    },
    license: {
      name: "Pexels License",
      url: "https://www.pexels.com/license/",
      commercial_ok: true,
      attribution_required: false,
    },
    avg_color_hex: data.avg_color,
  };
}

/**
 * Search Pexels photos by query string. Returns up to `perPage` results.
 * Picks orientation=landscape by default (good for video backgrounds/hero shots).
 */
export async function searchPexelsPhotos(
  query: string,
  apiKey: string,
  options: {
    perPage?: number;
    orientation?: "landscape" | "portrait" | "square";
  } = {},
): Promise<PexelsPhoto[]> {
  if (!apiKey) throw new Error("PEXELS_API_KEY not configured");

  const { perPage = 5, orientation = "landscape" } = options;
  const params = new URLSearchParams({
    query,
    per_page: String(perPage),
    orientation,
  });

  const response = await fetchPexelsWithBackoff(
    `${PEXELS_API_BASE}/search?${params}`,
    apiKey,
    20_000,
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Pexels search failed (${response.status}) for "${query}": ${body.slice(0, 200)}`,
    );
  }

  const data = (await response.json()) as PexelsSearchResponse;
  logger.info(
    { query, total: data.total_results, returned: data.photos.length },
    "pexels photo search",
  );

  return data.photos.map((p) => ({
    id: p.id,
    // `original` for the same reason as getPexelsPhoto above: `large2x` is a
    // fixed 1880px-wide render and `width`/`height` describe the original.
    download_url: p.src.original ?? p.src.large2x ?? p.src.large,
    width: p.width,
    height: p.height,
    alt: p.alt,
    attribution: {
      provider: "pexels" as const,
      photographer: p.photographer,
      photographer_url: p.photographer_url,
      photographer_id: p.photographer_id,
      source_url: p.url,
    },
    license: {
      name: "Pexels License" as const,
      url: "https://www.pexels.com/license/" as const,
      commercial_ok: true as const,
      attribution_required: false as const,
    },
    avg_color_hex: p.avg_color,
  }));
}

/**
 * Search Pexels videos by query. Returns up to `perPage` results.
 * Picks best-resolution mp4 file ≤ 1920px wide.
 */
export async function searchPexelsVideos(
  query: string,
  apiKey: string,
  options: {
    perPage?: number;
    minDuration?: number;
    maxDuration?: number;
  } = {},
): Promise<PexelsVideo[]> {
  if (!apiKey) throw new Error("PEXELS_API_KEY not configured");

  const { perPage = 5, minDuration, maxDuration } = options;
  const params = new URLSearchParams({ query, per_page: String(perPage) });
  if (minDuration != null) params.set("min_duration", String(minDuration));
  if (maxDuration != null) params.set("max_duration", String(maxDuration));

  const response = await fetchPexelsWithBackoff(
    `${PEXELS_VIDEO_BASE}/search?${params}`,
    apiKey,
    20_000,
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Pexels video search failed (${response.status}) for "${query}": ${body.slice(0, 200)}`,
    );
  }

  const data = (await response.json()) as PexelsVideoSearchResponse;
  logger.info(
    { query, total: data.total_results, returned: data.videos.length },
    "pexels video search",
  );

  return data.videos
    .map((v) => {
      // Pick best mp4 ≤ 1920px
      const mp4Files = v.video_files
        .filter((f) => f.file_type === "video/mp4" && f.link)
        .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
      const bestFile =
        mp4Files.find((f) => (f.width ?? 0) <= 1920) ?? mp4Files[0];

      return {
        id: v.id,
        duration: v.duration,
        download_url: bestFile?.link ?? "",
        width: bestFile?.width ?? v.width,
        height: bestFile?.height ?? v.height,
        attribution: {
          provider: "pexels" as const,
          photographer: v.user.name,
          source_url: v.url,
        },
      };
    })
    .filter((v) => v.download_url);
}

/**
 * Download a URL to a local file path. Creates parent directories as needed.
 * Returns the local path on success.
 */
export async function downloadUrlToFile(
  url: string,
  destPath: string,
): Promise<string> {
  await mkdir(dirname(destPath), { recursive: true });

  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}) from ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(destPath, buffer);
  logger.info({ url, destPath, bytes: buffer.length }, "downloaded asset");
  return destPath;
}
