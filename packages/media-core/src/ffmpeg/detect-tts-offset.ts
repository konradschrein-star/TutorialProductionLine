import { spawn } from "node:child_process";

const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";

/**
 * Sample rate for cross-correlation audio analysis.
 * 8 kHz gives 1-sample = 0.125 ms resolution — far tighter than one video
 * frame (33 ms). Low rate keeps buffer sizes small so correlation is fast.
 */
const SAMPLE_RATE = 8000;
/** Length of TTS fingerprint used for correlation (seconds). */
const FINGERPRINT_S = 5;
/** How far into the recording to search for the TTS start (seconds). */
const SCAN_WINDOW_S = 30;
/** Correlation step in samples: 32 samples / 8000 Hz = 4 ms resolution. */
const STEP = 32;

/** Extract raw signed-16-bit PCM from an audio/video file via ffmpeg. */
function extractPcm(filePath: string, durationS: number): Promise<Int16Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const proc = spawn(FFMPEG_BIN, [
      "-i",
      filePath,
      "-t",
      durationS.toFixed(2),
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-f",
      "s16le",
      "pipe:1",
      "-loglevel",
      "quiet",
    ]);
    proc.stdout.on("data", (c: Buffer) => chunks.push(c));
    proc.stderr.on("data", () => {});
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`FFmpeg PCM extract exited ${code} for ${filePath}`));
        return;
      }
      const buf = Buffer.concat(chunks);
      resolve(new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2));
    });
  });
}

/** Normalize an Int16Array to a Float32Array in [-1, 1]. */
function normalize(samples: Int16Array): Float32Array {
  let maxAbs = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]!);
    if (a > maxAbs) maxAbs = a;
  }
  const out = new Float32Array(samples.length);
  if (maxAbs === 0) return out;
  const inv = 1 / maxAbs;
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[i]! * inv;
  }
  return out;
}

/**
 * How many correlation windows to evaluate before handing control back to the
 * event loop. The full search is ~6,250 windows x 40,000 samples = 250M
 * multiply-adds; run as one synchronous block it freezes the entire Node
 * process. worker-orchestrator hosts ~40 BullMQ workers plus every in-flight
 * ffmpeg's stderr pipe in that same process, so a multi-hundred-millisecond
 * freeze stalls all of them at once.
 */
const WINDOWS_PER_YIELD = 256;

/** Sliding-window dot-product correlation; returns best offset in samples. */
async function findBestOffset(
  ref: Float32Array,
  recording: Float32Array,
): Promise<number> {
  const refLen = ref.length;
  const searchEnd = recording.length - refLen;
  if (searchEnd <= 0) return 0;

  let bestScore = -Infinity;
  let bestOffset = 0;
  let sinceYield = 0;

  for (let i = 0; i < searchEnd; i += STEP) {
    let score = 0;
    for (let j = 0; j < refLen; j++) {
      score += ref[j]! * recording[i + j]!;
    }
    if (score > bestScore) {
      bestScore = score;
      bestOffset = i;
    }
    if (++sinceYield >= WINDOWS_PER_YIELD) {
      sinceYield = 0;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  return bestOffset;
}

/**
 * Detect how many seconds into the OBS recording the TTS audio begins,
 * using audio cross-correlation.
 *
 * The OBS recording's audio track contains the TTS playing through the
 * computer's speakers. Cross-correlating the TTS waveform against the
 * recording's audio finds the exact moment TTS started — no silence
 * threshold needed, no keyframe snap, no countdown guess.
 *
 * Returns 0 if:
 * - The recording audio track is silent (OBS not capturing system audio)
 * - The detected offset exceeds MAX_LEAD_IN_S (fallback: treat as no offset)
 * - Any error occurs (fail-safe: prefer drift over crash)
 */
export async function detectTtsOffsetByAudioMatch(
  recordingPath: string,
  ttsAudioPath: string,
  { maxLeadInS = 15 }: { maxLeadInS?: number } = {},
): Promise<number> {
  try {
    const [ttsRaw, recRaw] = await Promise.all([
      extractPcm(ttsAudioPath, FINGERPRINT_S),
      extractPcm(recordingPath, SCAN_WINDOW_S),
    ]);

    // Bail out if recording audio track is essentially silent.
    // This happens when OBS is not configured to capture desktop audio —
    // no audio = no fingerprint to match against.
    let maxAbs = 0;
    for (let i = 0; i < recRaw.length; i++) {
      const a = Math.abs(recRaw[i]!);
      if (a > maxAbs) maxAbs = a;
    }
    if (maxAbs < 300) {
      // < ~0.9 % of full scale = silent track
      return 0;
    }

    const ttsNorm = normalize(ttsRaw);
    const recNorm = normalize(recRaw);

    const offsetSamples = await findBestOffset(ttsNorm, recNorm);
    const offsetSeconds = offsetSamples / SAMPLE_RATE;

    if (offsetSeconds < 0 || offsetSeconds > maxLeadInS) {
      return 0;
    }

    return parseFloat(offsetSeconds.toFixed(3));
  } catch {
    // Fail-safe: do not crash splice on a failed detection
    return 0;
  }
}
