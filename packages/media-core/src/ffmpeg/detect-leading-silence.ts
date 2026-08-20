import { spawn } from "node:child_process";

const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";

export interface DetectLeadingSilenceOptions {
  /** Silence threshold in dB (e.g. -30). Anything quieter is "silent". */
  thresholdDb?: number;
  /** Minimum duration in seconds for a region to count as silence. */
  minSilenceSeconds?: number;
  /** How many seconds from the start of the file to scan. */
  scanSeconds?: number;
}

/**
 * Find the duration of leading silence in an audio or video file.
 *
 * Used by the tutorial splice processor to auto-trim the dead air at the
 * start of an OBS recording (the user records, then clicks Play in the
 * studio a few seconds later). Without this trim, the TTS audio overlaid
 * by `muxTtsOntoRecording` desyncs with what's on screen.
 *
 * Approach: invoke ffmpeg's `silencedetect` filter and parse `silence_end:
 * <seconds>` from stderr. We only treat the *initial* silence region as a
 * leading-silence trim — silence later in the recording (pauses while
 * speaking) is not subject to trimming.
 *
 * Returns 0 when the file starts with audio. Returns a positive number of
 * seconds when the file starts with at least `minSilenceSeconds` of
 * silence. Caps at `scanSeconds` so a near-silent file doesn't trim the
 * whole thing.
 */
export async function detectLeadingSilence(
  path: string,
  options: DetectLeadingSilenceOptions = {},
): Promise<number> {
  const thresholdDb = options.thresholdDb ?? -35;
  const minSilenceSeconds = options.minSilenceSeconds ?? 0.3;
  const scanSeconds = options.scanSeconds ?? 60;

  const args = [
    "-hide_banner",
    "-nostats",
    "-t",
    String(scanSeconds),
    "-i",
    path,
    "-af",
    `silencedetect=noise=${thresholdDb}dB:d=${minSilenceSeconds}`,
    "-f",
    "null",
    "-",
  ];

  return new Promise<number>((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(
          new Error(
            `detect-leading-silence ffmpeg failed (code ${code}):\n${stderr.slice(-1000)}`,
          ),
        );
      }

      // Look for the first silence_start / silence_end pair. ffmpeg emits
      // them in source order, so the first pair describes the first
      // silence region in the file. If silence_start is at (or before) 0,
      // the file begins with silence — use the matching silence_end.
      const lines = stderr.split("\n");
      let firstStart: number | null = null;
      let firstEnd: number | null = null;
      for (const line of lines) {
        if (firstStart === null) {
          const m = line.match(/silence_start:\s*(-?[\d.]+)/);
          if (m && m[1] !== undefined) firstStart = parseFloat(m[1]);
        }
        if (firstEnd === null) {
          const m = line.match(/silence_end:\s*([\d.]+)/);
          if (m && m[1] !== undefined) firstEnd = parseFloat(m[1]);
        }
        if (firstStart !== null && firstEnd !== null) break;
      }

      if (
        firstStart !== null &&
        firstStart <= 0.1 &&
        firstEnd !== null &&
        firstEnd > 0.05
      ) {
        // Found a leading-silence region. Cap at scanSeconds in case the
        // file is mostly silent — we don't want to trim everything.
        resolve(Math.min(firstEnd, scanSeconds));
      } else {
        resolve(0);
      }
    });
  });
}
