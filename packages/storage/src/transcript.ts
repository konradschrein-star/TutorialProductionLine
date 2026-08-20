/**
 * Transcript + subtitle export.
 *
 * Ships two sibling documents alongside the video so it can be translated later
 * without re-transcribing (§4):
 *   - transcript.json — lossless, word-level, the machine input
 *   - subtitles.srt   — the human / editor input, derived from the transcript
 *
 * Everything here is pure. It NEVER invents data: if word timings are missing
 * we emit a script-only transcript and say so in `source`; if there is neither
 * word timings nor a script we THROW (the caller records the artefact as
 * `skipped` with the reason). An empty transcript is never emitted — a silent
 * empty file would poison a translation run (feedback-no-synthetic-fallbacks).
 */

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSentence {
  text: string;
  start: number;
  end: number;
}

/** Discriminates how the transcript was obtained — required, never guessed. */
export type TranscriptSource = "whisper_word_timestamps" | "tts_script_exact";

export interface TranscriptDoc {
  schema_version: 1;
  job_id: string;
  language: string;
  source: TranscriptSource;
  duration_seconds: number | null;
  text: string;
  /** Present only for whisper word-level sources. */
  words?: TranscriptWord[];
  /** Present only when real sentence timings exist. */
  sentences?: TranscriptSentence[];
}

export class TranscriptUnavailableError extends Error {
  constructor(jobId: string, detail: string) {
    super(
      `transcript unavailable for job ${jobId}: ${detail} ` +
        `(refusing to emit an empty transcript)`,
    );
    this.name = "TranscriptUnavailableError";
  }
}

export interface BuildTranscriptInput {
  jobId: string;
  language: string;
  /** From assembly_manifest.word_timestamps. */
  words?: TranscriptWord[] | null;
  /** From assembly_manifest.sentence_timings. */
  sentences?: TranscriptSentence[] | null;
  /** The exact spoken script (tutorials: the script IS the transcript). */
  scriptText?: string | null;
  durationSeconds?: number | null;
}

function isValidWord(w: unknown): w is TranscriptWord {
  return (
    typeof w === "object" &&
    w !== null &&
    typeof (w as TranscriptWord).word === "string" &&
    typeof (w as TranscriptWord).start === "number" &&
    typeof (w as TranscriptWord).end === "number"
  );
}

function isValidSentence(s: unknown): s is TranscriptSentence {
  return (
    typeof s === "object" &&
    s !== null &&
    typeof (s as TranscriptSentence).text === "string" &&
    typeof (s as TranscriptSentence).start === "number" &&
    typeof (s as TranscriptSentence).end === "number"
  );
}

/**
 * Build a transcript document from whatever the pipeline actually recorded.
 * Throws `TranscriptUnavailableError` when there is nothing real to write.
 */
export function buildTranscriptDoc(
  input: BuildTranscriptInput,
): TranscriptDoc {
  const words = Array.isArray(input.words)
    ? input.words.filter(isValidWord)
    : [];
  const sentences = Array.isArray(input.sentences)
    ? input.sentences.filter(isValidSentence)
    : [];
  const script = (input.scriptText ?? "").trim();

  if (words.length > 0) {
    const text = words.map((w) => w.word).join(" ").replace(/\s+/g, " ").trim();
    const doc: TranscriptDoc = {
      schema_version: 1,
      job_id: input.jobId,
      language: input.language,
      source: "whisper_word_timestamps",
      duration_seconds:
        input.durationSeconds ?? (words[words.length - 1]?.end ?? null),
      text,
      words,
    };
    if (sentences.length > 0) doc.sentences = sentences;
    return doc;
  }

  if (script !== "") {
    return {
      schema_version: 1,
      job_id: input.jobId,
      language: input.language,
      source: "tts_script_exact",
      duration_seconds: input.durationSeconds ?? null,
      text: script,
    };
  }

  throw new TranscriptUnavailableError(
    input.jobId,
    "no word_timestamps in assembly_manifest and no script_text",
  );
}

function pad(n: number, width: number): string {
  return String(Math.floor(n)).padStart(width, "0");
}

/** Seconds → `HH:MM:SS,mmm` (SRT timestamp). */
export function formatSrtTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  const totalSec = Math.floor(clamped);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
}

/**
 * Group words into subtitle cues of at most `maxWords` / `maxSeconds`. Falls
 * out to a sentence-based cue list when sentence timings are present, which
 * reads better. Returns null when there is nothing timed to render (a
 * script-only transcript cannot produce timed subtitles — that is honest, not
 * a failure).
 */
export function transcriptToSrt(
  doc: TranscriptDoc,
  opts: { maxWords?: number; maxSeconds?: number } = {},
): string | null {
  const maxWords = opts.maxWords ?? 10;
  const maxSeconds = opts.maxSeconds ?? 6;

  const cues: TranscriptSentence[] = [];

  if (doc.sentences && doc.sentences.length > 0) {
    cues.push(...doc.sentences);
  } else if (doc.words && doc.words.length > 0) {
    let bucket: TranscriptWord[] = [];
    const flush = (): void => {
      if (bucket.length === 0) return;
      cues.push({
        text: bucket.map((w) => w.word).join(" ").trim(),
        start: bucket[0]!.start,
        end: bucket[bucket.length - 1]!.end,
      });
      bucket = [];
    };
    for (const w of doc.words) {
      if (
        bucket.length >= maxWords ||
        (bucket.length > 0 && w.end - bucket[0]!.start > maxSeconds)
      ) {
        flush();
      }
      bucket.push(w);
    }
    flush();
  } else {
    return null;
  }

  return (
    cues
      .map((cue, i) => {
        const idx = i + 1;
        const time = `${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(
          cue.end,
        )}`;
        return `${idx}\n${time}\n${cue.text.trim()}\n`;
      })
      .join("\n") + "\n"
  );
}

export function wordCount(doc: TranscriptDoc): number {
  if (doc.words && doc.words.length > 0) return doc.words.length;
  return doc.text.split(/\s+/).filter((w) => w !== "").length;
}
