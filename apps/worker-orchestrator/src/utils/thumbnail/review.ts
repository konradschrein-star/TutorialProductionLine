/**
 * Thumbnail review seam.
 *
 * There is NO thumbnail scoring today. This file is a typed, drop-in seam so a
 * later step can score generated thumbnails with the real Gemini multimodal
 * pool WITHOUT touching any callers. It is intentionally exported-but-unused:
 * wire it into the thumbnail pipeline (e.g. after `requestThumbnail` produces
 * an `output_path` in ./index.ts) when the review feature is built.
 *
 * ── Intended backend ───────────────────────────────────────────────────────
 * `apps/gemini-multimodal-pool` is a Hono service (default PORT 8094) that
 * drives a real logged-in Gemini browser tab via Playwright. Its run route
 * (`apps/gemini-multimodal-pool/src/routes/run.ts`, mounted at POST /) accepts:
 *
 *     { prompt: string, image_paths?: string[], video_paths?: string[] }
 *
 * and returns `{ text, attachment_count, elapsed_ms }`. A sibling reference
 * implementation of the browser flow lives in
 * `packages/validation-browser/gemini-playwright-review.mjs`.
 *
 * ── How to wire it (later) ──────────────────────────────────────────────────
 *  1. Read the pool base URL from env, e.g.
 *       const base = process.env["GEMINI_POOL_URL"] ?? "http://localhost:8094";
 *  2. POST to `${base}/` with a scoring prompt that asks Gemini to return
 *     STRICT JSON, and `image_paths: [input.imagePath]` (the pool reads files
 *     from disk by path — pass imagePath, not imageUrl, when running on the
 *     same host).
 *  3. Parse the `text` field as JSON into { score, verdict, notes } and clamp
 *     `score` to 0..100. Set `reviewed: true`.
 *  4. Persist the result — the natural home is a `thumbnails` column
 *     (e.g. review_score / review_verdict / review_notes) added via migration,
 *     written next to `updateThumbnailRecord` in ./index.ts.
 *
 * Until then, `reviewThumbnail` is a SAFE STUB: it performs no network calls
 * and always reports "not reviewed", so it is harmless to call anywhere.
 */

export interface ThumbnailReview {
  /** 0..100 human-watchability / click-worthiness score, or null if unscored. */
  score: number | null;
  /** Short machine-readable verdict, e.g. "strong" | "weak" | "not_reviewed". */
  verdict: string;
  /** Free-form reviewer notes (or an explanation of why it was not reviewed). */
  notes: string;
  /** True only once a real review backend has actually scored the image. */
  reviewed: boolean;
}

export interface ReviewThumbnailInput {
  /** Public/served URL of the thumbnail image (optional). */
  imageUrl?: string;
  /** Absolute on-disk path to the thumbnail image (preferred for the pool). */
  imagePath?: string;
  /** Video title the thumbnail is for — context for the reviewer. */
  title: string;
}

/**
 * Reviews a thumbnail image. Currently a safe stub — see the file-level doc
 * comment for how to swap in the gemini-multimodal-pool backend. Never throws
 * and never touches the network.
 */
export async function reviewThumbnail(
  _input: ReviewThumbnailInput,
): Promise<ThumbnailReview> {
  return {
    score: null,
    verdict: "not_reviewed",
    notes: "Gemini thumbnail review not yet wired — see review.ts",
    reviewed: false,
  };
}
