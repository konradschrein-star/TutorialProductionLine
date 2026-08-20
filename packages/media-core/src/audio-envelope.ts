/**
 * Per-frame narration loudness envelope (RMS).
 *
 * Nothing else in this package produces one of these. `measureLoudness()`
 * (audio-analysis.ts) is a single integrated LUFS number for a whole file, and
 * `detectSilencePeriods()` (audio-onset-detection.ts) is binary intervals.
 * Neither can drive a per-frame animation.
 *
 * WHY RAW PCM AND NOT `astats`:
 * `astats=metadata=1:reset=N` emits a stderr block per window. For a 15-minute
 * video that is 27,000 blocks to regex out of ffmpeg's stderr — slow, and it
 * breaks the moment ffmpeg reformats a label. Decoding to raw s16le mono and
 * windowing in Node is one pass, no parsing, and exact.
 *
 * WHY NOT `-ar <fps>`:
 * Resampling the waveform down to the frame rate low-pass-filters all speech
 * energy (>100 Hz) to nearly zero, so the "amplitude" is useless for animation.
 * We decode at a real sample rate and compute RMS over each frame-sized window.
 *
 * WHY A PERCENTILE AND NOT THE MAX:
 * One plosive or one clipped sample sets the max and flattens the whole curve
 * to near-zero. Normalising against a high percentile (p95 by default) keeps
 * ordinary speech in the upper half of the range. The percentile is a parameter
 * because different narration and different consumers want different headroom.
 *
 * FAIL-CLOSED: every function here throws on missing or unusable input. Nothing
 * returns a zero-filled envelope, a default curve, or a silently truncated one.
 */

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

/** Decode rate for the envelope pass. High enough to keep speech energy. */
export const DEFAULT_ENVELOPE_SAMPLE_RATE = 16_000;

/** Normalisation percentile (0..1). See "WHY A PERCENTILE" above. */
export const DEFAULT_ENVELOPE_PERCENTILE = 0.95;

/**
 * Symmetric moving-average width, in frames.
 *
 * 3 is not arbitrary: the Reactor avatar overlay
 * (`apps/worker-render/src/remotion/reactor/components.tsx`, `smoothedAmp`)
 * drives mouth state off the same kind of envelope and needed exactly 3-tap
 * smoothing to stop the mouth flickering open/closed on single frames. A raw
 * RMS curve at 30fps has 1-frame dropouts inside normal speech (glottal stops,
 * inter-word gaps shorter than a frame); anything driven directly off it
 * strobes. 3 taps removes the strobe without visibly lagging an onset — 5+
 * starts to smear the attack of a syllable.
 */
export const DEFAULT_SMOOTHING_TAPS = 3;

/** s16le full-scale divisor. */
const S16_FULL_SCALE = 32_768;

/** Decode timeout — a 60-minute narration decodes in seconds; this is a leash. */
const DECODE_TIMEOUT_MS = 300_000;

/**
 * A normalised per-frame loudness envelope.
 *
 * `values.length === frameCount`, one entry per video frame at `fps`.
 */
export interface RmsEnvelope {
  /** Smoothed, percentile-normalised loudness, clamped to 0..1, one per frame. */
  values: number[];
  /** Smoothed but un-normalised RMS, in 0..1 of full scale. Kept for debugging. */
  smoothedRms: number[];
  /** The percentile value the envelope was divided by. Always > 0. */
  reference: number;
  /** The percentile actually used (0..1). */
  percentile: number;
  /** Frames per second the windows were cut at. */
  fps: number;
  /** PCM sample rate the decode ran at. */
  sampleRate: number;
  /** Number of whole frame-sized windows the audio yielded. */
  frameCount: number;
  /** Smoothing width used. */
  smoothingTaps: number;
}

/**
 * Decoder seam. Injectable so the envelope logic is testable without ffmpeg.
 * The default is {@link decodePcmS16le}.
 */
export type PcmDecoder = (params: {
  audioPath: string;
  sampleRate: number;
}) => Promise<Buffer>;

export interface ComputeRmsEnvelopeParams {
  /** Absolute path to the narration audio (mp3/wav/m4a — anything ffmpeg reads). */
  audioPath: string;
  /** Video frame rate the envelope must line up with. */
  fps: number;
  /** PCM decode rate. Default {@link DEFAULT_ENVELOPE_SAMPLE_RATE}. */
  sampleRate?: number;
  /** Normalisation percentile, 0 < p <= 1. Default {@link DEFAULT_ENVELOPE_PERCENTILE}. */
  percentile?: number;
  /** Symmetric moving-average width in frames. Default {@link DEFAULT_SMOOTHING_TAPS}. */
  smoothingTaps?: number;
  /** Override the decoder (tests). */
  decodePcm?: PcmDecoder;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure: ffmpeg argv
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the ffmpeg argv that decodes `audioPath` to raw mono s16le on stdout.
 *
 * Pure so the argv shape is unit-testable without invoking ffmpeg.
 *
 * @throws Error if `audioPath` is blank or `sampleRate` is not a positive integer.
 */
export function buildPcmDecodeArgs(params: {
  audioPath: string;
  sampleRate: number;
}): string[] {
  const { audioPath, sampleRate } = params;
  if (audioPath.trim().length === 0) {
    throw new Error(
      "[audio-envelope] buildPcmDecodeArgs: audioPath is empty. The caller " +
        "must pass the absolute path of the narration audio.",
    );
  }
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error(
      `[audio-envelope] buildPcmDecodeArgs: sampleRate must be a positive integer, got ${sampleRate}.`,
    );
  }
  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-i",
    audioPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    String(sampleRate),
    "-f",
    "s16le",
    "-acodec",
    "pcm_s16le",
    "-",
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure: windowing, smoothing, normalisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RMS of each frame-sized window of a mono s16le buffer.
 *
 * Window boundaries are computed in samples from the exact `sampleRate / fps`
 * ratio and rounded per frame, so fractional rates (29.97) do not drift.
 * Trailing samples that do not fill a whole frame are dropped — a partial frame
 * would report artificially low loudness.
 *
 * @returns RMS per frame in 0..1 of full scale.
 * @throws Error if `fps` is not finite/positive, the buffer is empty or has an
 *         odd byte length, or the audio is shorter than one frame.
 */
export function computeRmsFrames(params: {
  pcm: Buffer;
  sampleRate: number;
  fps: number;
}): number[] {
  const { pcm, sampleRate, fps } = params;

  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(
      `[audio-envelope] computeRmsFrames: fps must be finite and > 0, got ${fps}.`,
    );
  }
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error(
      `[audio-envelope] computeRmsFrames: sampleRate must be a positive integer, got ${sampleRate}.`,
    );
  }
  if (pcm.byteLength === 0) {
    throw new Error(
      "[audio-envelope] computeRmsFrames: decoded 0 bytes of PCM. The audio " +
        "file exists but produced no samples — it is empty, truncated, or has " +
        "no audio stream. Refusing to emit an envelope.",
    );
  }
  if (pcm.byteLength % 2 !== 0) {
    throw new Error(
      `[audio-envelope] computeRmsFrames: PCM buffer is ${pcm.byteLength} bytes, ` +
        "not a whole number of 16-bit samples. The decode was truncated.",
    );
  }

  const totalSamples = pcm.byteLength / 2;
  const samplesPerFrame = sampleRate / fps;
  const frameCount = Math.floor(totalSamples / samplesPerFrame);

  if (frameCount === 0) {
    throw new Error(
      `[audio-envelope] computeRmsFrames: audio yielded ${totalSamples} samples ` +
        `at ${sampleRate}Hz, which is less than one frame at ${fps}fps ` +
        `(${samplesPerFrame} samples). Nothing to animate.`,
    );
  }

  const out: number[] = new Array<number>(frameCount);
  for (let f = 0; f < frameCount; f++) {
    const start = Math.round(f * samplesPerFrame);
    const end = Math.min(Math.round((f + 1) * samplesPerFrame), totalSamples);
    const n = end - start;
    if (n <= 0) {
      throw new Error(
        `[audio-envelope] computeRmsFrames: empty window at frame ${f} ` +
          `(start=${start} end=${end}). sampleRate/fps produced a degenerate window.`,
      );
    }
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      const v = pcm.readInt16LE(i * 2) / S16_FULL_SCALE;
      sumSq += v * v;
    }
    out[f] = Math.sqrt(sumSq / n);
  }
  return out;
}

/**
 * Symmetric moving average over `taps` frames.
 *
 * Windows at the edges shrink to the samples that exist rather than being
 * zero-padded: padding with zeros would dim the first and last frames of every
 * segment, which reads as the presenter fading in and out on every cut.
 *
 * See {@link DEFAULT_SMOOTHING_TAPS} for why the default is 3.
 *
 * @throws Error if `taps` is not an odd positive integer (an even window is not
 *         symmetric and would shift the curve half a frame late), or if any
 *         value is not finite.
 */
export function smoothEnvelope(
  values: number[],
  taps: number = DEFAULT_SMOOTHING_TAPS,
): number[] {
  if (!Number.isInteger(taps) || taps < 1 || taps % 2 === 0) {
    throw new Error(
      `[audio-envelope] smoothEnvelope: taps must be an odd positive integer, got ${taps}. ` +
        "An even window is not symmetric and biases the curve half a frame late.",
    );
  }
  if (values.length === 0) {
    throw new Error(
      "[audio-envelope] smoothEnvelope: refusing to smooth an empty envelope.",
    );
  }
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === undefined || !Number.isFinite(v)) {
      throw new Error(
        `[audio-envelope] smoothEnvelope: value at index ${i} is ${String(v)}, not a finite number.`,
      );
    }
  }
  if (taps === 1) return [...values];

  const half = (taps - 1) / 2;
  const out: number[] = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let n = 0;
    for (let d = -half; d <= half; d++) {
      const v = values[i + d];
      if (v !== undefined) {
        sum += v;
        n++;
      }
    }
    // n >= 1 always: d === 0 is always in range.
    out[i] = sum / n;
  }
  return out;
}

/**
 * Nearest-rank percentile of a numeric series.
 *
 * `percentile` is a fraction: 0.95 is p95, 1 is the maximum.
 *
 * @throws Error if the series is empty, contains a non-finite value, or
 *         `percentile` is outside (0, 1].
 */
export function percentileOf(values: number[], percentile: number): number {
  if (values.length === 0) {
    throw new Error(
      "[audio-envelope] percentileOf: refusing to take a percentile of an empty series.",
    );
  }
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 1) {
    throw new Error(
      `[audio-envelope] percentileOf: percentile must be in (0, 1], got ${percentile}.`,
    );
  }
  const sorted = [...values].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    const v = sorted[i];
    if (v === undefined || !Number.isFinite(v)) {
      throw new Error(
        `[audio-envelope] percentileOf: series contains a non-finite value (${String(v)}).`,
      );
    }
  }
  const rank = Math.ceil(percentile * sorted.length) - 1;
  const index = Math.min(Math.max(rank, 0), sorted.length - 1);
  const picked = sorted[index];
  if (picked === undefined) {
    throw new Error(
      `[audio-envelope] percentileOf: index ${index} out of range for ${sorted.length} values.`,
    );
  }
  return picked;
}

/**
 * Divide a series by its own high percentile and clamp to 0..1.
 *
 * @returns The normalised series and the reference value it was divided by.
 * @throws Error if the reference percentile is 0 — that means the audio is
 *         (near-)silent at that percentile, and normalising against it would
 *         either divide by zero or amplify the noise floor into a full-range
 *         animation. Silent narration is a pipeline failure, not something to
 *         paper over.
 */
export function normaliseEnvelope(
  values: number[],
  percentile: number = DEFAULT_ENVELOPE_PERCENTILE,
): { values: number[]; reference: number } {
  const reference = percentileOf(values, percentile);
  if (reference <= 0) {
    throw new Error(
      `[audio-envelope] normaliseEnvelope: p${(percentile * 100).toFixed(0)} of the RMS ` +
        `series is ${reference} — the audio is silent at that percentile. Refusing to ` +
        "normalise: this is either a failed TTS render or the wrong file. Check the " +
        "narration asset before re-running.",
    );
  }
  return {
    values: values.map((v) => Math.min(1, Math.max(0, v / reference))),
    reference,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Side-effecting: decode
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decode an audio file to raw mono s16le PCM in memory via ffmpeg.
 *
 * 15 minutes at 16kHz mono is ~29 MB, so buffering is cheap.
 *
 * @throws Error if ffmpeg cannot be spawned, exits non-zero, or times out.
 */
export function decodePcmS16le(params: {
  audioPath: string;
  sampleRate: number;
}): Promise<Buffer> {
  const args = buildPcmDecodeArgs(params);
  const ffmpegBin = process.env["FFMPEG_PATH"] ?? "ffmpeg";

  return new Promise<Buffer>((resolve, reject) => {
    const proc = spawn(ffmpegBin, args);
    const chunks: Buffer[] = [];
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGKILL");
      reject(
        new Error(
          `[audio-envelope] ffmpeg PCM decode timed out after ${DECODE_TIMEOUT_MS}ms for ${params.audioPath}`,
        ),
      );
    }, DECODE_TIMEOUT_MS);

    proc.stdout.on("data", (d: Buffer) => chunks.push(d));
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("error", (e: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new Error(
          `[audio-envelope] failed to spawn ffmpeg ("${ffmpegBin}") for PCM decode: ${e.message}`,
        ),
      );
    });
    proc.on("close", (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `[audio-envelope] ffmpeg PCM decode exited ${code} for ${params.audioPath}: ${stderr.slice(-800)}`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a normalised per-frame loudness envelope for a narration file.
 *
 * Order of operations is decode -> RMS per frame window -> smooth -> normalise
 * against the smoothed series' own percentile. Smoothing before normalising
 * means the reference reflects the curve that is actually rendered, so the peak
 * of the animation lands at 1.0 rather than somewhere below it.
 *
 * @throws Error if the audio file is missing, is not a regular file, is zero
 *         bytes, decodes to zero samples, is shorter than one frame, or is
 *         silent at the normalisation percentile. Never returns a fallback.
 */
export async function computeRmsEnvelope(
  params: ComputeRmsEnvelopeParams,
): Promise<RmsEnvelope> {
  const {
    audioPath,
    fps,
    sampleRate = DEFAULT_ENVELOPE_SAMPLE_RATE,
    percentile = DEFAULT_ENVELOPE_PERCENTILE,
    smoothingTaps = DEFAULT_SMOOTHING_TAPS,
    decodePcm = decodePcmS16le,
  } = params;

  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(
      `[audio-envelope] computeRmsEnvelope: fps must be finite and > 0, got ${fps} (audio: ${audioPath}).`,
    );
  }

  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(audioPath);
  } catch (error) {
    throw new Error(
      `[audio-envelope] computeRmsEnvelope: narration audio not found at "${audioPath}". ` +
        "The presenter envelope cannot be estimated — fix the upstream TTS asset. " +
        `(${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (!stats.isFile()) {
    throw new Error(
      `[audio-envelope] computeRmsEnvelope: "${audioPath}" is not a regular file.`,
    );
  }
  if (stats.size === 0) {
    throw new Error(
      `[audio-envelope] computeRmsEnvelope: "${audioPath}" is 0 bytes. ` +
        "The TTS step produced an empty file.",
    );
  }

  const pcm = await decodePcm({ audioPath, sampleRate });
  const raw = computeRmsFrames({ pcm, sampleRate, fps });
  const smoothedRms = smoothEnvelope(raw, smoothingTaps);
  const { values, reference } = normaliseEnvelope(smoothedRms, percentile);

  console.log(
    JSON.stringify({
      level: "info",
      message: "Computed narration RMS envelope",
      audio_path: audioPath,
      fps,
      sample_rate: sampleRate,
      frame_count: values.length,
      percentile,
      reference,
      smoothing_taps: smoothingTaps,
    }),
  );

  return {
    values,
    smoothedRms,
    reference,
    percentile,
    fps,
    sampleRate,
    frameCount: values.length,
    smoothingTaps,
  };
}
