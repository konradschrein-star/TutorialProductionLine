import { spawn } from "node:child_process";

export interface AudioMuxParams {
  /** Absolute path to silent video file (MP4) */
  videoPath: string;
  /** Absolute path to TTS audio file (MP3/WAV/AAC) */
  audioPath: string;
  /** Absolute path for output video */
  outputPath: string;
}

/**
 * Combine silent video + TTS audio using FFmpeg (NO SUBTITLES).
 *
 * Pipeline:
 * 1. Read silent video (from GPU Ken Burns renderer)
 * 2. Read TTS audio
 * 3. Encode with h264_nvenc (GPU) or libx264 (CPU fallback)
 * 4. Mix audio as AAC
 * 5. Use -shortest to match video/audio duration
 *
 * Encoding strategy:
 * - Try h264_nvenc first (if available)
 * - Fall back to libx264 if NVENC fails
 *
 * @param params Mux parameters
 * @throws Error if muxing fails
 */
export async function ffmpegAudioMux(params: AudioMuxParams): Promise<void> {
  const { videoPath, audioPath, outputPath } = params;

  const ffmpegBin = process.env["FFMPEG_PATH"] ?? "ffmpeg";

  console.log(
    JSON.stringify({
      level: "info",
      message: "Muxing audio (no subtitles)",
      video: videoPath,
      audio: audioPath,
      output: outputPath,
    }),
  );

  // Try with h264_nvenc first
  try {
    await muxWithCodec(
      ffmpegBin,
      videoPath,
      audioPath,
      outputPath,
      "h264_nvenc",
    );
    console.log(
      JSON.stringify({
        level: "info",
        message: "GPU encoding successful",
        codec: "h264_nvenc",
        output: outputPath,
      }),
    );
    return;
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "GPU encoding failed - falling back to CPU encoding",
        codec_attempted: "h264_nvenc",
        codec_fallback: "libx264",
        error: err instanceof Error ? err.message : String(err),
        performance_impact: "HIGH - CPU encoding is ~10x slower than GPU",
        resolution:
          "Install NVIDIA drivers or use system with GPU for faster encoding",
      }),
    );
  }

  // Fall back to libx264 (CPU encoding)
  await muxWithCodec(ffmpegBin, videoPath, audioPath, outputPath, "libx264");
  console.log(
    JSON.stringify({
      level: "info",
      message: "CPU encoding complete",
      codec: "libx264",
      output: outputPath,
      note: "CPU encoding used - consider GPU for 10x performance improvement",
    }),
  );
}

/**
 * Internal helper: mux with specified video codec
 */
async function muxWithCodec(
  ffmpegBin: string,
  videoPath: string,
  audioPath: string,
  outputPath: string,
  videoCodec: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-c:v",
      videoCodec,
      "-preset",
      "fast",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest", // Match shortest stream duration
      "-movflags",
      "+faststart",
      "-y",
      outputPath,
    ];

    const proc = spawn(ffmpegBin, args);

    let stderr = "";
    let lastTimestamp = "";

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      // Log FFmpeg progress
      const m = text.match(/time=(\d+:\d+:\d+\.\d+)/);
      if (m && m[1] !== lastTimestamp) {
        lastTimestamp = m[1];
        console.log(`[audio-mux] ${lastTimestamp}`);
      }
    });

    proc.on("error", (err: Error) => {
      reject(new Error(`Failed to spawn ffmpeg: ${err.message}`));
    });

    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(
          new Error(
            `FFmpeg mux failed (code ${code}, codec: ${videoCodec}):\n${stderr.slice(-2000)}`,
          ),
        );
        return;
      }
      resolve();
    });
  });
}
