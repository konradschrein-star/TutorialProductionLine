/**
 * yt-dlp Client
 *
 * Node.js wrapper around the `yt-dlp` CLI. Provides:
 * - YouTube search (up to N results, flat playlist JSON)
 * - Manufacturer channel whitelist preference
 * - Clip download with time-range extraction
 * - Metadata extraction
 *
 * Only downloads from official manufacturer channels (Tier 1) to respect
 * copyright. Clips are limited to 5–15 seconds (transformative review use).
 */

import { spawn, type ChildProcess } from "node:child_process";
import {
  mkdir,
  access,
  mkdtemp,
  readdir,
  readFile,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createContextLogger } from "@repo/logger";

const logger = createContextLogger("yt-dlp-client");

const YT_DLP_BIN = process.env["YT_DLP_BIN"] ?? "yt-dlp";

/**
 * YouTube now bot-blocks datacenter IPs ("Sign in to confirm you're not a bot")
 * unless the request carries authentication cookies. Point `YT_DLP_COOKIES` at a
 * Netscape-format cookies.txt exported from a logged-in YouTube session and every
 * search/metadata/download call will pass `--cookies <file>`. Optional
 * `YT_DLP_EXTRACTOR_ARGS` (e.g. "youtube:player_client=tv") is forwarded verbatim
 * for future bypasses. Both are opt-in: absent env → behaviour unchanged.
 */
const YT_DLP_COOKIES = process.env["YT_DLP_COOKIES"];
const YT_DLP_EXTRACTOR_ARGS = process.env["YT_DLP_EXTRACTOR_ARGS"];

/** Auth/bypass args prepended to every yt-dlp invocation when configured. */
function authArgs(): string[] {
  const args: string[] = [];
  if (YT_DLP_COOKIES) args.push("--cookies", YT_DLP_COOKIES);
  if (YT_DLP_EXTRACTOR_ARGS)
    args.push("--extractor-args", YT_DLP_EXTRACTOR_ARGS);
  return args;
}

/** Max time for a single yt-dlp search call (ms). */
const SEARCH_TIMEOUT_MS = 30_000;
/**
 * Timeout (ms) for a single clip download, scaled to the requested window so a
 * hung/blocked download fails fast instead of wasting a flat 5 min. ~1s of grace
 * per requested second, floored at 60s (short clips) and capped at 240s (a full
 * ~10 min user-pasted source). A 150s auto-candidate window → 150s timeout; the
 * old flat 300_000 turned every stalled download into a 5-minute dead wait.
 */
function downloadTimeoutMs(windowSeconds: number): number {
  return Math.min(240_000, Math.max(60_000, Math.round(windowSeconds * 1000)));
}
/**
 * Hard cap on a single downloaded clip window (seconds). Raised to 600 (10 min)
 * so a whole source video can be pulled and the VA studio's left/right trim
 * handles can carve the useful part out of a long source. Downloads are
 * temporary (only the source URL is persisted post-render), so large temp files
 * are acceptable. yt-dlp's `--download-sections *0-600` naturally stops at the
 * real end when the video is shorter than 600s, giving a "whole video up to
 * 10 min" download. Per-format callers pass their own target; this is only the
 * ceiling.
 */
const MAX_CLIP_SECONDS = 600;

// Official manufacturer YouTube channel handles / IDs.
// Matches against the `channel` and `uploader_id` fields in yt-dlp metadata.
const MANUFACTURER_WHITELIST = new Set([
  // Handles (lowercase)
  "@apple",
  "@samsungmobile",
  "@samsung",
  "@google",
  "@oneplus",
  "@sonymobile",
  "@sony",
  "@huawei",
  "@xiaomi",
  "@oppo",
  "@vivo",
  "@motorola",
  "@nokiamobile",
  "@lgelectronics",
  "@lge",
  "@microsoft",
  // Channel IDs (verified official)
  "uccwqcfgjznc1r2f5wwuvow", // Apple
  "ucvhsyvn0tqdjm87_5mmhzdw", // Samsung Mobile US
  "ucsk6ekre2htmzlaxm4icatg", // Google
]);

export interface YtSearchResult {
  id: string;
  url: string;
  title: string;
  channel: string;
  channel_id: string;
  duration: number;
  /** True if channel matches manufacturer whitelist. */
  is_official: boolean;
  thumbnail: string | null;
}

export interface YtClipResult {
  /** Local filesystem path to the downloaded mp4. */
  local_path: string;
  url: string;
  title: string;
  channel: string;
  channel_id: string;
  duration_seconds: number;
}

function isOfficialChannel(channel: string, channelId: string): boolean {
  const normalizedHandle = channel.toLowerCase().replace(/\s+/g, "");
  const normalizedId = channelId.toLowerCase();
  return (
    MANUFACTURER_WHITELIST.has(`@${normalizedHandle}`) ||
    MANUFACTURER_WHITELIST.has(normalizedId) ||
    [...MANUFACTURER_WHITELIST].some(
      (entry) =>
        entry.startsWith("@") && normalizedHandle.includes(entry.slice(1)),
    )
  );
}

/**
 * Precise structural view of the two ChildProcess process-level events used
 * below. See the usage site for why the merged @types/node event overloads are
 * not directly reachable in this toolchain.
 */
interface ChildProcessEvents {
  on(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  on(event: "error", listener: (err: Error) => void): this;
}

function runYtDlp(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(
          `yt-dlp timed out after ${timeoutMs}ms: ${args.slice(0, 3).join(" ")}`,
        ),
      );
    }, timeoutMs);

    const child: ChildProcess = spawn(YT_DLP_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // @types/node 25 merges ChildProcess with an `@internal`
    // InternalEventEmitter<ChildProcessEventMap>, and in this toolchain that
    // merge fails to expose the process-level `.on` overloads (the piped
    // Readable streams above are unaffected). Bind the two events we need
    // through a precise structural view so the listener types stay exact.
    const processEvents = child as unknown as ChildProcessEvents;

    processEvents.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(0, 400)}`));
      } else {
        resolve(stdout);
      }
    });

    processEvents.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Search YouTube for up to `limit` results matching `query`.
 * Returns results sorted: official channels first, then by relevance.
 */
export async function searchYouTube(
  query: string,
  limit = 5,
): Promise<YtSearchResult[]> {
  logger.info({ query, limit }, "yt-dlp search");

  let raw: string;
  try {
    raw = await runYtDlp(
      [
        ...authArgs(),
        `ytsearch${limit}:${query}`,
        "--flat-playlist",
        "--print-json",
        "--no-warnings",
        "--quiet",
      ],
      SEARCH_TIMEOUT_MS,
    );
  } catch (err) {
    logger.warn({ query, err: String(err) }, "yt-dlp search failed");
    return [];
  }

  const results: YtSearchResult[] = [];
  for (const line of raw.trim().split("\n")) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line) as {
        id: string;
        url?: string;
        webpage_url?: string;
        title: string;
        channel?: string;
        uploader?: string;
        channel_id?: string;
        uploader_id?: string;
        duration?: number;
        thumbnail?: string;
      };

      const channel = item.channel ?? item.uploader ?? "";
      const channelId = item.channel_id ?? item.uploader_id ?? "";
      results.push({
        id: item.id,
        url:
          item.url ??
          item.webpage_url ??
          `https://www.youtube.com/watch?v=${item.id}`,
        title: item.title,
        channel,
        channel_id: channelId,
        duration: item.duration ?? 0,
        is_official: isOfficialChannel(channel, channelId),
        thumbnail: item.thumbnail ?? null,
      });
    } catch {
      // Skip malformed lines
    }
  }

  // Official channels first
  results.sort((a, b) => Number(b.is_official) - Number(a.is_official));

  logger.info(
    {
      query,
      total: results.length,
      official: results.filter((r) => r.is_official).length,
    },
    "yt-dlp search complete",
  );
  return results;
}

/**
 * Download a time-ranged clip from a YouTube URL.
 *
 * @param url - YouTube video URL
 * @param destPath - Output mp4 path (directories created automatically)
 * @param startSec - Start offset in seconds (default 0)
 * @param durationSec - Clip length in seconds. Defaults to MAX_CLIP_SECONDS so a
 *   bare call with no explicit window pulls the whole video (yt-dlp stops at the
 *   real end when it is shorter than the cap). Clamped to MAX_CLIP_SECONDS.
 */
export async function downloadYtClip(
  url: string,
  destPath: string,
  startSec = 0,
  durationSec = MAX_CLIP_SECONDS,
): Promise<YtClipResult> {
  const clampedDuration = Math.min(durationSec, MAX_CLIP_SECONDS);
  const endSec = startSec + clampedDuration;

  await mkdir(dirname(destPath), { recursive: true });

  logger.info({ url, destPath, startSec, endSec }, "yt-dlp download clip");

  // First get metadata (title, channel) without downloading
  let meta: {
    title: string;
    channel: string;
    channel_id: string;
    duration: number;
    webpage_url: string;
  } | null = null;

  try {
    const metaRaw = await runYtDlp(
      [
        ...authArgs(),
        "--print-json",
        "--skip-download",
        "--no-warnings",
        "--quiet",
        url,
      ],
      SEARCH_TIMEOUT_MS,
    );
    meta = JSON.parse(metaRaw.trim().split("\n")[0] ?? "{}") as {
      title: string;
      channel: string;
      channel_id: string;
      duration: number;
      webpage_url: string;
    };
  } catch (err) {
    logger.warn(
      { url, err: String(err) },
      "could not fetch yt metadata, continuing download",
    );
  }

  await runYtDlp(
    [
      ...authArgs(),
      url,
      "--download-sections",
      `*${startSec}-${endSec}`,
      "-f",
      "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
      "--merge-output-format",
      "mp4",
      "--no-warnings",
      "--quiet",
      "-o",
      destPath,
    ],
    downloadTimeoutMs(clampedDuration),
  );

  // Verify file exists
  await access(destPath);

  logger.info({ destPath, url }, "yt-dlp clip downloaded");

  return {
    local_path: destPath,
    url,
    title: meta?.title ?? "",
    channel: meta?.channel ?? "",
    channel_id: meta?.channel_id ?? "",
    duration_seconds: clampedDuration,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Subtitles / captions
 *
 * Added for TUTORIAL_STUDIO's TRANSCRIPT_REWRITE source mode, which used to
 * require a human to paste the source video's transcript into a textarea. The
 * capability lives here (rather than in a new tutorial-only module) because this
 * file already owns the correct env contract — YT_DLP_BIN / YT_DLP_COOKIES /
 * YT_DLP_EXTRACTOR_ARGS, the latter being the only hook the bgutil PO-token
 * provider has — plus the timeout-guarded runYtDlp() and authArgs().
 *
 * Deliberately NO fallback behaviour here: these functions report exactly what
 * YouTube offers (manual captions, auto captions, or nothing) and let the caller
 * decide. A tutorial rewritten from a transcript we quietly failed to fetch is
 * strictly worse than a job that stops and says so.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Timeout for a subtitle probe / download (ms). Captions are small. */
const SUBTITLE_TIMEOUT_MS = 60_000;

/** Human ("manual") captions beat machine ("auto") captions every time. */
export type SubtitleKind = "manual" | "auto";

export interface YtSubtitleAvailability {
  video_id: string;
  title: string;
  /** Source runtime in seconds (0 when yt-dlp did not report it). */
  duration_seconds: number;
  /** Language tags with human-authored captions, e.g. ["en", "en-GB"]. */
  manual_langs: string[];
  /** Language tags with machine-generated captions, e.g. ["en", "en-orig"]. */
  auto_langs: string[];
}

export interface YtSubtitleTrack extends YtSubtitleAvailability {
  kind: SubtitleKind;
  lang: string;
  /** Raw WebVTT payload. */
  vtt: string;
}

interface YtDumpJson {
  id?: string;
  title?: string;
  duration?: number;
  subtitles?: Record<string, unknown>;
  automatic_captions?: Record<string, unknown>;
}

/**
 * Ask yt-dlp which caption tracks a video actually has, without downloading
 * anything. Throws on extraction failure (bot-wall, private/removed video, bad
 * URL) — the error text carries yt-dlp's own stderr, which is what tells you
 * whether cookies expired.
 */
export async function probeYouTubeSubtitles(
  url: string,
): Promise<YtSubtitleAvailability> {
  const raw = await runYtDlp(
    [
      ...authArgs(),
      "--skip-download",
      "--dump-single-json",
      "--no-warnings",
      "--quiet",
      url,
    ],
    SUBTITLE_TIMEOUT_MS,
  );

  let meta: YtDumpJson;
  try {
    meta = JSON.parse(raw.trim()) as YtDumpJson;
  } catch {
    throw new Error(
      `yt-dlp returned unparseable metadata for ${url} (${raw.slice(0, 200)})`,
    );
  }

  const langs = (m: Record<string, unknown> | undefined): string[] =>
    m ? Object.keys(m) : [];

  return {
    video_id: meta.id ?? "",
    title: meta.title ?? "",
    duration_seconds:
      typeof meta.duration === "number" && Number.isFinite(meta.duration)
        ? meta.duration
        : 0,
    manual_langs: langs(meta.subtitles),
    auto_langs: langs(meta.automatic_captions),
  };
}

/**
 * Pick the best available language tag for `want` (e.g. "en") out of `have`.
 * Exact match first, then a regional variant ("en-GB"), then YouTube's
 * original-audio tag ("en-orig"). Returns null when the language is absent.
 */
export function pickSubtitleLang(
  have: string[],
  want: string[],
): string | null {
  for (const w of want) {
    const lower = w.toLowerCase();
    const exact = have.find((h) => h.toLowerCase() === lower);
    if (exact) return exact;
    const variant = have.find((h) => h.toLowerCase().startsWith(`${lower}-`));
    if (variant) return variant;
  }
  return null;
}

/** Download ONE caption track as WebVTT. Throws if yt-dlp writes no .vtt. */
async function downloadSubtitleVtt(
  url: string,
  kind: SubtitleKind,
  lang: string,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cf-subs-"));
  try {
    await runYtDlp(
      [
        ...authArgs(),
        "--skip-download",
        kind === "manual" ? "--write-subs" : "--write-auto-subs",
        "--sub-langs",
        lang,
        "--sub-format",
        "vtt/best",
        "--no-warnings",
        "--quiet",
        "-o",
        join(dir, "sub.%(ext)s"),
        url,
      ],
      SUBTITLE_TIMEOUT_MS,
    );

    const files = (await readdir(dir)).filter((f) => f.endsWith(".vtt"));
    const file = files[0];
    if (!file) {
      throw new Error(
        `yt-dlp reported ${kind} captions in "${lang}" for ${url} but wrote no .vtt file`,
      );
    }
    return await readFile(join(dir, file), "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Fetch a video's captions in the first available language of `languages`
 * (default English), preferring human captions over auto-generated ones.
 *
 * Returns null ONLY when the video genuinely has no captions in any requested
 * language — a state the caller must surface, never paper over. Every other
 * failure (bot-wall, private video, yt-dlp missing) throws.
 */
export async function fetchYouTubeSubtitles(
  url: string,
  languages: string[] = ["en"],
): Promise<YtSubtitleTrack | null> {
  const availability = await probeYouTubeSubtitles(url);

  const manualLang = pickSubtitleLang(availability.manual_langs, languages);
  const autoLang = manualLang
    ? null
    : pickSubtitleLang(availability.auto_langs, languages);
  const kind: SubtitleKind | null = manualLang
    ? "manual"
    : autoLang
      ? "auto"
      : null;
  const lang = manualLang ?? autoLang;

  if (!kind || !lang) {
    logger.warn(
      {
        url,
        languages,
        manual_langs: availability.manual_langs.slice(0, 10),
        auto_langs: availability.auto_langs.slice(0, 10),
      },
      "no captions available for requested languages",
    );
    return null;
  }

  logger.info({ url, kind, lang }, "yt-dlp fetching captions");
  const vtt = await downloadSubtitleVtt(url, kind, lang);
  return { ...availability, kind, lang, vtt };
}

/**
 * Search YouTube for `query` and download the first official (or best available)
 * result as a clip. Returns null if search yields no results or download fails.
 */
export async function searchAndDownloadClip(
  query: string,
  destPath: string,
  durationSec = 10,
  requireOfficial = false,
): Promise<YtClipResult | null> {
  const results = await searchYouTube(query, 5);
  if (results.length === 0) return null;

  const candidate = requireOfficial
    ? (results.find((r) => r.is_official) ?? null)
    : results[0];

  if (!candidate) {
    logger.info({ query }, "no official channel result found, skipping");
    return null;
  }

  if (!candidate.is_official) {
    logger.info(
      { query, channel: candidate.channel },
      "best result is not an official channel — skipping (copyright policy)",
    );
    return null;
  }

  try {
    return await downloadYtClip(candidate.url, destPath, 0, durationSec);
  } catch (err) {
    logger.warn(
      { query, url: candidate.url, err: String(err) },
      "yt-dlp download failed",
    );
    return null;
  }
}
