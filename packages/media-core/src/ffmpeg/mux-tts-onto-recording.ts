import { spawn } from "node:child_process";
import { FFmpegProgressTracker } from "./progress-tracker.js";

const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";

export interface MuxArgsParams {
  recordingPath: string;
  ttsAudioPath: string;
  outputPath: string;
  /** video time-scale factor = audioDurationSeconds / (recordingDuration - inputOffsetSeconds) */
  factor: number;
  videoCodec: "h264_nvenc" | "libx264";
  /**
   * Seconds of leading dead air to skip in the recording before the TTS
   * starts. Detected by `detectLeadingSilence`. Defaults to 0.
   */
  inputOffsetSeconds?: number;
  /**
   * How the video is fit to the TTS audio:
   *   - "stretch" (default): time-scale the whole video by `factor` so it runs
   *     exactly as long as the audio. Used for translations, where the reused
   *     English footage must be re-fit to a different-length localized track.
   *   - "trim": leave the video at natural 1× speed and let `-shortest` cut the
   *     tail to the audio length (the overhanging recording is dropped). Used
   *     for the English original — the owner's model: "sync off the audio, cut
   *     away the overhanging parts, don't speed it up." `factor` is ignored.
   */
  fitMode?: "stretch" | "trim";
  /**
   * Trim mode only. When the recording is SHORTER than the narration, freeze
   * the last frame for this many seconds so the audio is never truncated.
   * Computed by the caller as max(0, ttsDuration - effectiveRecording).
   */
  padTailSeconds?: number;
}

export function buildMuxArgs(p: MuxArgsParams): string[] {
  // Frame-accurate trim + time-scale via filter graph.
  //
  // Old approach: -ss before -i snaps to the nearest keyframe (2-5 s off),
  // which made the actual trim differ from inputOffsetSeconds and threw off
  // the factor, causing audio/video drift.
  //
  // New approach: trim=start=X,setpts=(PTS-STARTPTS)*F
  //   - trim removes frames before X at decode time (frame-accurate, no snap)
  //   - setpts=(PTS-STARTPTS) resets timestamps after the trim, then *F
  //     rescales them so output duration matches the TTS audio length.
  const offset = p.inputOffsetSeconds ?? 0;
  const fitMode = p.fitMode ?? "stretch";

  let videoFilter: string;
  if (fitMode === "trim") {
    // Natural speed. Reset timestamps after any lead-in trim, then (only when
    // the recording is short) hold the last frame so the narration finishes.
    // `-shortest` cuts the tail when the recording is longer than the audio.
    const base =
      offset > 0
        ? `trim=start=${offset.toFixed(3)},setpts=PTS-STARTPTS`
        : `setpts=PTS-STARTPTS`;
    const pad = p.padTailSeconds ?? 0;
    videoFilter =
      pad > 0.05
        ? `${base},tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)}`
        : base;
  } else {
    videoFilter =
      offset > 0
        ? `trim=start=${offset.toFixed(3)},setpts=(PTS-STARTPTS)*${p.factor}`
        : `setpts=${p.factor}*PTS`;
  }
  return [
    "-i",
    p.recordingPath,
    "-i",
    p.ttsAudioPath,
    "-filter:v",
    videoFilter,
    "-map",
    "0:v",
    "-map",
    "1:a", // clean 1x TTS audio; original/system audio from recording dropped
    "-c:v",
    p.videoCodec,
    // NVENC has its own preset vocabulary; only the x264 path is tuned here.
    //
    // The GPU path is dead on the VPS (no CUDA device), so in practice EVERY
    // splice lands on libx264 and the preset is the whole cost story. Measured
    // on a real 1080p30 tutorial recording (150s source -> 377s output):
    //   preset fast     -> 7.4s   1877 KB
    //   preset veryfast -> 5.4s   1620 KB
    // veryfast is ~27% faster AND smaller here because screen capture is flat,
    // low-motion content that the slower motion search buys nothing on.
    "-preset",
    p.videoCodec === "libx264" ? "veryfast" : "fast",
    "-crf",
    "20",
    "-r",
    "30",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    "-movflags",
    "+faststart",
    "-y",
    p.outputPath,
  ];
}

function runFfmpeg(
  args: string[],
  tracker?: FFmpegProgressTracker,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args);
    let stderr = "";
    proc.stderr.on("data", (d) => {
      const chunk = d.toString();
      stderr += chunk;
      // Stream the same chunk into the progress tracker so the caller's
      // updateProgress callback fires as the mux runs.
      if (tracker) {
        void tracker.parseAndUpdate(chunk);
      }
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `FFmpeg mux failed (code ${code}):\n${stderr.slice(-2000)}`,
          ),
        );
    });
  });
}

export interface MuxTtsParams {
  recordingPath: string;
  ttsAudioPath: string;
  outputPath: string;
  factor: number;
  /** Seconds of leading dead air in the recording to skip. Defaults to 0. */
  inputOffsetSeconds?: number;
  /** See MuxArgsParams.fitMode. "stretch" (default) or "trim". */
  fitMode?: "stretch" | "trim";
  /** Trim mode only: hold last frame this long when recording < narration. */
  padTailSeconds?: number;
  /**
   * Total output duration in seconds — required for progress tracking.
   * (= the TTS audio duration, since `-shortest` and the time-scale make
   * the output match the TTS length.) Omit to disable progress reporting.
   */
  outputDurationSeconds?: number;
  /**
   * Called every ~10% of mux progress. Receives `percentOfMux` (0-100).
   * Use to update a DB progress field. Ignored if `outputDurationSeconds`
   * is not provided.
   */
  onProgress?: (percentOfMux: number) => Promise<void> | void;
}

/**
 * Once NVENC has failed in this process it will keep failing (no GPU appears
 * mid-run), so we remember it and stop paying the doomed spawn on every splice.
 * Reset only by restarting the worker — which is also the only way a GPU would
 * become available. Starts false so a genuine GPU host still gets NVENC.
 */
let nvencKnownBad = false;

/** Tries NVENC once per process, then falls back to libx264 for good. */
export async function muxTtsOntoRecording(p: MuxTtsParams): Promise<void> {
  const buildTracker = () => {
    if (!p.outputDurationSeconds || !p.onProgress) return undefined;
    return new FFmpegProgressTracker({
      // FFmpegProgressTracker expects an updateProgress(jobId, percent)
      // signature. We don't care about the jobId here — just forward the
      // percent to the caller's callback.
      updateProgress: async (_jobId, percent) => {
        await p.onProgress!(percent);
      },
      jobId: "mux-tts",
      totalDurationSeconds: p.outputDurationSeconds,
    });
  };

  if (!nvencKnownBad) {
    try {
      await runFfmpeg(
        buildMuxArgs({ ...p, videoCodec: "h264_nvenc" }),
        buildTracker(),
      );
      return;
    } catch (err) {
      nvencKnownBad = true;
      console.warn(
        `[mux-tts] NVENC unavailable — using libx264 for this and all subsequent muxes: ${(err as Error).message}`,
      );
    }
  }
  await runFfmpeg(buildMuxArgs({ ...p, videoCodec: "libx264" }), buildTracker());
}
