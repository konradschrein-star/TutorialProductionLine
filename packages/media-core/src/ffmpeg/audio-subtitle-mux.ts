import { spawn } from "node:child_process";

export interface AudioSubtitleMuxParams {
  /** Absolute path to silent video file (MP4) */
  videoPath: string;
  /** Absolute path to TTS audio file (MP3/WAV/AAC) */
  audioPath: string;
  /** Absolute path to ASS subtitle file */
  assPath: string;
  /** Absolute path for output video */
  outputPath: string;
  /**
   * Optional directory containing the resolved font file(s). Passed to libass as
   * `fontsdir` so the ASS Style's Fontname resolves to the actual font file
   * instead of relying on host-installed fonts (spec §7d).
   */
  fontsDir?: string;
}

/**
 * Combine silent video + TTS audio + ASS subtitles using FFmpeg.
 *
 * Pipeline:
 * 1. Read silent video (from GPU Ken Burns renderer or other source)
 * 2. Read TTS audio
 * 3. Burn ASS subtitles onto video
 * 4. Encode with h264_nvenc (GPU) or libx264 (CPU fallback)
 * 5. Mix audio as AAC
 * 6. Use -shortest to match video/audio duration
 *
 * Encoding strategy:
 * - Try h264_nvenc first (if available)
 * - Fall back to libx264 if NVENC fails
 *
 * @param params Mux parameters
 * @throws Error if muxing fails
 */
export async function ffmpegAudioSubtitleMux(
  params: AudioSubtitleMuxParams,
): Promise<void> {
  const { videoPath, audioPath, assPath, outputPath, fontsDir } = params;

  const ffmpegBin = process.env["FFMPEG_PATH"] ?? "ffmpeg";

  // Normalize ASS path for Windows (FFmpeg accepts forward slashes)
  const normalizedAssPath = assPath.replace(/\\/g, "/");
  const normalizedFontsDir = fontsDir?.replace(/\\/g, "/");

  console.log(
    JSON.stringify({
      level: "info",
      message: "Muxing audio + subtitles",
      video: videoPath,
      audio: audioPath,
      subtitles: assPath,
      output: outputPath,
    }),
  );

  // Try with h264_nvenc first
  try {
    await muxWithCodec(
      ffmpegBin,
      videoPath,
      audioPath,
      normalizedAssPath,
      outputPath,
      "h264_nvenc",
      normalizedFontsDir,
    );
    console.log(
      JSON.stringify({
        level: "info",
        message: "GPU encoding successful (with subtitles)",
        codec: "h264_nvenc",
        output: outputPath,
      }),
    );
    return;
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message:
          "GPU encoding failed - falling back to CPU encoding (with subtitles)",
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
  await muxWithCodec(
    ffmpegBin,
    videoPath,
    audioPath,
    normalizedAssPath,
    outputPath,
    "libx264",
    normalizedFontsDir,
  );
  console.log(
    JSON.stringify({
      level: "info",
      message: "CPU encoding complete (with subtitles)",
      codec: "libx264",
      output: outputPath,
      note: "CPU encoding used - consider GPU for 10x performance improvement",
    }),
  );
}

/**
 * Escape a filesystem path for use as an FFmpeg FILTER argument.
 *
 * The filter-graph parser splits options on `:` and treats `\` as an escape, so
 * a bare Windows path lands as `ass=C:\Users\...\captions.ass` and FFmpeg reads
 * everything after `C` as a second option — it reported
 * `Error applying option 'original_size' to filter 'ass'` and refused to open
 * the output. Backslashes become forward slashes (FFmpeg accepts them on
 * Windows), then the drive colon and any quote are escaped.
 *
 * The colon needs TWO backslashes, not one: the string is unescaped once by the
 * filtergraph parser and once by the filter's own option parser. Verified
 * against ffmpeg 8 on this box — `ass=C\:/…` still failed with
 * `Error applying option 'original_size'`; `ass=C\\:/…` renders.
 *
 * A no-op for POSIX paths without `:` or `'`, which is every production path.
 */
function escapeFilterPath(filePath: string): string {
  return filePath
    .replace(/\\/g, "/")
    .replace(/:/g, "\\\\:")
    .replace(/'/g, "\\\\'");
}

/**
 * Internal helper: mux with specified video codec
 */
async function muxWithCodec(
  ffmpegBin: string,
  videoPath: string,
  audioPath: string,
  assPath: string,
  outputPath: string,
  videoCodec: string,
  fontsDir?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // libass reads embedded font family names from every file in `fontsdir`, so
    // the ASS Style's Fontname resolves to the actual resolved font file.
    const assFilter = fontsDir
      ? `ass=${escapeFilterPath(assPath)}:fontsdir=${escapeFilterPath(fontsDir)}`
      : `ass=${escapeFilterPath(assPath)}`;
    const args = [
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-vf",
      assFilter,
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
        console.log(`[audio-subtitle-mux] ${lastTimestamp}`);
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
