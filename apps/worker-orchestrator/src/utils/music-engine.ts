/**
 * Format-agnostic background music engine.
 *
 * Drama, and any future format that wants a music bed calls
 * `assembleMusicBed()` with its own prompt + duration target,
 * and gets back a list of tracks long enough to cover the target.
 *
 * Two modes:
 *  - `"generate"`: hit Suno (via `generateSunoMusic`) batch-of-3 until
 *    we cover the target. Every track gets written to `music_library`
 *    tagged with `format` so it can be reused later.
 *  - `"library"`: pull random ready rows from `music_library` where
 *    `format = <this format>` until we cover the target. Falls back
 *    to `"generate"` if the library is empty (or too small).
 *
 * The caller is responsible for the final ffmpeg mix step — this
 * util only produces a list of mp3 files on disk.
 */

import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { eq, sql as dsql } from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";
import { musicLibrary } from "@repo/db";
import { generateSunoMusic } from "./ai33-suno.js";
import { resolveMusicForScope } from "./music-resolver.js";

const execFileAsync = promisify(execFile);
const FFPROBE_BIN = process.env["FFPROBE_PATH"] ?? "ffprobe";

export interface AssembleMusicBedOptions {
  jobId: string;
  /** Tag stored on every generated row in music_library (e.g. 'LONG_FORM_DRAMA'). */
  format: string;
  /** TTS duration in seconds — we need at least this much music. */
  targetSec: number;
  /** Generation strategy. */
  mode: "generate" | "library";
  /** Suno prompt when generating. Use a vibe-matched prompt per format. */
  prompt: string;
  /** Display label written to music_library.name. */
  title?: string;
  /** AI33 key, only used in 'generate' mode. */
  ai33Key: string;
  /** Optional backup key — half of generates rotate to this one. */
  ai33KeyBackup?: string;
  /** Where to store generated mp3s on disk. */
  outputDir: string;
  /** Concurrency for Suno calls. */
  concurrency?: number;
  /**
   * Opt in to the global assignment system: when set, `"library"` mode draws
   * from the collection bound to this scope (`music_assignments`) instead of
   * the legacy `music_library.format` tag.
   *
   * Left unset, the legacy per-format tag behaviour is unchanged, so existing
   * callers keep working while formats migrate one at a time.
   */
  scope?: { format?: string | null; channelId?: string | null };
}

export interface MusicTrack {
  file_path: string;
  duration_seconds: number;
  /** music_library.id when sourced from library, undefined when freshly generated. */
  library_id?: string;
}

export interface AssembleMusicBedResult {
  tracks: MusicTrack[];
  totalSec: number;
}

async function probeDurationSec(path: string): Promise<number> {
  const { stdout } = await execFileAsync(
    FFPROBE_BIN,
    ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", path],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return parseFloat(stdout.trim());
}

/**
 * Pick random ready tracks from music_library matching `format`.
 * Stops when the cumulative duration exceeds target.
 */
async function pickLibraryTracks(
  db: DrizzleClient,
  format: string,
  targetSec: number,
): Promise<MusicTrack[]> {
  // Pull the whole pool — formats accumulate a few hundred rows over
  // time, not millions. `ORDER BY random()` is fine at that scale.
  const rows = await db
    .select()
    .from(musicLibrary)
    .where(eq(musicLibrary.format, format))
    .orderBy(dsql`random()`);

  const picked: MusicTrack[] = [];
  let total = 0;
  for (const r of rows) {
    // Skip tracks whose file no longer exists on disk (deleted manually,
    // pruned, etc.). Don't let one missing file break the bed.
    try {
      const s = await stat(r.file_path);
      if (!s.isFile() || s.size < 50_000) continue;
    } catch {
      continue;
    }
    picked.push({
      file_path: r.file_path,
      duration_seconds: r.duration_seconds,
      library_id: r.id,
    });
    total += r.duration_seconds;
    if (total >= targetSec) break;
  }
  return picked;
}

/**
 * Generate fresh Suno tracks in batches until duration covers target.
 * Each track is also persisted to music_library, tagged with `format`,
 * so future jobs in the same format can `mode: "library"` it.
 */
async function generateTracks(
  db: DrizzleClient,
  opts: AssembleMusicBedOptions,
  existingTotalSec: number,
): Promise<MusicTrack[]> {
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 3, 6));
  const out: MusicTrack[] = [];
  let total = existingTotalSec;
  let nextIdx = 0;

  while (total < opts.targetSec) {
    // How many fresh tracks we still need, ballparked at 240s each.
    const stillNeeded = Math.max(opts.targetSec - total, 1);
    const batchSize = Math.min(
      concurrency,
      Math.max(1, Math.ceil(stillNeeded / 240)),
    );
    const batchPaths = Array.from({ length: batchSize }, () => {
      const p = join(opts.outputDir, `music_${nextIdx}.mp3`);
      nextIdx++;
      return p;
    });

    const results = await Promise.all(
      batchPaths.map(async (filePath) => {
        const existing = await stat(filePath).catch(() => null);
        if (existing && existing.size > 100_000) {
          // Re-run after a crash; reuse the file already on disk.
          const dur = await probeDurationSec(filePath);
          return { file_path: filePath, duration_seconds: Math.round(dur) };
        }
        // Half the generations rotate to the backup key (if any)
        // to spread quota across both accounts.
        const key =
          opts.ai33KeyBackup && Math.random() < 0.5
            ? opts.ai33KeyBackup
            : opts.ai33Key;
        const duration = await generateSunoMusic(key, filePath, {
          prompt: opts.prompt,
          title: opts.title ?? `${opts.format} track`,
        } as Parameters<typeof generateSunoMusic>[2]);
        const [inserted] = await db
          .insert(musicLibrary)
          .values({
            name: `${opts.title ?? opts.format} ${new Date().toISOString()}`,
            file_path: filePath,
            duration_seconds: duration,
            genre: opts.format.toLowerCase().replace(/_/g, "-"),
            format: opts.format,
            // Provenance, so the library can tell generated tracks from
            // uploads and credits can be produced automatically later.
            // Without this every pipeline-generated row lands with a null
            // creator, which is the gap this system exists to close.
            creator: "Suno (AI33)",
            source: "suno_ai33",
            license: "Suno subscription — commercial use",
            attribution_required: false,
            generation_prompt: opts.prompt,
            generation_provider: "ai33:suno",
          })
          .returning({ id: musicLibrary.id });
        return {
          file_path: filePath,
          duration_seconds: duration,
          library_id: inserted?.id,
        };
      }),
    );

    for (const t of results) {
      out.push(t);
      total += t.duration_seconds;
    }

    console.log(
      JSON.stringify({
        level: "info",
        event: "music_engine_batch",
        job_id: opts.jobId,
        format: opts.format,
        mode: opts.mode,
        batch_size: batchSize,
        tracks_so_far: out.length,
        seconds_so_far: total,
        target_sec: opts.targetSec,
      }),
    );
  }

  return out;
}

export async function assembleMusicBed(
  db: DrizzleClient,
  opts: AssembleMusicBedOptions,
): Promise<AssembleMusicBedResult> {
  await mkdir(opts.outputDir, { recursive: true });

  let tracks: MusicTrack[] = [];
  let totalSec = 0;

  if (opts.mode === "library") {
    if (opts.scope) {
      // Global path: draw from the collection bound to this format/channel.
      const resolved = await resolveMusicForScope(
        db,
        opts.scope,
        opts.targetSec,
      );
      if (resolved.unavailableTrackIds.length > 0) {
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "music_engine_missing_files",
            job_id: opts.jobId,
            track_ids: resolved.unavailableTrackIds,
            message:
              "assigned tracks skipped because their audio is not on disk",
          }),
        );
      }
      if (!resolved.assignment) {
        console.log(
          JSON.stringify({
            level: "info",
            event: "music_engine_no_assignment",
            job_id: opts.jobId,
            reason: resolved.reason,
          }),
        );
      }
      tracks = resolved.tracks.map((t) => ({
        file_path: t.file_path,
        duration_seconds: t.duration_seconds,
        library_id: t.id,
      }));
    } else {
      tracks = await pickLibraryTracks(db, opts.format, opts.targetSec);
    }
    totalSec = tracks.reduce((a, t) => a + t.duration_seconds, 0);
    if (totalSec < opts.targetSec) {
      console.log(
        JSON.stringify({
          level: "info",
          event: "music_engine_library_short",
          job_id: opts.jobId,
          format: opts.format,
          library_seconds: totalSec,
          target_sec: opts.targetSec,
          message: "library too small, generating remainder",
        }),
      );
      const fresh = await generateTracks(db, opts, totalSec);
      tracks = [...tracks, ...fresh];
      totalSec = tracks.reduce((a, t) => a + t.duration_seconds, 0);
    }
  } else {
    tracks = await generateTracks(db, opts, 0);
    totalSec = tracks.reduce((a, t) => a + t.duration_seconds, 0);
  }

  return { tracks, totalSec };
}

/**
 * Per-format default Suno prompts. Callers can override; this is just
 * a sensible vibe match per format.
 */
export const MUSIC_PROMPTS: Record<string, string> = {
  LONG_FORM_DRAMA:
    "Slow, sad, emotional cinematic background music for a long-form relationship drama story. Warm piano, low strings, intimate, contemplative. No drums. No vocals. No melody hooks. Pure ambient bed under spoken narration.",
};
