/**
 * Audio file validation + probing for music-library uploads.
 *
 * Two rules drive this module:
 *  - Never trust the filename. The extension is a hint; the probe is the
 *    truth. A `.mp3` that ffprobe reports as an MP4 video is rejected.
 *  - Never invent a duration. `music_library.duration_seconds` is NOT NULL and
 *    is used to lay out music beds; a fabricated 0 would silently produce a
 *    broken render. If the probe fails, the upload fails.
 */

/** Container formats we accept for library tracks. */
export const ACCEPTED_AUDIO_EXTENSIONS = [
  "mp3",
  "wav",
  "flac",
  "m4a",
  "aac",
  "ogg",
  "opus",
] as const;

export type AcceptedAudioExtension = (typeof ACCEPTED_AUDIO_EXTENSIONS)[number];

const CONTENT_TYPE_BY_EXTENSION: Record<AcceptedAudioExtension, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  opus: "audio/ogg",
};

/** Largest upload we accept. Long soundtracks are big; 200 MB is generous. */
export const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

/** Extract a lowercase extension from a filename, or null if it has none. */
export function extensionOf(filename: string): string | null {
  // Guard against path traversal dressed up as a filename.
  const base = filename.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

export function isAcceptedAudioExtension(
  ext: string | null,
): ext is AcceptedAudioExtension {
  return (
    ext !== null &&
    (ACCEPTED_AUDIO_EXTENSIONS as readonly string[]).includes(ext)
  );
}

/** Content-Type to serve a stored track with. Defaults to a safe generic. */
export function contentTypeForExtension(ext: string | null): string {
  if (isAcceptedAudioExtension(ext)) return CONTENT_TYPE_BY_EXTENSION[ext];
  return "application/octet-stream";
}

/**
 * Build the on-disk filename for a track. Always derived from the track UUID
 * plus a validated extension, never from user input, so an upload named
 * `../../etc/passwd` cannot escape the library directory.
 */
export function storageFilename(
  trackId: string,
  ext: AcceptedAudioExtension,
): string {
  return `${trackId}.${ext}`;
}

export interface UploadValidationOk {
  ok: true;
  extension: AcceptedAudioExtension;
}
export interface UploadValidationError {
  ok: false;
  error: string;
}
export type UploadValidation = UploadValidationOk | UploadValidationError;

/**
 * Pre-flight check on the uploaded file, before anything touches disk.
 */
export function validateUpload(args: {
  filename: string;
  sizeBytes: number;
}): UploadValidation {
  const { filename, sizeBytes } = args;

  if (sizeBytes <= 0) {
    return { ok: false, error: "File is empty" };
  }
  if (sizeBytes > MAX_AUDIO_BYTES) {
    return {
      ok: false,
      error: `File is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_AUDIO_BYTES / 1024 / 1024} MB`,
    };
  }

  const ext = extensionOf(filename);
  if (!isAcceptedAudioExtension(ext)) {
    return {
      ok: false,
      error: `Unsupported audio format "${ext ?? "none"}". Accepted: ${ACCEPTED_AUDIO_EXTENSIONS.join(", ")}`,
    };
  }

  return { ok: true, extension: ext };
}

// ---------------------------------------------------------------------------
// Probe interpretation
// ---------------------------------------------------------------------------

/** The subset of ffprobe output we care about. */
export interface RawProbe {
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    bit_rate?: string | number;
    sample_rate?: string | number;
    channels?: number;
  }>;
  format?: {
    duration?: string | number;
    format_name?: string;
    bit_rate?: string | number;
    size?: string | number;
  };
}

export interface ProbedAudio {
  durationSeconds: number;
  codec: string | null;
  sampleRate: number | null;
  channels: number | null;
  bitRate: number | null;
  formatName: string | null;
}

export interface ProbeInterpretationOk {
  ok: true;
  audio: ProbedAudio;
}
export interface ProbeInterpretationError {
  ok: false;
  error: string;
}
export type ProbeInterpretation =
  | ProbeInterpretationOk
  | ProbeInterpretationError;

function toNumber(v: string | number | undefined | null): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Turn raw ffprobe output into a validated ProbedAudio, or an explicit error.
 *
 * This is where "don't trust the filename" is enforced: a file only passes if
 * ffprobe actually found an audio stream in it, and a usable duration.
 */
export function interpretAudioProbe(
  probe: RawProbe | null,
): ProbeInterpretation {
  if (!probe) {
    return { ok: false, error: "ffprobe returned no data for this file" };
  }

  const streams = probe.streams ?? [];
  const audioStream = streams.find((s) => s.codec_type === "audio");
  if (!audioStream) {
    const kinds = Array.from(
      new Set(streams.map((s) => s.codec_type).filter(Boolean)),
    );
    return {
      ok: false,
      error: kinds.length
        ? `File contains no audio stream (found: ${kinds.join(", ")})`
        : "File contains no audio stream",
    };
  }

  // Reject video-carrying uploads outright — the library is audio-only, and a
  // stray video file would bloat storage and break the audio mix.
  if (streams.some((s) => s.codec_type === "video" && !isCoverArt(s))) {
    return { ok: false, error: "File contains a video stream; audio only" };
  }

  const duration = toNumber(probe.format?.duration);
  if (duration === null || duration <= 0) {
    return {
      ok: false,
      error: "Could not determine audio duration — file may be corrupt",
    };
  }

  return {
    ok: true,
    audio: {
      // music_library.duration_seconds is an integer column.
      durationSeconds: Math.round(duration),
      codec: audioStream.codec_name ?? null,
      sampleRate: toNumber(audioStream.sample_rate),
      channels: audioStream.channels ?? null,
      bitRate: toNumber(probe.format?.bit_rate ?? audioStream.bit_rate),
      formatName: probe.format?.format_name ?? null,
    },
  };
}

/**
 * MP3/FLAC files commonly embed cover art as a still "video" stream
 * (mjpeg/png). That is artwork, not video, and must not fail the upload.
 */
function isCoverArt(stream: { codec_name?: string }): boolean {
  const codec = stream.codec_name?.toLowerCase();
  return codec === "mjpeg" || codec === "png" || codec === "bmp";
}
