import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

/**
 * Where a RANKING job's deliverables actually are — and, when they are
 * nowhere, exactly which places were looked in.
 *
 * ## Why this needs to exist at all
 *
 * Every other render workflow records its output twice: it writes
 * `content_jobs.final_video_path` and/or appends a `video/final-render` entry
 * to `r2_asset_manifest`. RANKING writes NEITHER.
 * `apps/worker-render/src/workflows/ranking-composition.ts` renders to
 *
 *     join(LOCAL_MEDIA_ROOT, job.channel_id, job.id, "final_video.mp4")
 *
 * and then updates only `final_video_size_bytes`,
 * `final_video_duration_seconds` and `render_completed_at` (lines 254-262).
 *
 * That single omission is why a finished ranking is unreachable:
 *
 *   - `/api/assets/[id]/[...key]` refuses it — the asset is not in the manifest.
 *   - The Drive delivery scanner never sees it. `collectFinishedJobArtifacts`
 *     calls `findFinalVideo(job.r2_asset_manifest, mediaRoot)`
 *     (`packages/storage/src/finished-jobs.ts`), which reads the manifest and
 *     ONLY the manifest — never `final_video_path`. It returns null, the
 *     scanner logs "finished job has no final video on disk yet", and no
 *     `storage_artifacts` row is ever created for the video.
 *
 * Verified on prod: job 797bc9b0 (AWAITING_UPLOADER) has
 * `final_video.mp4` on disk and Drive copies of its *metadata* and *thumbnail*
 * — but no `final_video` artifact row, so the video itself never left the VPS.
 *
 * ## The resolution order is three real places, not a guess
 *
 * Each candidate is a location something in this system genuinely writes, and
 * every one is confirmed with `stat()` before it is used. Nothing is inferred
 * from a status: a row claiming AWAITING_UPLOADER whose file is missing
 * resolves to `null` and reports what was checked, rather than handing back a
 * path that would 500 on read. The convention path is not speculation — it is
 * the literal expression the RANKING workflow renders to, quoted above.
 */

export interface VideoCandidate {
  source: "final_video_path" | "r2_asset_manifest" | "render_convention";
  path: string;
  exists: boolean;
}

export interface ResolvedRankingVideo {
  /** Absolute path to a file that exists, or null. */
  path: string | null;
  source: VideoCandidate["source"] | null;
  sizeBytes: number | null;
  /** Every location checked, in order, for diagnostics. */
  checked: VideoCandidate[];
}

/** UUID guard. Both ids become path segments, so this is also the traversal
 *  defence — never build a filesystem path out of an unvalidated string. */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Normalise a stored reference (`file://…`, absolute, or media-root-relative)
 *  into an absolute path. Mirrors `toMediaUrl`'s input handling. */
export function toAbsolute(raw: string, mediaRoot: string): string {
  let p = raw.trim();
  if (p.startsWith("file://")) p = p.slice("file://".length);
  return isAbsolute(p) ? p : join(mediaRoot, p);
}

/** The `video/final-render` key in an r2_asset_manifest, if present. */
function manifestFinalRender(manifest: unknown): string | null {
  if (!Array.isArray(manifest)) return null;
  for (const entry of manifest) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (e["type"] === "video/final-render" && typeof e["key"] === "string") {
      return e["key"];
    }
  }
  return null;
}

export async function resolveRankingVideo(
  job: {
    id: string;
    channel_id: string;
    final_video_path: string | null;
    r2_asset_manifest: unknown;
  },
  mediaRoot: string,
): Promise<ResolvedRankingVideo> {
  const candidates: Array<{ source: VideoCandidate["source"]; path: string }> =
    [];

  if (job.final_video_path?.trim()) {
    candidates.push({
      source: "final_video_path",
      path: toAbsolute(job.final_video_path, mediaRoot),
    });
  }

  const key = manifestFinalRender(job.r2_asset_manifest);
  if (key) {
    candidates.push({
      source: "r2_asset_manifest",
      path: toAbsolute(key, mediaRoot),
    });
  }

  // Only safe to construct once both ids are known-good UUIDs.
  if (UUID_RE.test(job.id) && UUID_RE.test(job.channel_id)) {
    candidates.push({
      source: "render_convention",
      path: join(mediaRoot, job.channel_id, job.id, "final_video.mp4"),
    });
  }

  const checked: VideoCandidate[] = [];
  let resolved: ResolvedRankingVideo = {
    path: null,
    source: null,
    sizeBytes: null,
    checked,
  };

  for (const c of candidates) {
    let size: number | null = null;
    try {
      const s = await stat(c.path);
      size = s.isFile() ? s.size : null;
    } catch {
      size = null;
    }
    checked.push({ ...c, exists: size !== null });
    if (size !== null && resolved.path === null) {
      resolved = {
        path: c.path,
        source: c.source,
        sizeBytes: size,
        checked,
      };
    }
  }

  return resolved;
}

/**
 * Parse a single-range `bytes=start-end` header.
 *
 * Copied in behaviour from `/api/production/jobs/[id]/download` — a `<video>`
 * issues `Range: bytes=0-` on load and further ranges to seek, and a server
 * that answers 200-with-the-whole-file gives a player that cannot scrub and,
 * on Safari, will not start at all. Multi-range is not supported (no player
 * asks for it) and anything unparseable falls back to a full body.
 */
export function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  let start: number;
  let end: number;
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}
