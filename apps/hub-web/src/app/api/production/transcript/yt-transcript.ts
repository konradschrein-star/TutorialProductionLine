import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Fetch a YouTube video's captions as readable prose, from hub-web.
 *
 * ## Why this is a copy and not an import
 *
 * The worker already does exactly this, in
 * `apps/worker-orchestrator/src/utils/tutorial/source-transcript.ts` +
 * `utils/yt-dlp-client.ts`, and that is where it runs at script time. hub-web
 * cannot import it: the root eslint config forbids `apps/*` → `apps/*` imports,
 * hub-web has no path alias or workspace dep on the worker, and the worker's
 * yt-dlp client pulls in `@repo/logger`, which is not a hub-web dependency. The
 * established pattern in this repo for exactly this situation is to mirror the
 * behaviour with a comment saying so — see `lib/stock-library/gemini.ts` and
 * `api/jobs/[id]/va-review/blocks/[itemId]/add-url/route.ts`.
 *
 * The pieces that MUST stay identical to the worker's, because the worker is
 * what actually writes the script and a preview that disagrees with it is worse
 * than no preview: the binary and its auth args, the manual-before-auto caption
 * preference, the VTT→prose conversion (including the rolling-caption de-dupe),
 * and `MIN_TRANSCRIPT_WORDS`.
 *
 * There is exactly ONE deliberate divergence, documented at
 * `VTT_BLOCK_START_RE` below: the worker leaks YouTube's CSS style block into
 * the transcript, and this copy does not. The worker should be fixed to match.
 *
 * ## Why fetching it here is worth doing at all
 *
 * The owner: "we can fetch the transcript already by as soon as the keyword is
 * selected, we can fetch the transcript and have it show up in the reference
 * transcript box already". Today the VA finds out whether a reference video has
 * usable captions minutes later, when the job fails — after they have already
 * moved on to the next keyword.
 *
 * ## No synthetic fallback
 *
 * Every failure throws a `TranscriptError` carrying a code and a sentence a VA
 * can act on. Nothing here ever returns a placeholder, a summary, or an empty
 * string dressed up as a transcript.
 *
 * VERIFIED on prod 2026-08-04, by running this exact call sequence there:
 * hub-web's pm2 env already carries
 * `YT_DLP_COOKIES=/opt/content-forge/secrets/youtube-cookies.txt`, yt-dlp
 * 2026.07.09 sits at /usr/local/bin/yt-dlp, and three live Keyword Tool
 * reference videos (vCNASTnM6p4, 3oLXZB9fg6A, cb3_X9grdmc) each returned real
 * manual captions — 1,594 / 1,821 / 1,910 words of clean prose. A bad video id
 * came back FETCH_FAILED rather than an empty transcript.
 */

const execFileAsync = promisify(execFile);

const YT_DLP_BIN = process.env["YT_DLP_BIN"] ?? "yt-dlp";
const YT_DLP_COOKIES = process.env["YT_DLP_COOKIES"];
const YT_DLP_EXTRACTOR_ARGS = process.env["YT_DLP_EXTRACTOR_ARGS"];

/** Auth/bypass args prepended to every invocation. Mirrors the worker's. */
function authArgs(): string[] {
  const args: string[] = [];
  if (YT_DLP_COOKIES) args.push("--cookies", YT_DLP_COOKIES);
  if (YT_DLP_EXTRACTOR_ARGS)
    args.push("--extractor-args", YT_DLP_EXTRACTOR_ARGS);
  return args;
}

/**
 * A single yt-dlp call has 60s. The VA is watching a spinner in a form, so a
 * hung call must fail while they still remember what they clicked.
 */
const SUBTITLE_TIMEOUT_MS = 60_000;

/** Mirrors MIN_TRANSCRIPT_WORDS in the worker's source-transcript.ts. */
export const MIN_TRANSCRIPT_WORDS = 80;

export type TranscriptErrorCode =
  | "NOT_YOUTUBE"
  | "NO_CAPTIONS"
  | "FETCH_FAILED"
  | "TRANSCRIPT_TOO_SHORT";

export class TranscriptError extends Error {
  readonly code: TranscriptErrorCode;
  constructor(
    code: TranscriptErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "TranscriptError";
    this.code = code;
  }
}

export type SubtitleKind = "manual" | "auto";

export interface FetchedTranscript {
  transcript: string;
  /** Matches the worker's ReferenceTranscriptSource values. */
  source: "youtube_manual_captions" | "youtube_auto_captions";
  videoTitle: string;
  /** Source runtime in seconds. 0 when yt-dlp did not report one. */
  videoSeconds: number;
  wordCount: number;
  lang: string;
}

const VTT_TIMING_RE = /-->/;
const VTT_CUE_INDEX_RE = /^\d+$/;
/** Single-line headers at the top of the file. */
const VTT_HEADER_RE = /^(WEBVTT|Kind:|Language:)/i;
/**
 * Blocks that run until the next blank line, not single lines.
 *
 * This is a REAL BUG the worker's otherwise-identical converter still has, found
 * while verifying this route against prod on 2026-08-04. YouTube emits a style
 * block on many videos:
 *
 *     WEBVTT
 *     Kind: captions
 *     Language: en
 *     Style:
 *     ::cue(c.cyan) { color: cyan; }
 *     ##
 *
 * Matching `STYLE` as a one-line header drops "Style:" and keeps the CSS, so
 * every fetched transcript began "::cue(c.cyan) { color: cyan; } ## Dear all,
 * welcome to…". Harmless-looking, and it was being fed to the script LLM as the
 * opening words of the source material — and would now also be the first thing
 * the VA reads in the transcript box. Skipping to the blank line is the fix.
 */
const VTT_BLOCK_START_RE = /^(NOTE|STYLE|REGION)\b/i;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"');
}

/**
 * WebVTT → prose. The load-bearing part is the de-dupe: YouTube's auto-captions
 * "roll", repeating the tail of each cue so the on-screen text scrolls, and a
 * naive join triples the word count. Identical to the worker's `vttToPlainText`.
 */
export function vttToPlainText(vtt: string): string {
  const kept: string[] = [];
  let inBlock = false;
  for (const rawLine of vtt.split(/\r?\n/)) {
    const line = rawLine.trim();
    // A blank line ends a NOTE/STYLE/REGION block, per the WebVTT grammar.
    if (!line) {
      inBlock = false;
      continue;
    }
    if (VTT_BLOCK_START_RE.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock) continue;
    if (VTT_HEADER_RE.test(line)) continue;
    if (VTT_TIMING_RE.test(line)) continue;
    if (VTT_CUE_INDEX_RE.test(line)) continue;
    const text = decodeEntities(line.replace(/<[^>]*>/g, "")).trim();
    if (!text) continue;
    if (kept.length > 0 && kept[kept.length - 1] === text) continue;
    kept.push(text);
  }
  return kept.join(" ").replace(/\s+/g, " ").trim();
}

export function countTranscriptWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function isYouTubeUrl(url: string): boolean {
  return /^(https?:\/\/)?([\w-]+\.)*(youtube\.com|youtu\.be)\//i.test(
    url.trim(),
  );
}

/** Mirrors the worker's `subtitleLanguagesFor`: always keep English as a fallback. */
export function subtitleLanguagesFor(language?: string | null): string[] {
  const name = language?.trim().toLowerCase();
  const map: Record<string, string> = {
    english: "en",
    german: "de",
    deutsch: "de",
    spanish: "es",
    french: "fr",
    italian: "it",
    portuguese: "pt",
    dutch: "nl",
    polish: "pl",
    turkish: "tr",
    japanese: "ja",
    korean: "ko",
    hindi: "hi",
    arabic: "ar",
  };
  if (!name || name === "english") return ["en"];
  const code =
    map[name] ?? (/^[a-z]{2}(-[a-z]{2,4})?$/i.test(name) ? name : "");
  return code ? [code, "en"] : ["en"];
}

/** Exact tag, then a regional variant ("en-GB"). Mirrors `pickSubtitleLang`. */
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

async function runYtDlp(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(YT_DLP_BIN, args, {
    timeout: SUBTITLE_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

interface YtDumpJson {
  id?: string;
  title?: string;
  duration?: number;
  subtitles?: Record<string, unknown>;
  automatic_captions?: Record<string, unknown>;
}

/**
 * Fetch a YouTube video's captions and return them as prose.
 *
 * Throws `TranscriptError` on every failure path — including "the video simply
 * has no captions", which is a real answer the VA has to see, not a reason to
 * hand back an empty box that looks like a successful fetch.
 */
export async function fetchYouTubeTranscript(params: {
  url: string;
  language?: string | null;
}): Promise<FetchedTranscript> {
  const url = params.url.trim();
  if (!isYouTubeUrl(url)) {
    throw new TranscriptError(
      "NOT_YOUTUBE",
      `Automatic transcript fetching only supports YouTube URLs; got "${url}". Paste the transcript in by hand instead.`,
    );
  }

  let meta: YtDumpJson;
  try {
    const raw = await runYtDlp([
      ...authArgs(),
      "--skip-download",
      "--dump-single-json",
      "--no-warnings",
      "--quiet",
      url,
    ]);
    meta = JSON.parse(raw.trim()) as YtDumpJson;
  } catch (err) {
    throw new TranscriptError(
      "FETCH_FAILED",
      `Could not read ${url}: ${err instanceof Error ? err.message : String(err)}. ` +
        `The video may be private or removed, or the YouTube cookies file may have expired.`,
      { cause: err },
    );
  }

  const languages = subtitleLanguagesFor(params.language);
  const manualLangs = Object.keys(meta.subtitles ?? {});
  const autoLangs = Object.keys(meta.automatic_captions ?? {});

  // Human captions before machine ones — same preference as the worker, so the
  // preview the VA reads is the text the script is actually written from.
  const manualLang = pickSubtitleLang(manualLangs, languages);
  const autoLang = manualLang ? null : pickSubtitleLang(autoLangs, languages);
  const kind: SubtitleKind | null = manualLang
    ? "manual"
    : autoLang
      ? "auto"
      : null;
  const lang = manualLang ?? autoLang;

  if (!kind || !lang) {
    throw new TranscriptError(
      "NO_CAPTIONS",
      `${url} has no captions in ${languages.join("/")} — neither human nor auto-generated. ` +
        `Paste a transcript by hand, pick a different reference video, or switch this job to write from scratch.`,
    );
  }

  const dir = await mkdtemp(join(tmpdir(), "cf-subs-"));
  let vtt: string;
  try {
    await runYtDlp([
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
    ]);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".vtt"));
    const file = files[0];
    if (!file) {
      throw new Error(
        `yt-dlp reported ${kind} captions in "${lang}" but wrote no .vtt file`,
      );
    }
    vtt = await readFile(join(dir, file), "utf8");
  } catch (err) {
    if (err instanceof TranscriptError) throw err;
    throw new TranscriptError(
      "FETCH_FAILED",
      `Found ${kind} captions for ${url} but could not download them: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err },
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  const transcript = vttToPlainText(vtt);
  const wordCount = countTranscriptWords(transcript);
  if (wordCount < MIN_TRANSCRIPT_WORDS) {
    // Deliberately an error, not a short transcript. Rewriting from 20 words is
    // a from-scratch script wearing a costume, and the worker rejects it later
    // anyway — better the VA learns now, while they can pick another video.
    throw new TranscriptError(
      "TRANSCRIPT_TOO_SHORT",
      `Fetched ${kind} captions for ${url} but they contain only ${wordCount} words ` +
        `(minimum ${MIN_TRANSCRIPT_WORDS}). They are probably empty or music-only. ` +
        `Pick a different reference video or paste a transcript by hand.`,
    );
  }

  return {
    transcript,
    source:
      kind === "manual" ? "youtube_manual_captions" : "youtube_auto_captions",
    videoTitle: meta.title ?? "",
    videoSeconds:
      typeof meta.duration === "number" && Number.isFinite(meta.duration)
        ? Math.round(meta.duration)
        : 0,
    wordCount,
    lang,
  };
}
