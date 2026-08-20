import { join } from "node:path";
import { createContextLogger } from "@repo/logger";
import {
  createDrizzleClient,
  clips,
  sourceVideos,
  clipLibraries,
  type DrizzleClient,
} from "@repo/db";
import { eq, and, or, sql } from "drizzle-orm";
import { evaluateClip } from "../footage-quality-gate.js";
import type { FootageRequest, FootageResult, FootageSource } from "./types.js";

const logger = createContextLogger("footage-clip-library");

// ── Lazy singleton DB connection ─────────────────────────────────────────────
// Option A from the spec: create once on first use, reuse for subsequent calls.
// Exported as `getDb` so tests can replace it via `__setDb`.
let _db: DrizzleClient | null = null;

export function getDb(): DrizzleClient {
  if (!_db) {
    const url = process.env["DATABASE_URL"];
    if (!url) {
      throw new Error(
        "clip-library footage source: DATABASE_URL env var is not set",
      );
    }
    _db = createDrizzleClient(url);
  }
  return _db;
}

/**
 * Test-only: inject a mock DrizzleClient so fetch() never opens a real PG
 * connection during unit tests. Pass `null` to reset the singleton.
 * @internal
 */
export function __setDb(db: DrizzleClient | null): void {
  _db = db;
}

// ── Public types ─────────────────────────────────────────────────────────────
export interface ApprovedClipRow {
  clip_id: string;
  library_id: string;
  source_video_id: string;
  /** Absolute filesystem path to the materialized clip file. */
  storage_key: string;
  ai_description: string | null;
}

// ── Core query helper ─────────────────────────────────────────────────────────
/**
 * Query `clips` + `sourceVideos` for approved clips that match `query`.
 * When `librarySlug` is given, additionally filters by `clipLibraries.slug`.
 *
 * Returns at most 1 row ordered by clip length DESC (longest first, to give
 * trim headroom). Returns an empty array when nothing matches.
 */
export async function queryApprovedClips(
  db: DrizzleClient,
  query: string,
  librarySlug?: string,
): Promise<ApprovedClipRow[]> {
  const likePattern = `%${query}%`;

  // Build the WHERE clause pieces. We always need "approved" + text match.
  const baseConditions = and(
    eq(clips.review_status, "approved"),
    or(
      sql`${clips.ai_description} ILIKE ${likePattern}`,
      sql`${sourceVideos.title} ILIKE ${likePattern}`,
    ),
  );

  // Construct the query. LEFT JOIN clipLibraries only when slug filter is needed.
  if (librarySlug) {
    const rows = await db
      .select({
        clip_id: clips.id,
        library_id: clips.library_id,
        source_video_id: clips.source_video_id,
        clip_storage_key: clips.storage_key,
        sv_storage_key: sourceVideos.storage_key,
        ai_description: clips.ai_description,
      })
      .from(clips)
      .innerJoin(sourceVideos, eq(clips.source_video_id, sourceVideos.id))
      .leftJoin(clipLibraries, eq(clips.library_id, clipLibraries.id))
      .where(and(baseConditions, eq(clipLibraries.slug, librarySlug)))
      .orderBy(sql`(${clips.end_ms} - ${clips.start_ms}) DESC`)
      .limit(1);

    return rows
      .filter((r) => r.clip_storage_key !== null || r.sv_storage_key !== null)
      .map((r) => ({
        clip_id: r.clip_id,
        library_id: r.library_id,
        source_video_id: r.source_video_id,
        // Prefer the materialized clip file; fall back to source video file.
        storage_key: (r.clip_storage_key ?? r.sv_storage_key)!,
        ai_description: r.ai_description,
      }));
  }

  // No slug filter — simpler query without the clipLibraries join.
  const rows = await db
    .select({
      clip_id: clips.id,
      library_id: clips.library_id,
      source_video_id: clips.source_video_id,
      clip_storage_key: clips.storage_key,
      sv_storage_key: sourceVideos.storage_key,
      ai_description: clips.ai_description,
    })
    .from(clips)
    .innerJoin(sourceVideos, eq(clips.source_video_id, sourceVideos.id))
    .where(baseConditions)
    .orderBy(sql`(${clips.end_ms} - ${clips.start_ms}) DESC`)
    .limit(1);

  return rows
    .filter((r) => r.clip_storage_key !== null || r.sv_storage_key !== null)
    .map((r) => ({
      clip_id: r.clip_id,
      library_id: r.library_id,
      source_video_id: r.source_video_id,
      storage_key: (r.clip_storage_key ?? r.sv_storage_key)!,
      ai_description: r.ai_description,
    }));
}

// ── LOCAL_MEDIA_ROOT helper ───────────────────────────────────────────────────
function localMediaRoot(): string {
  return process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";
}

/**
 * Derive a relative `ref` from an absolute `localPath`.
 * Example: "/opt/content-forge/media/clips/foo.mp4" → "clips/foo.mp4"
 * Falls back to `path.basename(localPath)` if the path doesn't start with
 * LOCAL_MEDIA_ROOT (edge case in dev with non-standard roots).
 */
function toRef(localPath: string): string {
  const root = localMediaRoot();
  if (localPath.startsWith(root + "/") || localPath.startsWith(root + "\\")) {
    return localPath.slice(root.length + 1).replace(/\\/g, "/");
  }
  return localPath.split(/[\\/]/).pop() ?? localPath;
}

// ── FootageSource implementation ──────────────────────────────────────────────
export const clipLibrarySource: FootageSource = {
  name: "clip-library",

  async fetch(req: FootageRequest): Promise<FootageResult | null> {
    const db = getDb();

    const rows = await queryApprovedClips(db, req.query, req.clipLibrarySlug);
    if (rows.length === 0) {
      logger.info(
        { query: req.query, librarySlug: req.clipLibrarySlug },
        "clip-library: no approved clips matched query",
      );
      return null;
    }

    const best = rows[0]!;
    const evalResult = await evaluateClip(best.storage_key);
    if (!evalResult.accepted) {
      logger.info(
        {
          query: req.query,
          clip_id: best.clip_id,
          reasons: evalResult.reasons,
        },
        "clip-library: clip rejected by quality gate",
      );
      return null;
    }

    return {
      ref: toRef(best.storage_key),
      localPath: best.storage_key,
      source: "clip-library",
      durationSeconds: evalResult.metrics.durationSeconds,
      width: evalResult.metrics.width,
      height: evalResult.metrics.height,
      attribution: null, // curated library — no public credit needed
      providerMeta: {
        clip_id: best.clip_id,
        library_id: best.library_id,
        source_video_id: best.source_video_id,
      },
    };
  },
};
