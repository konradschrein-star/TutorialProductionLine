import { fetchYouTubeSubtitles, type SubtitleKind } from "../yt-dlp-client.js";

/**
 * Source-transcript ingestion for TUTORIAL_STUDIO's TRANSCRIPT_REWRITE mode.
 *
 * BEFORE: a VA opened the reference video, copied its transcript out of the
 * YouTube UI by hand, and pasted it into a textarea in the create form. If they
 * pasted nothing, the job silently fell through to the from-scratch prompt and
 * produced a generic script that nobody could tell apart from a rewrite — the
 * failure was invisible.
 *
 * NOW: given `reference_url`, the worker pulls the captions itself with the
 * repo's existing yt-dlp client (same binary, same cookies, same PO-token
 * extractor args as the footage stack — no new dependency), converts them to
 * clean prose, and hands them to the rewrite prompt.
 *
 * NO SYNTHETIC FALLBACK. Every failure path throws a `SourceTranscriptError`
 * naming exactly what went wrong and what the operator can do about it. A
 * transcript-rewrite job that cannot get its transcript must stop, not quietly
 * degrade into a from-scratch script — the whole point of the mode is that the
 * output is grounded in (and demonstrably better than) a specific competitor
 * video.
 */

/** A transcript we could not obtain. Carries an operator-actionable message. */
export class SourceTranscriptError extends Error {
  readonly code:
    | "NO_SOURCE"
    | "NO_CAPTIONS"
    | "FETCH_FAILED"
    | "TRANSCRIPT_TOO_SHORT";

  constructor(
    code: SourceTranscriptError["code"],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SourceTranscriptError";
    this.code = code;
  }
}

/** How a job's reference transcript was obtained. Persisted for auditability. */
export type ReferenceTranscriptSource =
  /** Supplied on the job (operator paste, or pushed in by the Keyword Tool). */
  | "provided"
  /** Human-authored captions pulled from the source video. */
  | "youtube_manual_captions"
  /** Machine-generated captions pulled from the source video. */
  | "youtube_auto_captions";

export interface ResolvedSourceTranscript {
  transcript: string;
  source: ReferenceTranscriptSource;
  /** Present only when we fetched it ourselves. */
  video_title?: string;
  /** Source runtime in seconds — 0/absent when unknown. */
  video_seconds?: number;
  word_count: number;
}

/**
 * Below this the "transcript" is a cookie banner, an error page, or the two
 * words YouTube emits for a music-only video. A 3-minute tutorial is ~450
 * spoken words, so 80 is a floor that only trips on junk — and tripping is
 * correct: rewriting from 20 words is a from-scratch script wearing a costume.
 */
export const MIN_TRANSCRIPT_WORDS = 80;

const VTT_TIMING_RE = /-->/;
const VTT_CUE_INDEX_RE = /^\d+$/;
/** Single-line headers at the top of the file. */
const VTT_HEADER_RE = /^(WEBVTT|Kind:|Language:)/i;
/**
 * Blocks that run until the next blank line, not single lines.
 *
 * NOTE / STYLE / REGION are BLOCKS in the WebVTT grammar: the keyword opens
 * them and a blank line closes them. Matching them as one-line headers dropped
 * the "Style:" line and kept its body, so YouTube's very common
 *
 *     WEBVTT
 *     Kind: captions
 *     Language: en
 *     Style:
 *     ::cue(c.cyan) { color: cyan; }
 *     ##
 *
 * survived into the prose, and every fetched transcript began
 * "::cue(c.cyan) { color: cyan; } ## Dear all, welcome to…". That string was
 * then handed to the script LLM as the opening words of the source material.
 * Measured on prod 2026-08-04: 1,600 words with the leak vs 1,594 without.
 *
 * Kept behaviourally identical to
 * `apps/hub-web/src/app/api/production/transcript/yt-transcript.ts`, which the
 * VA's transcript preview uses — a preview that disagrees with the text the
 * script is actually written from is worse than no preview. (Mirrored, not
 * imported: the root eslint config forbids `apps/*` → `apps/*`.)
 */
const VTT_BLOCK_START_RE = /^(NOTE|STYLE|REGION)\b/i;

/** Minimal HTML entity decode — captions only ever carry these five. */
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
 * Convert a WebVTT caption file into plain readable prose.
 *
 * The interesting part is de-duplication. YouTube's auto-captions "roll": each
 * cue repeats the tail of the previous cue so the on-screen text scrolls, so a
 * naive concatenation triples the word count and feeds the LLM a stutter. We
 * drop any caption line identical to the last line we kept, which is the
 * standard fix and also handles manual captions that repeat across a cue break.
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

    // Inline karaoke timings (<00:00:01.234>) and <c> colour spans.
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

/** Only YouTube is supported today; anything else must fail loudly, not guess. */
export function isYouTubeUrl(url: string): boolean {
  return /^(https?:\/\/)?([\w-]+\.)*(youtube\.com|youtu\.be)\//i.test(
    url.trim(),
  );
}

const KIND_TO_SOURCE: Record<SubtitleKind, ReferenceTranscriptSource> = {
  manual: "youtube_manual_captions",
  auto: "youtube_auto_captions",
};

/**
 * Resolve the transcript a TRANSCRIPT_REWRITE job should be written from.
 *
 * Order of preference:
 *   1. A transcript already on the job (operator paste / Keyword Tool push).
 *   2. Captions fetched from `reference_url`, human captions before auto ones.
 *
 * Throws `SourceTranscriptError` when neither is available. It never returns a
 * from-scratch signal, and it never returns a short/degraded transcript.
 */
export async function resolveSourceTranscript(params: {
  referenceTranscript?: string | null;
  referenceUrl?: string | null;
  /** Job language, used to pick the caption track ("English" → "en"). */
  language?: string | null;
}): Promise<ResolvedSourceTranscript> {
  const provided = params.referenceTranscript?.trim();
  if (provided) {
    const words = countTranscriptWords(provided);
    if (words < MIN_TRANSCRIPT_WORDS) {
      throw new SourceTranscriptError(
        "TRANSCRIPT_TOO_SHORT",
        `The supplied reference transcript is only ${words} words (minimum ${MIN_TRANSCRIPT_WORDS}). ` +
          `That is not enough source material to rewrite from. Paste the full transcript, ` +
          `or clear the field and set a reference video URL so the transcript can be fetched.`,
      );
    }
    return { transcript: provided, source: "provided", word_count: words };
  }

  const url = params.referenceUrl?.trim();
  if (!url) {
    throw new SourceTranscriptError(
      "NO_SOURCE",
      "This job is set to rewrite a reference video but has neither a reference video URL " +
        "nor a reference transcript. Set reference_url (recommended — the transcript is then " +
        "fetched automatically) or paste reference_transcript.",
    );
  }

  if (!isYouTubeUrl(url)) {
    throw new SourceTranscriptError(
      "FETCH_FAILED",
      `Automatic transcript fetching only supports YouTube URLs; got "${url}". ` +
        `Paste the transcript into reference_transcript instead.`,
    );
  }

  const langs = subtitleLanguagesFor(params.language);

  let track;
  try {
    track = await fetchYouTubeSubtitles(url, langs);
  } catch (err) {
    throw new SourceTranscriptError(
      "FETCH_FAILED",
      `Could not read the reference video ${url}: ${
        err instanceof Error ? err.message : String(err)
      }. Check that YT_DLP_COOKIES points at a live cookies file (YouTube bot-walls ` +
        `datacenter IPs without one) and that the video is public.`,
      { cause: err },
    );
  }

  if (!track) {
    throw new SourceTranscriptError(
      "NO_CAPTIONS",
      `The reference video ${url} has no captions in ${langs.join("/")} — neither human ` +
        `nor auto-generated — so there is no transcript to rewrite. Pick a different ` +
        `reference video, paste a transcript manually, or switch this job to write from scratch.`,
    );
  }

  const transcript = vttToPlainText(track.vtt);
  const words = countTranscriptWords(transcript);
  if (words < MIN_TRANSCRIPT_WORDS) {
    throw new SourceTranscriptError(
      "TRANSCRIPT_TOO_SHORT",
      `Fetched ${track.kind} captions for ${url} but they contain only ${words} words ` +
        `(minimum ${MIN_TRANSCRIPT_WORDS}). The captions are probably empty or music-only. ` +
        `Pick a different reference video or paste a transcript manually.`,
    );
  }

  return {
    transcript,
    source: KIND_TO_SOURCE[track.kind],
    video_title: track.title,
    video_seconds: track.duration_seconds,
    word_count: words,
  };
}

/**
 * Map a job's spoken language to caption language tags, always keeping English
 * as a secondary: most tutorial source videos are English even when we dub the
 * output, and an English source transcript is still perfectly good input.
 */
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
