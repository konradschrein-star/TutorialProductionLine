/**
 * Job artefact resolution — "where is my stuff, and does it actually exist?"
 *
 * The job detail page used to show a video player only when a very narrow set
 * of conditions held, and showed nothing at all otherwise. Clicking "view" on a
 * published job therefore produced a blank page with no explanation.
 *
 * The root cause is worse than a UI bug, and this module is built around it:
 * the database's record of artefacts and the actual filesystem have drifted
 * apart. Verified against production on 2026-07-28:
 *
 *   - every `video/final-render` path recorded in `r2_asset_manifest` pointed
 *     at a file that no longer exists on disk;
 *   - the job directories that *do* contain a `final_video.mp4` belong to jobs
 *     with no database row at all;
 *   - one row stores `r2_asset_manifest` as a JSON *string* rather than an array.
 *
 * So this resolver treats the FILESYSTEM as ground truth and the database as an
 * index that may be stale. Every artefact carries an explicit `presence`:
 *
 *   "present" — the file is on disk right now and can be streamed.
 *   "missing" — something recorded it, but the file is gone. We still show the
 *               path, because knowing where it *was* is the whole point.
 *   "remote"  — it lives on an external URL (e.g. a CDN), not on our disk.
 *
 * Nothing here fabricates. If an artefact was never produced, it is simply
 * absent from the list and the UI says so.
 *
 * Server-only: this stat()s and readdir()s the media root. It never throws —
 * a broken media root degrades to an empty view plus a warning string.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import type { Job } from "@/lib/repositories/job-repository";
import { listThumbnailsForSubject } from "@/lib/repositories/thumbnail-studio-repository";

// ── Types ──────────────────────────────────────────────────────────────────

export type ArtifactPresence = "present" | "missing" | "remote";

export type ArtifactKind =
  | "video"
  | "image"
  | "audio"
  | "subtitle"
  | "data"
  | "other";

export interface JobArtifact {
  /** Stable key for React lists. */
  id: string;
  kind: ArtifactKind;
  /** Human role, e.g. "Final render", "Scene image", "Narration". */
  role: string;
  /** File name for display. */
  name: string;
  /**
   * The REAL storage location, exactly as recorded or discovered. Absolute disk
   * path for local files, the URL for remote ones. Always shown to the user.
   */
  storagePath: string;
  /** Streamable URL, or null when the bytes are not reachable. */
  url: string | null;
  presence: ArtifactPresence;
  sizeBytes: number | null;
  modifiedAt: string | null;
  /** Where we learned about this artefact. Surfaced so drift is explainable. */
  source: "manifest" | "disk" | "metadata" | "thumbnails" | "assembly";
}

export interface JobArtifactsView {
  /** Configured LOCAL_MEDIA_ROOT, or null when unset. */
  mediaRoot: string | null;
  /** The directory this job's media should live in. */
  jobDir: {
    path: string;
    exists: boolean;
    /** Every layout we probed, for an honest "we looked here" message. */
    probed: string[];
  };
  finalVideo: JobArtifact | null;
  thumbnail: JobArtifact | null;
  images: JobArtifact[];
  audio: JobArtifact[];
  otherFiles: JobArtifact[];
  /** Everything, deduped — used for the "all files" table. */
  all: JobArtifact[];
  youtube: {
    videoId: string;
    url: string;
    publishedAt: string | null;
  } | null;
  /** Honest diagnostics shown to the operator (data drift, bad shapes, …). */
  warnings: string[];
  counts: {
    present: number;
    missing: number;
    remote: number;
  };
}

// ── Path helpers ───────────────────────────────────────────────────────────

const VIDEO_EXT = new Set([".mp4", ".webm", ".mov", ".mkv"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"]);
const SUBTITLE_EXT = new Set([".ass", ".srt", ".vtt"]);
const DATA_EXT = new Set([".json", ".txt", ".md", ".csv"]);

function kindForFile(name: string): ArtifactKind {
  const ext = extname(name).toLowerCase();
  if (VIDEO_EXT.has(ext)) return "video";
  if (IMAGE_EXT.has(ext)) return "image";
  if (AUDIO_EXT.has(ext)) return "audio";
  if (SUBTITLE_EXT.has(ext)) return "subtitle";
  if (DATA_EXT.has(ext)) return "data";
  return "other";
}

function isRemote(raw: string): boolean {
  return /^https?:\/\//i.test(raw);
}

/** Normalise a recorded key/path to an absolute on-disk path, if it is local. */
function toAbsPath(raw: string, mediaRoot: string): string | null {
  if (isRemote(raw)) return null;
  let p = raw.startsWith("file://") ? raw.slice("file://".length) : raw;
  p = p.replace(/\\/g, "/");
  if (p.startsWith("/") || /^[a-zA-Z]:\//.test(p)) return p;
  return mediaRoot ? resolve(join(mediaRoot, p)).replace(/\\/g, "/") : null;
}

/**
 * Map an absolute media path to the streaming route. Returns null when the file
 * is outside the media root, because /api/media can only serve from inside it.
 */
function toServedUrl(absPath: string, mediaRoot: string): string | null {
  if (!mediaRoot) return null;
  const normRoot = mediaRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const normPath = absPath.replace(/\\/g, "/");
  if (!normPath.startsWith(normRoot + "/")) return null;
  const rel = normPath.slice(normRoot.length + 1);
  return `/api/media/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

function statOf(absPath: string): { size: number; mtime: string } | null {
  try {
    const s = statSync(absPath);
    if (!s.isFile()) return null;
    return { size: s.size, mtime: s.mtime.toISOString() };
  } catch {
    return null;
  }
}

/** Build an artefact record from a local path, checking whether it exists. */
function localArtifact(
  absPath: string,
  mediaRoot: string,
  role: string,
  source: JobArtifact["source"],
): JobArtifact {
  const name = absPath.split("/").pop() ?? absPath;
  const st = statOf(absPath);
  return {
    id: `${source}:${absPath}`,
    kind: kindForFile(name),
    role,
    name,
    storagePath: absPath,
    url: st ? toServedUrl(absPath, mediaRoot) : null,
    presence: st ? "present" : "missing",
    sizeBytes: st?.size ?? null,
    modifiedAt: st?.mtime ?? null,
    source,
  };
}

function remoteArtifact(
  url: string,
  role: string,
  source: JobArtifact["source"],
): JobArtifact {
  const name = url.split("/").pop()?.split("?")[0] ?? url;
  return {
    id: `${source}:${url}`,
    kind: kindForFile(name),
    role,
    name,
    storagePath: url,
    url,
    presence: "remote",
    sizeBytes: null,
    modifiedAt: null,
    source,
  };
}

// ── Manifest reading (defensive: the column is not always an array) ────────

interface ManifestEntry {
  key: string;
  type: string;
  size_bytes?: number;
}

function readManifest(
  raw: unknown,
  warnings: string[],
): { entries: ManifestEntry[] } {
  if (raw == null) return { entries: [] };
  if (Array.isArray(raw)) {
    const entries = raw.filter(
      (e): e is ManifestEntry =>
        !!e &&
        typeof e === "object" &&
        typeof (e as ManifestEntry).key === "string" &&
        (e as ManifestEntry).key !== "skipped",
    );
    return { entries };
  }
  // Production contains at least one row where this column is stored as a JSON
  // *string* rather than an array (job d9396eca…). Try to parse it once — on
  // success we recover the manifest and note it; on failure we keep the honest
  // warning. Never silently swallow the drift.
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        warnings.push(
          "Asset manifest was stored as a JSON string rather than an array; " +
            "it was parsed successfully. This is a data-shape drift worth fixing " +
            "at the source.",
        );
        return readManifest(parsed, warnings);
      }
    } catch {
      // fall through to the warning below
    }
  }
  warnings.push(
    `Asset manifest is stored as ${typeof raw === "object" ? "an object" : `a ${typeof raw}`}, ` +
      `not an array — this job's manifest could not be read. The file listing below ` +
      `comes from disk instead.`,
  );
  return { entries: [] };
}

/** Human label for a manifest `type` string. */
function roleForManifestType(type: string): string {
  switch (type) {
    case "video/final-render":
      return "Final render";
    case "image/broll":
      return "Scene image";
    case "image/thumbnail":
      return "Thumbnail";
    case "audio/tts":
      return "Narration (TTS)";
    case "audio/commentary-segment":
      return "Commentary segment";
    case "subtitle/ass":
      return "Subtitles";
    case "document/script":
      return "Script";
    case "video/raw-va-footage":
      return "VA footage";
    case "video/reference-source":
      return "Reference source";
    case "research/perplexity":
      return "Research";
    default:
      return type;
  }
}

// ── Disk scan ──────────────────────────────────────────────────────────────

const MAX_SCANNED_FILES = 400;

/**
 * Recursively list files under a directory, capped. This is the ground-truth
 * pass: whatever is actually there gets shown, whether or not the DB knows.
 */
function scanDir(
  dir: string,
  mediaRoot: string,
  out: JobArtifact[],
  depth = 0,
): void {
  if (out.length >= MAX_SCANNED_FILES || depth > 2) return;
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_SCANNED_FILES) return;
    const full = join(dir, entry.name).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      scanDir(full, mediaRoot, out, depth + 1);
    } else if (entry.isFile()) {
      out.push(
        localArtifact(full, mediaRoot, roleForFilename(entry.name), "disk"),
      );
    }
  }
}

/** Infer a role from a filename produced by one of the pipelines. */
function roleForFilename(name: string): string {
  const n = name.toLowerCase();
  if (/^final(_video)?\.(mp4|webm|mov)$/.test(n)) return "Final render";
  if (/^output\.(mp4|webm|mov)$/.test(n)) return "Final render";
  if (n.startsWith("final_video")) return "Render variant";
  if (/^scene_\d+.*\.(png|jpg|jpeg|webp)$/.test(n)) return "Scene image";
  if (n.startsWith("thumbnail")) return "Thumbnail";
  if (n === "audio_tts.wav" || n === "narration.mp3" || n === "tts.mp3")
    return "Narration (TTS)";
  if (n.startsWith("commentary_")) return "Commentary segment";
  if (n === "custom-narration.mp3") return "VA narration";
  if (n === "source.mp4") return "Reference source";
  if (n.endsWith(".ass") || n.endsWith(".srt") || n.endsWith(".vtt"))
    return "Subtitles";
  if (n === "transcript.json" || n === "source_audio.json") return "Transcript";
  if (n === "bed.mp3") return "Music bed";
  return "File";
}

// ── Job directory resolution ───────────────────────────────────────────────

/**
 * Media is not laid out consistently. Probe every layout the workers use and
 * report which ones we looked at, so "nothing here" is explainable.
 */
function resolveJobDir(
  job: Job,
  mediaRoot: string,
): { path: string; exists: boolean; probed: string[] } {
  const candidates: string[] = [];
  if (mediaRoot) {
    if (job.channel_id) {
      candidates.push(join(mediaRoot, job.channel_id, job.id));
    }
    // Some job ids sit directly at the media root.
    candidates.push(join(mediaRoot, job.id));
    // Drama layout (no channel segment). NOTE: `<root>/tutorial/<id>` is
    // deliberately NOT probed — a content_jobs.id never lives there (D7); the
    // tutorial operation is a separate table and directory tree. Probing it
    // would be a wasted stat on every job and invites a future id collision.
    candidates.push(join(mediaRoot, "long-form-drama", job.id));
  }
  const probed = candidates.map((c) => c.replace(/\\/g, "/"));
  for (const c of probed) {
    if (existsSync(c)) return { path: c, exists: true, probed };
  }
  return { path: probed[0] ?? "", exists: false, probed };
}

// ── Final video selection ──────────────────────────────────────────────────

const FINAL_NAMES = ["final_video.mp4", "final.mp4", "output.mp4"];

function pickFinalVideo(all: JobArtifact[]): JobArtifact | null {
  const videos = all.filter((a) => a.kind === "video");
  // A playable file always wins over a recorded-but-missing one.
  const present = videos.filter((a) => a.presence === "present");
  const pool = present.length > 0 ? present : videos;

  const exact = pool.find((a) => FINAL_NAMES.includes(a.name.toLowerCase()));
  if (exact) return exact;
  const byRole = pool.find((a) => a.role === "Final render");
  if (byRole) return byRole;
  // Fall back to the largest video — renders dwarf source clips in practice,
  // but only when we actually know sizes.
  const sized = pool.filter((a) => a.sizeBytes != null);
  if (sized.length > 0) {
    return sized.reduce((a, b) =>
      (b.sizeBytes ?? 0) > (a.sizeBytes ?? 0) ? b : a,
    );
  }
  return pool[0] ?? null;
}

// ── Main entry point ───────────────────────────────────────────────────────

/**
 * Build the artefact view for a job. Reads the filesystem and the thumbnails
 * table. Pure read — never mutates, never throws.
 */
export async function buildJobArtifacts(job: Job): Promise<JobArtifactsView> {
  const warnings: string[] = [];
  const rawRoot = process.env["LOCAL_MEDIA_ROOT"] ?? "";
  const mediaRoot = rawRoot.replace(/\\/g, "/").replace(/\/+$/, "");

  if (!mediaRoot) {
    warnings.push(
      "LOCAL_MEDIA_ROOT is not configured on this server, so no local file can " +
        "be located or streamed. Only remote URLs and database records are shown.",
    );
  }

  const jobDir = resolveJobDir(job, mediaRoot);

  // 1. Ground truth: what is actually on disk right now.
  const byPath = new Map<string, JobArtifact>();
  if (jobDir.exists) {
    const scanned: JobArtifact[] = [];
    scanDir(jobDir.path, mediaRoot, scanned);
    if (scanned.length >= MAX_SCANNED_FILES) {
      warnings.push(
        `This job's folder contains more than ${MAX_SCANNED_FILES} files; the listing is truncated.`,
      );
    }
    for (const a of scanned) byPath.set(a.storagePath, a);
  }

  // 2. The database's index. Entries already found on disk are enriched with
  //    their recorded role; entries NOT on disk are kept and flagged missing —
  //    that is the signal that used to be invisible.
  const { entries } = readManifest(job.r2_asset_manifest, warnings);
  let missingFromManifest = 0;
  for (const entry of entries) {
    const role = roleForManifestType(entry.type);
    if (isRemote(entry.key)) {
      const art = remoteArtifact(entry.key, role, "manifest");
      if (!byPath.has(art.storagePath)) byPath.set(art.storagePath, art);
      continue;
    }
    const abs = toAbsPath(entry.key, mediaRoot);
    if (!abs) continue;
    const existing = byPath.get(abs);
    if (existing) {
      // Disk already found it — prefer the manifest's more precise role.
      existing.role = role;
      existing.source = "manifest";
      continue;
    }
    const art = localArtifact(abs, mediaRoot, role, "manifest");
    if (art.presence === "missing") missingFromManifest += 1;
    if (art.sizeBytes == null && typeof entry.size_bytes === "number") {
      art.sizeBytes = entry.size_bytes;
    }
    byPath.set(abs, art);
  }

  if (missingFromManifest > 0) {
    warnings.push(
      `${missingFromManifest} file${missingFromManifest === 1 ? "" : "s"} recorded in the ` +
        `database ${missingFromManifest === 1 ? "is" : "are"} no longer on disk. ` +
        `The recorded location is shown so you can see where it was; the file itself is gone ` +
        `(media is not backed up).`,
    );
  }

  // 2.5 Authoritative render path (migration 0048). When worker-render recorded
  //     where it put the final video, that is the source of truth — inference is
  //     only the fallback. If it is recorded but the file is gone we keep it and
  //     flag the discrepancy; we never silently fall back to a different video.
  let authoritativeFinalPath: string | null = null;
  const recordedFinal = job.final_video_path;
  if (typeof recordedFinal === "string" && recordedFinal.length > 0) {
    const abs = toAbsPath(recordedFinal, mediaRoot);
    if (abs) {
      const existing = byPath.get(abs);
      if (existing) {
        existing.role = "Final render";
        authoritativeFinalPath = abs;
      } else {
        const art = localArtifact(abs, mediaRoot, "Final render", "metadata");
        byPath.set(abs, art);
        authoritativeFinalPath = abs;
        if (art.presence === "missing") {
          warnings.push(
            "The recorded final-video path for this job is no longer on disk. " +
              "Its location is shown below; the file itself is gone (media is not " +
              "backed up).",
          );
        }
      }
    }
  }

  // 3. Format-specific locations the manifest does not cover.
  const metadata = (job.metadata ?? {}) as Record<string, unknown>;
  const metaPaths: Array<[unknown, string]> = [
    [metadata["drama_output_path"], "Final render"],
    [metadata["drama_thumbnail_path"], "Thumbnail"],
  ];
  for (const [value, role] of metaPaths) {
    if (typeof value !== "string" || value.length === 0) continue;
    const abs = toAbsPath(value, mediaRoot);
    if (!abs || byPath.has(abs)) continue;
    byPath.set(abs, localArtifact(abs, mediaRoot, role, "metadata"));
  }

  // RANKING narration lives on metadata as a file:// URL.
  const ranking = metadata["ranking"] as Record<string, unknown> | undefined;
  const rankingAudio = ranking?.["audioUrl"];
  if (typeof rankingAudio === "string" && rankingAudio.length > 0) {
    if (isRemote(rankingAudio)) {
      const art = remoteArtifact(rankingAudio, "Narration (TTS)", "metadata");
      if (!byPath.has(art.storagePath)) byPath.set(art.storagePath, art);
    } else {
      const abs = toAbsPath(rankingAudio, mediaRoot);
      if (abs && !byPath.has(abs)) {
        byPath.set(
          abs,
          localArtifact(abs, mediaRoot, "Narration (TTS)", "metadata"),
        );
      }
    }
  }

  // SPACE_VIDEO and others may only have a remote TTS URL.
  const ttsUrl = metadata["tts_audio_url"];
  if (typeof ttsUrl === "string" && isRemote(ttsUrl)) {
    const art = remoteArtifact(ttsUrl, "Narration (TTS)", "metadata");
    if (!byPath.has(art.storagePath)) byPath.set(art.storagePath, art);
  }

  // 4. Thumbnail — its own table, its own directory, not under the job dir.
  let thumbnail: JobArtifact | null = null;
  try {
    const rows = await listThumbnailsForSubject("content_job", job.id);
    const selected =
      rows.find((r) => r.is_selected && r.status === "completed") ??
      rows.find((r) => r.status === "completed");
    if (selected?.output_path) {
      const abs =
        toAbsPath(selected.output_path, mediaRoot) ?? selected.output_path;
      const st = statOf(abs);
      thumbnail = {
        id: `thumbnails:${selected.id}`,
        kind: "image",
        role: "Thumbnail",
        name: abs.split("/").pop() ?? "thumbnail.jpg",
        storagePath: abs,
        // The thumbnails route serves by row id and lives outside the media root.
        url: st ? `/api/thumbnails/image/${selected.id}` : null,
        presence: st ? "present" : "missing",
        sizeBytes: st?.size ?? null,
        modifiedAt: st?.mtime ?? null,
        source: "thumbnails",
      };
      if (!byPath.has(abs)) byPath.set(abs, thumbnail);
    } else if (rows.length > 0) {
      const failed = rows.filter((r) => r.status === "failed").length;
      if (failed === rows.length) {
        warnings.push(
          `All ${rows.length} thumbnail generation attempt${rows.length === 1 ? "" : "s"} for ` +
            `this job failed, so no thumbnail image exists.`,
        );
      }
    }
  } catch {
    warnings.push("Could not read the thumbnails table.");
  }

  // Fall back to a thumbnail file sitting in the job dir.
  if (!thumbnail) {
    thumbnail =
      [...byPath.values()].find(
        (a) => a.role === "Thumbnail" && a.kind === "image",
      ) ?? null;
  }

  const all = [...byPath.values()].sort((a, b) => {
    if (a.presence !== b.presence) return a.presence === "present" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // Prefer the authoritative recorded path when we have one; otherwise infer.
  const finalVideo =
    (authoritativeFinalPath
      ? all.find((a) => a.storagePath === authoritativeFinalPath)
      : null) ?? pickFinalVideo(all);

  const images = all.filter(
    (a) => a.kind === "image" && a.id !== thumbnail?.id,
  );
  const audio = all.filter((a) => a.kind === "audio");
  const otherFiles = all.filter(
    (a) =>
      a.id !== finalVideo?.id &&
      a.id !== thumbnail?.id &&
      a.kind !== "image" &&
      a.kind !== "audio",
  );

  const youtube = job.youtube_video_id
    ? {
        videoId: job.youtube_video_id,
        url: `https://www.youtube.com/watch?v=${job.youtube_video_id}`,
        publishedAt: job.published_at
          ? new Date(job.published_at).toISOString()
          : null,
      }
    : null;

  return {
    mediaRoot: mediaRoot || null,
    jobDir,
    finalVideo,
    thumbnail,
    images,
    audio,
    otherFiles,
    all,
    youtube,
    warnings,
    counts: {
      present: all.filter((a) => a.presence === "present").length,
      missing: all.filter((a) => a.presence === "missing").length,
      remote: all.filter((a) => a.presence === "remote").length,
    },
  };
}
