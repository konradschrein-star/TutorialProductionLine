import type { GatewayFormat } from "../media-gateway/types.js";

/**
 * A request for one piece of footage. Shape is source-agnostic; the gateway
 * dispatches to whichever sources are configured for the format and routes
 * by priority order.
 */
export interface FootageRequest {
  /** Free-text search query — "Pixel 8 review", "skyscraper at night", "horse running". */
  query: string;
  /** Content format — drives the per-format priority order. */
  format: GatewayFormat;
  /** Target clip duration in seconds. Sources trim to this; 3–15 s is the sane range. */
  durationSeconds: number;
  /** Optional override: try these sources in this order instead of the format default. */
  sources?: ReadonlyArray<FootageSourceName>;
  /** Optional caller context for logging (e.g. job_id, scene_index). */
  context?: string;
  /** Optional clip-library slug to target a specific library (clip-library source only). */
  clipLibrarySlug?: string;
}

export type FootageSourceName = "yt-dlp" | "pexels" | "clip-library";

/**
 * What gets returned to the caller. `ref` is a relative path from
 * `FOOTAGE_DATA_DIR` (default `${LOCAL_MEDIA_ROOT}/footage`).
 * `localPath` is the absolute filesystem path on the VPS.
 */
export interface FootageResult {
  ref: string;
  localPath: string;
  source: FootageSourceName;
  durationSeconds: number;
  width: number;
  height: number;
  /** Best-available attribution string for credits (Pexels photographer, YouTube channel, etc.). */
  attribution: string | null;
  /** Source-specific metadata for logging/debugging. */
  providerMeta: Record<string, unknown>;
}

/**
 * Each source implements this. The gateway dispatches by name and respects
 * per-format priority order.
 */
export interface FootageSource {
  readonly name: FootageSourceName;
  /**
   * Try to fetch a clip matching the request. Returns `null` if the source
   * has nothing acceptable (gateway falls through to the next source).
   * Throws only on infrastructure failures (network down, ffmpeg crash).
   */
  fetch(req: FootageRequest): Promise<FootageResult | null>;
}

/** Errors that should never be retried — bad query, malformed library, etc. */
export class FootageNonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FootageNonRetryableError";
  }
}
