/**
 * Metadata Response Parser
 *
 * Pure function — no IO, no side effects.
 * Validates the raw Ollama JSON string and returns a typed YouTubeMetadata
 * object, or null if the response is malformed or empty.
 */

import type { YouTubeMetadata } from "./types.js";

/** Hard DB constraint on content_jobs.title */
const TITLE_MAX_CHARS = 100;

/**
 * Parse and validate the raw Ollama response string.
 *
 * Returns null (not throws) on any parse or validation failure.
 * The caller logs the failure and stores the raw output for debugging.
 */
export function parseMetadataResponse(raw: string): YouTubeMetadata | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "YouTube metadata JSON parse failed",
        error: err instanceof Error ? err.message : String(err),
        raw_snippet: raw.slice(0, 200),
      }),
    );
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).title !== "string" ||
    typeof (parsed as Record<string, unknown>).description !== "string" ||
    !Array.isArray((parsed as Record<string, unknown>).tags)
  ) {
    return null;
  }

  const obj = parsed as { title: string; description: string; tags: unknown[] };

  let title = obj.title.trim();
  if (!title) return null;

  // Hard clamp to DB varchar(100) — truncate at word boundary where possible
  if (title.length > TITLE_MAX_CHARS) {
    title = title.slice(0, TITLE_MAX_CHARS).trimEnd();
    // If we sliced mid-word, back up to the last space
    const lastSpace = title.lastIndexOf(" ");
    if (lastSpace > TITLE_MAX_CHARS * 0.7) {
      title = title.slice(0, lastSpace).trimEnd();
    }
  }

  const description = obj.description.trim();
  if (!description) return null;

  const tags = obj.tags
    .filter((t): t is string => typeof t === "string")
    .map((t) =>
      t
        .trim()
        .replace(/^#+/, "") // strip any # prefix — stored clean in DB
        .toLowerCase()
        .replace(/\s+/g, " "),
    )
    .filter(Boolean);

  return { title, description, tags };
}
