import { spawn } from "node:child_process";

export interface AudioMixParams {
  /** Absolute path to TTS audio file (MP3/WAV/AAC) */
  ttsAudioPath: string;
  /** Absolute path to background music file (MP3/WAV/M4A) */
  musicPath: string;
  /** Absolute path for output mixed audio file */
  outputPath: string;
  /** TTS audio volume adjustment in dB (default: -14dB) */
  ttsVolumeDb?: number;
  /** Background music volume adjustment in dB (default: -27.5dB) */
  musicVolumeDb?: number;
}

/**
 * Mix TTS audio with background music using FFmpeg filter_complex.
 *
 * Pipeline:
 * 1. Apply volume adjustment to TTS audio (default: -14dB)
 * 2. Apply volume adjustment to background music (default: -27.5dB)
 * 3. Mix both audio streams with amix filter (duration=longest)
 * 4. Apply loudness normalization (I=-14, TP=-1.5, LRA=11)
 * 5. Encode as AAC 192kbps
 *
 * The music track will loop if shorter than TTS audio, or be truncated if longer.
 *
 * @param params Mix parameters
 * @throws Error if mixing fails
 */
export async function mixAudioWithMusic(params: AudioMixParams): Promise<void> {
  const {
    ttsAudioPath,
    musicPath,
    outputPath,
    ttsVolumeDb = -14,
    musicVolumeDb = -27.5,
  } = params;

  const ffmpegBin = process.env["FFMPEG_PATH"] ?? "ffmpeg";

  console.log(
    JSON.stringify({
      level: "info",
      message: "Mixing TTS audio with background music",
      tts_audio: ttsAudioPath,
      music: musicPath,
      output: outputPath,
      tts_volume_db: ttsVolumeDb,
      music_volume_db: musicVolumeDb,
    }),
  );

  // Build filter_complex string
  // [0:a]volume=-14dB[audio];[1:a]volume=-27.5dB[music];[audio][music]amix=inputs=2:duration=longest[mix];[mix]loudnorm=I=-14:TP=-1.5:LRA=11[out]
  const filterComplex = `[0:a]volume=${ttsVolumeDb}dB[audio];[1:a]volume=${musicVolumeDb}dB,aloop=loop=-1:size=2e+09[music];[audio][music]amix=inputs=2:duration=first:dropout_transition=0[mix];[mix]loudnorm=I=-14:TP=-1.5:LRA=11[out]`;

  const args = [
    "-i",
    ttsAudioPath,
    "-i",
    musicPath,
    "-filter_complex",
    filterComplex,
    "-map",
    "[out]",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-y",
    outputPath,
  ];

  return new Promise((resolve, reject) => {
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
        console.log(`[audio-mix] ${lastTimestamp}`);
      }
    });

    proc.on("error", (err: Error) => {
      reject(new Error(`Failed to spawn ffmpeg: ${err.message}`));
    });

    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(
          new Error(
            `FFmpeg audio mix failed (code ${code}):\n${stderr.slice(-2000)}`,
          ),
        );
        return;
      }
      console.log(
        JSON.stringify({
          level: "info",
          message: "Audio mixing complete",
          output: outputPath,
        }),
      );
      resolve();
    });
  });
}
