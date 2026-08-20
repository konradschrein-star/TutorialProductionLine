import type { Job, Queue } from "bullmq";
import { spawn } from "node:child_process";
import {
  access,
  copyFile,
  link,
  mkdir,
  readFile,
  realpath,
  stat,
  unlink,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, isAbsolute, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ClipForgeIngestPayloadSchema,
  type ClipForgeIngestPayload,
} from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { cfSources, eq } from "@repo/db";
import { runWhisper } from "@repo/media-core";
import type { WordTimestamp } from "@repo/contracts";
import { getConfig } from "@repo/config";

// Anything longer than this triggers chunked Whisper. faster-whisper's
// `small` model is reliable on short windows but hallucinates language
// drift on multi-hour Twitch VODs (mixed silence/music/speech). Chunking
// gives Whisper a fresh decoder state per slice, eliminating drift.
const CHUNK_TRIGGER_SEC = 30 * 60; // 30 min
const CHUNK_SIZE_SEC = 5 * 60; // 5-min chunks — matches the validated quality window

/**
 * Clip Forge — Ingest stage.
 *
 * 1. Loads the cf_sources row.
 * 2. If source_kind === youtube_vod: yt-dlp downloads the VOD to
 *    `${LOCAL_MEDIA_ROOT}/cf/{persona_id}/{source_id}/source.mp4`.
 * 3. Probes the file with ffprobe for resolution/codec/fps/duration.
 * 4. Runs Whisper for word-level timings.
 * 5. Marks the row `transcribed` and enqueues clip-detection.
 *
 * No fallback on missing data: any failure marks the row `failed` and throws,
 * so the BullMQ retry/backoff applies and the error surfaces in the Errors
 * console.
 */
/**
 * Write a phase / progress snapshot to cf_sources.progress.
 *
 * The source-detail UI polls this column and renders a phase label + percent.
 * Worker callers should send a fresh updated_at on every write so the UI can
 * detect staleness if the worker dies.
 */
async function writeProgress(
  db: DrizzleClient,
  sourceId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await db
    .update(cfSources)
    .set({
      progress: { ...patch, updated_at: new Date().toISOString() },
    })
    .where(eq(cfSources.id, sourceId))
    .catch(() => {});
}

async function clearProgress(
  db: DrizzleClient,
  sourceId: string,
): Promise<void> {
  await db
    .update(cfSources)
    .set({ progress: null })
    .where(eq(cfSources.id, sourceId))
    .catch(() => {});
}

export function createCfIngestProcessor(
  db: DrizzleClient,
  queues: { cfClipDetection: Queue },
) {
  return async (job: Job<ClipForgeIngestPayload>, token?: string) => {
    const { source_id } = ClipForgeIngestPayloadSchema.parse(job.data);

    const [source] = await db
      .select()
      .from(cfSources)
      .where(eq(cfSources.id, source_id))
      .limit(1);
    if (!source) throw new Error(`cf_sources row not found: ${source_id}`);

    // Belt-and-suspenders against BullMQ stalled-job detection during the
    // long download + Whisper run: explicitly extend the job lock every
    // 60 seconds for the duration of the job. The worker factory also
    // sets lockDuration to 6 hours, but if anything blocks Node's event
    // loop briefly we want the lock to stay healthy regardless.
    const HEARTBEAT_MS = 60_000;
    const RENEW_MS = 10 * 60 * 1000; // 10 min — much longer than HEARTBEAT
    const heartbeat = setInterval(() => {
      if (!token) return;
      job.extendLock(token, RENEW_MS).catch((err) => {
        console.warn(
          JSON.stringify({
            level: "warn",
            msg: "[cf-ingest] extendLock failed",
            source_id,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      });
    }, HEARTBEAT_MS);

    try {
      const cfg = getConfig();
      const outDir = join(
        cfg.LOCAL_MEDIA_ROOT,
        "cf",
        source.persona_id,
        source_id,
      );
      await mkdir(outDir, { recursive: true });
      const sourcePath = join(outDir, "source.mp4");

      // 1. Download — but only if source.mp4 isn't already on disk.
      // The pipeline is restart-tolerant: a failed Whisper step shouldn't
      // re-cost an 8 GB download. If the file exists AND is non-empty,
      // skip download entirely and let Whisper retry.
      let needDownload = true;
      try {
        await access(sourcePath, fsConstants.R_OK);
        const st = await stat(sourcePath);
        if (st.size > 1024 * 1024) {
          needDownload = false;
          console.log(
            JSON.stringify({
              level: "info",
              msg: "[cf-ingest] reusing existing source.mp4",
              source_id,
              size_mb: (st.size / 1024 / 1024).toFixed(1),
            }),
          );
        }
      } catch {
        // file doesn't exist — proceed with download
      }
      if (needDownload) {
        const startedAt = new Date().toISOString();
        await writeProgress(db, source_id, {
          phase: "downloading",
          source_kind: source.source_kind,
          started_at: startedAt,
        });
        // Poll the output file size every 2 s so the UI sees a growing
        // bytes_done counter while the downloader works.
        const sizePoll = setInterval(async () => {
          try {
            const st = await stat(sourcePath);
            await writeProgress(db, source_id, {
              phase: "downloading",
              source_kind: source.source_kind,
              started_at: startedAt,
              bytes_done: st.size,
            });
          } catch {
            // file may not exist yet — silently skip
          }
        }, 2_000);
        try {
          if (source.source_kind === "youtube_vod") {
            await ytDlpDownload(source.source_url, sourcePath);
          } else if (source.source_kind === "twitch_vod") {
            await twitchDownload(
              source.source_url,
              sourcePath,
              "videodownload",
            );
          } else if (source.source_kind === "manual_upload") {
            // Local-file ingest. `source_url` names a file that already exists
            // on this host ("file:///abs/path" or a bare absolute path); we
            // link/copy it to sourcePath. Previously this branch was a no-op
            // that assumed somebody had hand-placed source.mp4 — nothing in
            // the product ever did, so ffprobe then failed on a missing file
            // with an opaque "No such file or directory". This is the only
            // ingest path with no third-party dependency (TwitchDownloaderCLI
            // is not installed; the YouTube cookie jar is missing), so it is
            // the one that lets an operator add new material today.
            await linkLocalSource(source.source_url, sourcePath);
          } else {
            throw new Error(
              `source_kind '${source.source_kind}' not yet supported (MVP supports youtube_vod, twitch_vod, manual_upload)`,
            );
          }
        } finally {
          clearInterval(sizePoll);
        }
      }

      // 2. Probe metadata
      const probe = await ffprobe(sourcePath);
      const { size: sizeBytes } = await stat(sourcePath);

      // 3. Transcribe — use the source's language so Whisper picks the
      // right acoustic + LM. Defaults to 'en' if the column is somehow
      // null (older rows, pre-language migration).
      const lang = (source.language ?? "en").toLowerCase().slice(0, 8) || "en";
      console.log(
        JSON.stringify({
          level: "info",
          msg: "[cf-ingest] starting whisper",
          source_id,
          path: sourcePath,
          language: lang,
          duration_sec: probe.duration,
          will_chunk: probe.duration > CHUNK_TRIGGER_SEC,
        }),
      );
      const transcribeStartedAt = new Date().toISOString();
      const chunksTotal = Math.ceil(probe.duration / CHUNK_SIZE_SEC);
      await writeProgress(db, source_id, {
        phase: "transcribing",
        started_at: transcribeStartedAt,
        chunks_done: 0,
        chunks_total: probe.duration > CHUNK_TRIGGER_SEC ? chunksTotal : 1,
        duration_sec: probe.duration,
      });
      const wordTimings =
        probe.duration > CHUNK_TRIGGER_SEC
          ? await chunkedWhisper(sourcePath, lang, probe.duration, source_id, {
              onChunkComplete: async (done: number, total: number) => {
                await writeProgress(db, source_id, {
                  phase: "transcribing",
                  started_at: transcribeStartedAt,
                  chunks_done: done,
                  chunks_total: total,
                  duration_sec: probe.duration,
                });
              },
            })
          : await runWhisper(sourcePath, lang);

      // 4. Persist and enqueue
      await db
        .update(cfSources)
        .set({
          status: "transcribed",
          duration_sec: probe.duration,
          resolution: probe.resolution,
          codec: probe.codec,
          fps: probe.fps,
          size_bytes: sizeBytes,
          word_timings: wordTimings.map((w) => ({
            w: w.word,
            t0: w.start,
            t1: w.end,
          })),
        })
        .where(eq(cfSources.id, source_id));

      await clearProgress(db, source_id);

      await queues.cfClipDetection.add("cf-clip-detection", { source_id });

      console.log(
        JSON.stringify({
          level: "info",
          msg: "[cf-ingest] complete",
          source_id,
          duration_sec: probe.duration,
          words: wordTimings.length,
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db
        .update(cfSources)
        .set({ status: "failed" })
        .where(eq(cfSources.id, source_id))
        .catch(() => {});
      console.error(
        JSON.stringify({
          level: "error",
          msg: "[cf-ingest] failed",
          source_id,
          error: msg,
        }),
      );
      throw err;
    } finally {
      clearInterval(heartbeat);
    }
  };
}

/**
 * Resolve a `manual_upload` source_url to a readable local file and place it
 * at `sourcePath`.
 *
 * Accepts `file:///abs/path` or a bare absolute path. The path must resolve
 * inside one of `CF_LOCAL_INGEST_ROOTS` (colon-separated; defaults to
 * LOCAL_MEDIA_ROOT + /opt/reelforge/media). Without that allow-list any
 * operator who can POST a source could make the worker read an arbitrary
 * file off the host — /etc/shadow included — and then serve it back as a
 * video. The check is done on the REALPATH so `..` and symlinks cannot
 * escape a permitted root.
 *
 * Hardlinks when possible (same filesystem, zero copy, zero extra disk) and
 * falls back to a copy across devices. Never moves or deletes the original:
 * these files are other subsystems' outputs.
 */
export async function linkLocalSource(
  sourceUrl: string,
  sourcePath: string,
): Promise<void> {
  const raw = sourceUrl.startsWith("file://")
    ? fileURLToPath(sourceUrl)
    : sourceUrl;
  if (!isAbsolute(raw)) {
    throw new Error(
      `manual_upload source_url must be an absolute path or file:// URL, got '${sourceUrl}'`,
    );
  }

  let real: string;
  try {
    real = await realpath(raw);
  } catch {
    throw new Error(`manual_upload source file not found: ${raw}`);
  }

  // getConfig() is only consulted for the DEFAULT root list, so an explicit
  // CF_LOCAL_INGEST_ROOTS makes this function usable outside a booted worker
  // (scripts, tests) instead of throwing "Configuration not loaded".
  const rootSpec =
    process.env["CF_LOCAL_INGEST_ROOTS"] ??
    `${getConfig().LOCAL_MEDIA_ROOT}:/opt/reelforge/media`;
  const roots = rootSpec
    .split(":")
    .map((r) => r.trim())
    .filter(Boolean);
  const permitted = await Promise.all(
    roots.map(async (r) => {
      try {
        return await realpath(r);
      } catch {
        return null;
      }
    }),
  );
  const inRoot = permitted.some(
    (r) => r !== null && (real === r || real.startsWith(r + sep)),
  );
  if (!inRoot) {
    throw new Error(
      `manual_upload path '${real}' is outside the permitted ingest roots (${roots.join(", ")}). ` +
        `Move the file under one of them, or extend CF_LOCAL_INGEST_ROOTS.`,
    );
  }

  const st = await stat(real);
  if (!st.isFile() || st.size < 1024 * 1024) {
    throw new Error(
      `manual_upload path '${real}' is not a file of usable size (${st.size} bytes)`,
    );
  }

  try {
    await link(real, sourcePath);
  } catch (e) {
    // EXDEV (cross-device) or EEXIST — fall back to a copy.
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return;
    await copyFile(real, sourcePath);
  }
  console.log(
    JSON.stringify({
      level: "info",
      msg: "[cf-ingest] linked local source",
      from: real,
      to: sourcePath,
      size_mb: (st.size / 1024 / 1024).toFixed(1),
    }),
  );
}

/**
 * Download a YouTube VOD with yt-dlp.
 *
 * Env contract — deliberately the SAME names the rest of the monorepo uses
 * (`apps/worker-orchestrator/src/utils/yt-dlp-client.ts`). Clip Forge used to
 * read `YTDLP_PATH` / `YTDLP_COOKIES_PATH`, which nothing ever set, so every
 * YouTube ingest silently ran cookie-less and got bot-blocked on the
 * datacenter IP:
 *
 *   YT_DLP_BIN            — binary path (default "yt-dlp")
 *   YT_DLP_COOKIES        — Netscape cookies.txt from a logged-in session.
 *                           YouTube bot-blocks datacenter IPs without it.
 *   YT_DLP_EXTRACTOR_ARGS — forwarded verbatim (PO-token provider, player
 *                           client overrides, …).
 *
 * The cookie file is verified up-front: a configured-but-missing path is a
 * hard error, never a silent cookie-less attempt that fails 200 seconds later
 * with an opaque "Sign in to confirm you're not a bot".
 */
async function ytDlpDownload(url: string, outputPath: string): Promise<void> {
  const bin = process.env["YT_DLP_BIN"] ?? "yt-dlp";
  const cookiesPath = process.env["YT_DLP_COOKIES"];
  const extractorArgs = process.env["YT_DLP_EXTRACTOR_ARGS"];

  if (cookiesPath) {
    try {
      await access(cookiesPath, fsConstants.R_OK);
    } catch {
      throw new Error(
        `YT_DLP_COOKIES points at '${cookiesPath}' but that file is not readable. ` +
          `YouTube bot-blocks this host without cookies — re-export a Netscape ` +
          `cookies.txt from a logged-in YouTube session and place it there.`,
      );
    }
  } else {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "[cf-ingest] YT_DLP_COOKIES is not set — YouTube will likely bot-block this download",
        url,
      }),
    );
  }

  const args = [
    "--format",
    "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best",
    "--merge-output-format",
    "mp4",
    "--no-playlist",
    "--output",
    outputPath,
  ];
  if (cookiesPath) args.push("--cookies", cookiesPath);
  if (extractorArgs) args.push("--extractor-args", extractorArgs);
  args.push(url);

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("error", (e) =>
      reject(
        new Error(
          `yt-dlp not found at '${bin}': ${e.message}. Set YT_DLP_BIN to its absolute path.`,
        ),
      ),
    );
    proc.on("close", (code) => {
      if (code !== 0)
        reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(-500)}`));
      else resolve();
    });
  });
}

/**
 * Download a Twitch VOD or clip via `lay295/TwitchDownloaderCLI`.
 *
 *   mode = "videodownload"  → full VOD (URL like https://twitch.tv/videos/12345)
 *   mode = "clipdownload"   → short clip (URL like https://clips.twitch.tv/Slug)
 *
 * Required env: `TWITCH_DOWNLOADER_PATH` — absolute path to the
 * `TwitchDownloaderCLI` binary (download from
 * https://github.com/lay295/TwitchDownloader/releases). On the VPS we
 * keep it at /opt/content-forge/bin/TwitchDownloaderCLI.
 *
 * Optional env:
 *   `TWITCH_OAUTH`         — OAuth token for subscriber-only VODs. NEVER
 *                            commit this; it's per-account and sensitive.
 *   `TWITCH_QUALITY`       — target quality (default "1080p60"). The CLI
 *                            falls back to the highest available if the
 *                            requested rendition is missing.
 *   `TWITCH_THREADS`       — parallel download threads (default 4).
 *   `TWITCH_TEMP_PATH`     — temp cache folder for the CLI.
 *   `FFMPEG_PATH`          — passed to the CLI so it muxes with the same
 *                            ffmpeg the rest of the pipeline uses.
 */
function twitchDownload(
  urlOrId: string,
  outputPath: string,
  mode: "videodownload" | "clipdownload",
): Promise<void> {
  const bin = process.env["TWITCH_DOWNLOADER_PATH"] ?? "TwitchDownloaderCLI";
  const quality = process.env["TWITCH_QUALITY"] ?? "1080p60";
  const threads = process.env["TWITCH_THREADS"] ?? "4";
  const oauth = process.env["TWITCH_OAUTH"];
  const ffmpegPath = process.env["FFMPEG_PATH"];
  const tempPath = process.env["TWITCH_TEMP_PATH"];

  const args = [
    mode,
    "--id",
    urlOrId,
    "-o",
    outputPath,
    "-q",
    quality,
    "--collision",
    "Overwrite",
  ];
  if (mode === "videodownload") {
    args.push("--threads", threads, "--trim-mode", "Exact");
    if (oauth) args.push("--oauth", oauth);
  }
  if (ffmpegPath) args.push("--ffmpeg-path", ffmpegPath);
  if (tempPath) args.push("--temp-path", tempPath);

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let stderr = "";
    let stdout = "";
    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("error", (e) =>
      reject(
        new Error(
          `TwitchDownloaderCLI not found at '${bin}': ${e.message}. Set TWITCH_DOWNLOADER_PATH to the absolute path of the binary from https://github.com/lay295/TwitchDownloader/releases`,
        ),
      ),
    );
    proc.on("close", (code) => {
      if (code !== 0) {
        const tail = (stderr || stdout).slice(-600);
        reject(
          new Error(`TwitchDownloaderCLI ${mode} exited ${code}: ${tail}`),
        );
      } else resolve();
    });
  });
}

interface Probe {
  duration: number;
  resolution: string;
  codec: string;
  fps: number;
}
/**
 * Chunked Whisper for long-form audio. Splits the source into 5-min
 * windows with ffmpeg (audio-only to keep Whisper memory low), runs the
 * small model per chunk, and concatenates the word timings with the
 * appropriate per-chunk time offset.
 *
 * Why chunked: faster-whisper `small` is fast but its decoder state
 * drifts on multi-hour mixed-content files (silence/music/intro stings
 * trigger language hallucinations — observed live producing Georgian
 * + Sinhala garbage on a 3.4 h Twitch VOD). A fresh decoder per chunk
 * eliminates that drift.
 */
async function chunkedWhisper(
  sourcePath: string,
  language: string,
  durationSec: number,
  sourceId: string,
  hooks?: {
    onChunkComplete?: (done: number, total: number) => Promise<void> | void;
  },
): Promise<WordTimestamp[]> {
  const chunksDir = join(dirname(sourcePath), "chunks");
  await mkdir(chunksDir, { recursive: true });

  const numChunks = Math.ceil(durationSec / CHUNK_SIZE_SEC);
  const allWords: WordTimestamp[] = [];

  for (let i = 0; i < numChunks; i++) {
    const startSec = i * CHUNK_SIZE_SEC;
    const lenSec = Math.min(CHUNK_SIZE_SEC, durationSec - startSec);
    const padded = String(i).padStart(3, "0");
    const chunkAudioPath = join(chunksDir, `c${padded}.m4a`);
    const chunkJsonPath = join(chunksDir, `c${padded}.json`);

    // RESUMABILITY: if Whisper already finished this chunk and wrote its
    // JSON to disk on a previous attempt, parse the stored output and
    // skip the expensive transcription. This is the difference between
    // a 70-min retry and a 0-min retry when the worker is restarted
    // mid-run.
    let chunkWords: Array<{ word: string; start: number; end: number }> = [];
    let usedCache = false;
    try {
      await access(chunkJsonPath, fsConstants.R_OK);
      const cached = JSON.parse(await readFile(chunkJsonPath, "utf-8")) as {
        words?: Array<{ word: string; start: number; end: number }>;
      };
      if (Array.isArray(cached.words) && cached.words.length > 0) {
        chunkWords = cached.words;
        usedCache = true;
      }
    } catch {
      // no cache; fall through to Whisper
    }

    console.log(
      JSON.stringify({
        level: "info",
        msg: "[cf-ingest] chunked whisper",
        source_id: sourceId,
        chunk: `${i + 1}/${numChunks}`,
        start_sec: startSec,
        len_sec: lenSec,
        from_cache: usedCache,
      }),
    );

    if (!usedCache) {
      await ffmpegCutAudio(sourcePath, startSec, lenSec, chunkAudioPath);
      try {
        const raw = await runWhisper(chunkAudioPath, language);
        chunkWords = raw.map((w) => ({
          word: w.word,
          start: w.start,
          end: w.end,
        }));
      } finally {
        // delete the audio chunk but PRESERVE the .json so the next
        // retry can skip this chunk.
        await unlink(chunkAudioPath).catch(() => {});
      }
    }

    for (const w of chunkWords) {
      allWords.push({
        word: w.word,
        start: w.start + startSec,
        end: w.end + startSec,
      });
    }
    if (hooks?.onChunkComplete) {
      await hooks.onChunkComplete(i + 1, numChunks);
    }
  }
  console.log(
    JSON.stringify({
      level: "info",
      msg: "[cf-ingest] chunked whisper complete",
      source_id: sourceId,
      chunks: numChunks,
      total_words: allWords.length,
    }),
  );
  return allWords;
}

/**
 * Extract audio-only chunk in AAC/m4a — Whisper only cares about audio
 * and the much smaller file dramatically speeds up the per-chunk run.
 */
function ffmpegCutAudio(
  input: string,
  startSec: number,
  lenSec: number,
  output: string,
): Promise<void> {
  const bin = process.env["FFMPEG_PATH"] ?? "ffmpeg";
  return new Promise((resolve, reject) => {
    const ff = spawn(bin, [
      "-y",
      "-loglevel",
      "error",
      "-ss",
      startSec.toFixed(3),
      "-t",
      lenSec.toFixed(3),
      "-i",
      input,
      "-vn", // drop video
      "-acodec",
      "aac",
      "-ar",
      "16000",
      "-ac",
      "1",
      output,
    ]);
    let stderr = "";
    ff.stderr.on("data", (d) => (stderr += d.toString()));
    ff.on("error", (e) => reject(new Error(`ffmpeg not found: ${e.message}`)));
    ff.on("close", (code) => {
      if (code !== 0)
        reject(new Error(`ffmpeg cut exited ${code}: ${stderr.slice(-400)}`));
      else resolve();
    });
  });
}

function ffprobe(path: string): Promise<Probe> {
  const bin = process.env["FFPROBE_PATH"] ?? "ffprobe";
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      path,
    ]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (e) =>
      reject(new Error(`ffprobe not found: ${e.message}`)),
    );
    proc.on("close", (code) => {
      if (code !== 0)
        return reject(
          new Error(`ffprobe exited ${code}: ${stderr.slice(-300)}`),
        );
      try {
        const j = JSON.parse(stdout) as {
          format?: { duration?: string };
          streams?: Array<{
            codec_type?: string;
            codec_name?: string;
            width?: number;
            height?: number;
            r_frame_rate?: string;
          }>;
        };
        const video = (j.streams ?? []).find((s) => s.codec_type === "video");
        const [num, den] = (video?.r_frame_rate ?? "30/1")
          .split("/")
          .map(Number);
        const fps = den > 0 ? num / den : 30;
        resolve({
          duration: Number(j.format?.duration ?? 0),
          resolution: `${video?.width ?? 0}×${video?.height ?? 0}`,
          codec: video?.codec_name ?? "unknown",
          fps,
        });
      } catch (e) {
        reject(new Error(`ffprobe JSON parse failed: ${(e as Error).message}`));
      }
    });
  });
}
