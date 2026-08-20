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
  const videoFilter =
    offset > 0
      ? `trim=start=${offset.toFixed(3)},setpts=(PTS-STARTPTS)*${p.factor}`
      : `setpts=${p.factor}*PTS`;
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

/** Tries NVENC, falls back to libx264 — same strategy as ffmpegAudioMux. */
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

  try {
    await runFfmpeg(
      buildMuxArgs({ ...p, videoCodec: "h264_nvenc" }),
      buildTracker(),
    );
  } catch (err) {
    console.warn(
      `[mux-tts] NVENC failed, falling back to libx264: ${(err as Error).message}`,
    );
    await runFfmpeg(
      buildMuxArgs({ ...p, videoCodec: "libx264" }),
      buildTracker(),
    );
  }
}
