import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

interface SpliceOptions {
  paddingMs: number; // Padding to strip from start/end (default: 500)
  crossfadeMs: number; // Crossfade duration between chunks (default: 100)
  breathPauseMs: number; // Breath pause between paragraphs (default: 200)
  analogFloorDb: number; // Analog floor noise level (default: -60)
}

const DEFAULT_SPLICE_OPTIONS: SpliceOptions = {
  paddingMs: 500,
  crossfadeMs: 100,
  breathPauseMs: 200,
  analogFloorDb: -60,
};

/**
 * Add silence padding to beginning and end of audio file
 *
 * Used to add 500ms padding before sending to TTS for chunk generation.
 */
export async function addSilencePadding(
  inputPath: string,
  outputPath: string,
  paddingMs: number = 500,
): Promise<void> {
  const paddingSeconds = paddingMs / 1000;

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i",
      inputPath,
      "-af",
      `apad=pad_dur=${paddingSeconds},adelay=${paddingSeconds * 1000}|${paddingSeconds * 1000}`,
      "-y",
      outputPath,
    ]);

    let stderr = "";
    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg padding failed: ${stderr}`));
      }
    });
  });
}

/**
 * Expert splice multiple audio chunks into single seamless file
 *
 * Steps:
 * 1. Strip padding from each chunk
 * 2. Apply crossfades between chunks
 * 3. Insert breath pauses at paragraph boundaries
 * 4. Apply loudness normalization (two-pass)
 * 5. Layer analog floor noise
 * 6. Output as WAV
 */
export async function expertSpliceChunks(
  chunkPaths: string[],
  outputPath: string,
  paragraphBoundaries: number[],
  options: Partial<SpliceOptions> = {},
): Promise<void> {
  const opts = { ...DEFAULT_SPLICE_OPTIONS, ...options };
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tts-splice-"));

  try {
    // Step 1: Strip padding from each chunk
    const strippedChunks: string[] = [];
    for (let i = 0; i < chunkPaths.length; i++) {
      const strippedPath = path.join(tempDir, `stripped_${i}.mp3`);
      await stripPadding(chunkPaths[i], strippedPath, opts.paddingMs);
      strippedChunks.push(strippedPath);
    }

    // Step 2-3: Concatenate chunks
    const concatenatedPath = path.join(tempDir, "concatenated.wav");

    if (strippedChunks.length === 1) {
      // Single chunk: convert directly to WAV (no crossfading needed)
      await convertToWav(strippedChunks[0], concatenatedPath);
    } else {
      // Multiple chunks: build filter complex for crossfades and breath pauses
      const { filterComplex, outputLabel } = buildSpliceFilterComplex(
        strippedChunks.length,
        opts.crossfadeMs,
        opts.breathPauseMs,
        paragraphBoundaries,
      );
      await concatenateWithCrossfades(
        strippedChunks,
        concatenatedPath,
        filterComplex,
        outputLabel,
      );
    }

    // Step 4: Apply loudness normalization (two-pass)
    const normalizedPath = path.join(tempDir, "normalized.wav");
    await applyLoudnessNormalization(concatenatedPath, normalizedPath);

    // Step 5: Layer analog floor
    await applyAnalogFloor(normalizedPath, outputPath, opts.analogFloorDb);
  } finally {
    // Cleanup temp files
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * Convert audio file to WAV format (used for single-chunk case)
 */
async function convertToWav(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", ["-i", inputPath, "-y", outputPath]);

    let stderr = "";
    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg convert to WAV failed: ${stderr}`));
      }
    });
  });
}

/**
 * Strip padding from start and end of audio chunk
 */
async function stripPadding(
  inputPath: string,
  outputPath: string,
  paddingMs: number,
): Promise<void> {
  const paddingSeconds = paddingMs / 1000;

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i",
      inputPath,
      "-af",
      `atrim=start=${paddingSeconds},asetpts=PTS-STARTPTS,areverse,atrim=start=${paddingSeconds},asetpts=PTS-STARTPTS,areverse`,
      "-y",
      outputPath,
    ]);

    let stderr = "";
    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg strip padding failed: ${stderr}`));
      }
    });
  });
}

/**
 * Build filter complex for crossfades and breath pauses
 *
 * Returns both the filter complex string and the final output label
 * that needs to be mapped to the output stream.
 */
function buildSpliceFilterComplex(
  chunkCount: number,
  crossfadeMs: number,
  breathPauseMs: number,
  paragraphBoundaries: number[],
): { filterComplex: string; outputLabel: string } {
  const crossfadeDuration = crossfadeMs / 1000;
  const breathPauseDuration = breathPauseMs / 1000;

  const filters: string[] = [];
  let currentLabel = "[0:a]";

  for (let i = 1; i < chunkCount; i++) {
    const isParagraphBoundary = paragraphBoundaries.includes(i);
    const nextLabel = `[a${i}]`;

    if (isParagraphBoundary) {
      // Add breath pause before crossfade at paragraph boundaries
      filters.push(
        `${currentLabel}apad=pad_dur=${breathPauseDuration}[padded${i}];` +
          `[padded${i}][${i}:a]acrossfade=d=${crossfadeDuration}:c1=tri:c2=tri${nextLabel}`,
      );
    } else {
      // Regular crossfade
      filters.push(
        `${currentLabel}[${i}:a]acrossfade=d=${crossfadeDuration}:c1=tri:c2=tri${nextLabel}`,
      );
    }

    currentLabel = nextLabel;
  }

  return {
    filterComplex: filters.join(";"),
    outputLabel: currentLabel, // Final output label (e.g., "[a80]")
  };
}

/**
 * Concatenate chunks with crossfades using filter complex
 */
async function concatenateWithCrossfades(
  chunkPaths: string[],
  outputPath: string,
  filterComplex: string,
  outputLabel: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const inputArgs = chunkPaths.flatMap((p) => ["-i", p]);

    const ffmpeg = spawn("ffmpeg", [
      ...inputArgs,
      "-filter_complex",
      filterComplex,
      "-map",
      outputLabel,
      "-y",
      outputPath,
    ]);

    let stderr = "";
    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg concatenation failed: ${stderr}`));
      }
    });
  });
}

/**
 * Apply loudness normalization (two-pass)
 *
 * Target: -14 LUFS integrated, True Peak -1.0 dB
 */
async function applyLoudnessNormalization(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i",
      inputPath,
      "-af",
      "loudnorm=I=-14:TP=-1.0:LRA=11",
      "-y",
      outputPath,
    ]);

    let stderr = "";
    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg loudness normalization failed: ${stderr}`));
      }
    });
  });
}

/**
 * Layer analog floor noise under entire track
 *
 * Mixes very low volume (-60dB) white noise to mask AI regularity.
 */
/**
 * `amix` NORMALISES BY INPUT COUNT unless told otherwise: with two inputs it
 * scales each by 1/2, i.e. -6.02 dB. Both places this file mixes a noise floor,
 * it does so AFTER loudnorm — so the carefully mastered -14 LUFS track was
 * being attenuated to ~-20 and nothing downstream corrected it.
 *
 * Measured on a real production narration (2026-08-04):
 *   loudnorm only                  -> -15.8 LUFS
 *   loudnorm + amix (default)      -> -21.9 LUFS   <- what shipped
 *   loudnorm + amix normalize=0    -> -15.9 LUFS
 *
 * The RANKING video rendered that night measured -21.6 LUFS, 7.6 LU under
 * target, and the output QA gate flagged it. This was the cause. It affected
 * every caller — RANKING, long-form drama, and the main ai-generation TTS path
 * — so all narration in the system has been ~6 dB quiet.
 *
 * `normalize=0` keeps each input at its own level, which is what mixing a
 * -60 dB noise floor under a mastered track is supposed to mean.
 */
async function applyAnalogFloor(
  inputPath: string,
  outputPath: string,
  analogFloorDb: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i",
      inputPath,
      "-f",
      "lavfi",
      "-i",
      "anoisesrc=d=60:c=white:r=44100:a=0.01",
      "-filter_complex",
      // amix normalize=0 — see the AMIX NORMALISATION note above.
      `[1:a]volume=${analogFloorDb}dB[noise];[0:a][noise]amix=inputs=2:duration=first:normalize=0`,
      "-y",
      outputPath,
    ]);

    let stderr = "";
    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg analog floor failed: ${stderr}`));
      }
    });
  });
}

interface CrossfadeStitchOptions {
  crossfadeMs?: number;
  paragraphBoundaries?: number[];
  breathPauseMs?: number;
  loudnormI?: number;
  loudnormTp?: number;
  loudnormLra?: number;
  analogFloorDb?: number | null;
  audioCodec?: string;
  audioQuality?: string;
}

/**
 * Stitch TTS chunks into a single mastered audio file in one ffmpeg pass.
 *
 * Replaces the raw MP3 concat-demuxer + separate loudnorm step used by
 * the long-form TTS processors (drama). The concat demuxer
 * stitches MP3 frames byte-wise, so chunk boundaries land on whatever
 * granular sample the encoder happened to emit — that produces the
 * audible clicks and "shitty stitching" the user flagged. Doing the
 * crossfade in filter_complex performs it on decoded PCM, so the join
 * is sample-accurate and inaudible.
 *
 * For a single chunk: no crossfade, just loudnorm + analog floor.
 *
 * Does NOT expect pre-padded input chunks. If you need the
 * strip-padding behavior, use expertSpliceChunks.
 */
export async function crossfadeStitchAndMaster(
  chunkPaths: string[],
  outputPath: string,
  options: CrossfadeStitchOptions = {},
): Promise<void> {
  if (chunkPaths.length === 0) {
    throw new Error("crossfadeStitchAndMaster: no chunks provided");
  }

  const crossfadeMs = options.crossfadeMs ?? 80;
  const breathPauseMs = options.breathPauseMs ?? 250;
  const paragraphBoundaries = options.paragraphBoundaries ?? [];
  const loudnormI = options.loudnormI ?? -14;
  const loudnormTp = options.loudnormTp ?? -1;
  const loudnormLra = options.loudnormLra ?? 11;
  const analogFloorDb =
    options.analogFloorDb === null ? null : (options.analogFloorDb ?? -60);
  const audioCodec = options.audioCodec ?? "libmp3lame";
  const audioQuality = options.audioQuality ?? "2";

  const inputArgs = chunkPaths.flatMap((p) => ["-i", p]);

  let stitchedLabel: string;
  const filters: string[] = [];

  if (chunkPaths.length === 1) {
    stitchedLabel = "[0:a]";
  } else {
    const { filterComplex, outputLabel } = buildSpliceFilterComplex(
      chunkPaths.length,
      crossfadeMs,
      breathPauseMs,
      paragraphBoundaries,
    );
    filters.push(filterComplex);
    stitchedLabel = outputLabel;
  }

  filters.push(
    `${stitchedLabel}loudnorm=I=${loudnormI}:TP=${loudnormTp}:LRA=${loudnormLra}[norm]`,
  );

  let finalLabel = "[norm]";
  let extraInputs: string[] = [];
  if (analogFloorDb !== null) {
    extraInputs = ["-f", "lavfi", "-i", "anoisesrc=c=white:r=44100:a=0.01"];
    const noiseIdx = chunkPaths.length;
    filters.push(
      `[${noiseIdx}:a]volume=${analogFloorDb}dB[noise]`,
      // amix normalize=0 — see the AMIX NORMALISATION note above.
      `[norm][noise]amix=inputs=2:duration=first:normalize=0[out]`,
    );
    finalLabel = "[out]";
  }

  const filterComplex = filters.join(";");

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      ...inputArgs,
      ...extraInputs,
      "-filter_complex",
      filterComplex,
      "-map",
      finalLabel,
      "-c:a",
      audioCodec,
      "-q:a",
      audioQuality,
      "-y",
      outputPath,
    ]);

    let stderr = "";
    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `crossfadeStitchAndMaster failed (exit ${code}): ${stderr.slice(-2000)}`,
          ),
        );
      }
    });
  });
}

/**
 * Probe audio duration using ffprobe
 */
export async function probeAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      audioPath,
    ]);

    let stdout = "";
    let stderr = "";

    ffprobe.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    ffprobe.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffprobe.on("close", (code) => {
      if (code === 0) {
        const duration = parseFloat(stdout.trim());
        resolve(duration);
      } else {
        reject(new Error(`ffprobe failed: ${stderr}`));
      }
    });
  });
}
