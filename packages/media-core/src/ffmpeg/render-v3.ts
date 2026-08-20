import { spawn } from "node:child_process";
import {
  FFmpegProgressTracker,
  type ProgressUpdateFn,
} from "./progress-tracker.js";

/**
 * Ken Burns patterns for FFmpeg zoompan filter.
 *
 * Inside zoompan expressions:
 *   on  — output frame number (0-indexed, range: 0..d-1)
 *   d   — total duration in frames (same as the :d= parameter)
 *   iw  — input width   ih  — input height
 *   z   — zoom level at current frame (resolved by FFmpeg before x/y expressions run)
 *
 * Expressions avoid commas in function calls (no min/max) so the filter_complex
 * string does not need per-character escaping. Linear zoom over the scene gives a
 * clean, predictable effect without easing surprises.
 *
 * Valid zoom range: 1.0 → 1.08 (8% zoom), so the visible crop is always within the
 * padded input frame. No upscale artefacts.
 */
const KEN_BURNS_PATTERNS = [
  // 0: zoom in, centered
  { z: "1+0.08*on/d", x: "(iw-iw/z)/2", y: "(ih-ih/z)/2" },
  // 1: zoom in, pan right (top-left → right-center)
  { z: "1+0.08*on/d", x: "(iw-iw/z)*on/d", y: "(ih-ih/z)/2" },
  // 2: zoom out, centered
  { z: "1.08-0.08*on/d", x: "(iw-iw/z)/2", y: "(ih-ih/z)/2" },
  // 3: zoom in, pan down (top-center → bottom-center)
  { z: "1+0.08*on/d", x: "(iw-iw/z)/2", y: "(ih-ih/z)*on/d" },
] as const;

export interface V3Scene {
  /** Absolute local filesystem path to the scene image (JPEG or PNG). */
  imagePath: string;
  /**
   * Scene duration in seconds — passed to FFmpeg `-t` so the image loop
   * produces exactly `durationFrames` input frames at the given fps.
   */
  durationSeconds: number;
  /**
   * Pre-computed frame count: Math.round(durationSeconds * fps).
   * Passed to zoompan `:d=` so the Ken Burns animation spans the full scene.
   */
  durationFrames: number;
  /**
   * 0-based scene index from the assembly manifest.
   * Used to cycle through Ken Burns patterns (sceneIndex % 4).
   */
  sceneIndex: number;
}

export interface V3RenderParams {
  scenes: V3Scene[];
  /** Absolute local path to TTS audio (mp3 / wav / aac). */
  audioPath: string;
  /**
   * Absolute local path to the pre-generated ASS caption file.
   * Omit to skip subtitle burning (e.g. for CASUALLY_EXPLAINED format).
   */
  assPath?: string;
  /**
   * Optional directory containing the resolved font file(s). Passed to libass as
   * the `subtitles` filter's `fontsdir` so the ASS Style Fontname resolves to
   * the actual font file rather than a host-installed font (spec §7d).
   */
  fontsDir?: string;
  /** Absolute local output path for the rendered MP4. */
  outputPath: string;
  fps: number;
  width: number;
  height: number;
  /**
   * Optional: Absolute local path to narrator video for PIP overlay.
   * Used for self-recorded narration jobs.
   */
  narratorVideoPath?: string;
  /**
   * Optional: PIP overlay configuration.
   * Used when narratorVideoPath is provided.
   */
  pipConfig?: {
    position: "bottom-right" | "bottom-left" | "top-right" | "top-left";
    heightPercent: number; // e.g., 28 = 28% of output height
    borderRadius: number; // pixels
  };
  /**
   * Optional: Progress update callback function.
   * Called every 10% of completion with (jobId, progressPercent).
   * Allows tracking without depending on @repo/db.
   */
  updateProgress?: ProgressUpdateFn;
  /**
   * Optional: Job ID for progress tracking.
   * Required if updateProgress is provided.
   */
  jobId?: string;
  /**
   * Optional: Absolute local path to background music file (MP3/WAV/M4A).
   * If provided, music will be mixed with TTS audio at the specified volume.
   */
  backgroundMusicPath?: string;
  /**
   * Optional: Background music volume adjustment in dB.
   * Default: -27.5dB (quiet background music under TTS)
   */
  backgroundMusicVolumeDb?: number;
}

/**
 * Render a V3 FFmpeg-native video from static scene images + TTS audio.
 *
 * Single FFmpeg invocation:
 *   1. Per-scene: scale → letterbox pad → setsar → zoompan (Ken Burns)
 *   2. concat all scene streams into one continuous video
 *   3. subtitles filter burns the ASS caption file onto the video
 *   4. Audio: TTS file → AAC 192k
 *
 * ~5-10× faster than Remotion for image-only compositions because there is no
 * Chromium startup, no per-frame browser rendering, and no JS evaluation overhead.
 *
 * Intended for image-only formats such as EXPLAINER (V3 production version).
 */
export async function renderV3(params: V3RenderParams): Promise<void> {
  const ffmpegBin = process.env["FFMPEG_PATH"] ?? "ffmpeg";
  const { scenes, fps, width, height, outputPath, updateProgress, jobId } =
    params;

  const totalFrames = scenes.reduce((acc, s) => acc + s.durationFrames, 0);
  const totalSecs = totalFrames / fps;

  console.log(
    `[ffmpeg-v3] Starting render: ${scenes.length} scenes, ~${totalSecs.toFixed(1)}s (${totalFrames} frames), ${width}x${height}@${fps}fps`,
  );
  console.log(`[ffmpeg-v3] Output: ${outputPath}`);

  const args = _buildArgs(params);

  // DEBUG: Log the full FFmpeg command
  console.log(`[ffmpeg-v3-debug] Full command: ${ffmpegBin} ${args.join(" ")}`);
  console.log(
    `[ffmpeg-v3-debug] Filter complex arg: ${args[args.indexOf("-filter_complex") + 1]}`,
  );

  // Initialize progress tracker if update callback provided
  let progressTracker: FFmpegProgressTracker | null = null;
  if (updateProgress && jobId) {
    progressTracker = new FFmpegProgressTracker({
      updateProgress,
      jobId,
      totalDurationSeconds: totalSecs,
    });
    console.log(
      `[ffmpeg-v3] Progress tracking enabled for job ${jobId} (${totalSecs.toFixed(1)}s total)`,
    );
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin, args);

    let stderr = "";
    let lastTimestamp = "";

    proc.stderr.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;

      // Update progress tracker (non-blocking)
      if (progressTracker) {
        progressTracker.parseAndUpdate(chunk).catch((err) => {
          console.error(
            `[ffmpeg-v3] Progress tracking error (non-fatal): ${err}`,
          );
        });
      }

      // Log FFmpeg progress timestamps without flooding
      const m = chunk.match(/time=(\d+:\d+:\d+\.\d+)/);
      if (m && m[1] !== lastTimestamp) {
        lastTimestamp = m[1];
        console.log(`[ffmpeg-v3] ${lastTimestamp} / ${totalSecs.toFixed(1)}s`);
      }
    });

    proc.on("error", (err: Error) => {
      reject(new Error(`[ffmpeg-v3] Failed to spawn ffmpeg: ${err.message}`));
    });

    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(
          new Error(
            `[ffmpeg-v3] Render failed (code ${code}): ${stderr.slice(-2000)}`,
          ),
        );
        return;
      }
      console.log(`[ffmpeg-v3] Render complete: ${outputPath}`);
      resolve();
    });
  });
}

// ─── Internal ────────────────────────────────────────────────────────────────

function _buildArgs(params: V3RenderParams): string[] {
  const {
    scenes,
    audioPath,
    assPath,
    fontsDir,
    outputPath,
    fps,
    width,
    height,
    narratorVideoPath,
    pipConfig,
    backgroundMusicPath,
    backgroundMusicVolumeDb = -27.5,
  } = params;
  const sz = `${width}x${height}`;

  // ── Inputs ─────────────────────────────────────────────────────────────────
  // Each scene image: looped for exactly durationSeconds at fps.
  // Audio: from narrator video if present, otherwise from audioPath.
  // Narrator video: added after scene images, before audio (if separate).
  // Background music: added after audio input if provided.
  const inputArgs: string[] = [];
  for (const scene of scenes) {
    inputArgs.push(
      "-r",
      String(fps),
      "-loop",
      "1",
      "-t",
      String(scene.durationSeconds),
      "-i",
      scene.imagePath,
    );
  }

  // If narrator video provided, add it as an input
  let narratorInputIdx: number | null = null;
  if (narratorVideoPath) {
    narratorInputIdx = scenes.length;
    inputArgs.push("-i", narratorVideoPath);
  }

  // Audio input (separate TTS file or narrator video audio)
  const audioInputIdx = narratorVideoPath ? scenes.length + 1 : scenes.length;
  if (!narratorVideoPath) {
    // Use separate TTS audio file
    inputArgs.push("-i", audioPath);
  }
  // If narrator video present, we'll extract audio from it in the filter

  // Background music input (if provided)
  let musicInputIdx: number | null = null;
  if (backgroundMusicPath) {
    musicInputIdx = narratorVideoPath ? scenes.length + 2 : scenes.length + 1;
    inputArgs.push("-i", backgroundMusicPath);
  }

  // ── filter_complex ─────────────────────────────────────────────────────────
  const filterParts: string[] = [];
  const sceneLabels: string[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const label = `s${i}`;
    sceneLabels.push(`[${label}]`);

    // scale: zoom-to-fill (no black bars) — scale up so the image covers WxH,
    // then center-crop to exact WxH. setsar=1: normalise pixel aspect ratio.
    filterParts.push(
      `[${i}:v]` +
        `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
        `crop=${width}:${height},` +
        `setsar=1` +
        `[${label}]`,
    );
  }

  // Concatenate all scene streams into a single video stream.
  filterParts.push(
    `${sceneLabels.join("")}concat=n=${scenes.length}:v=1:a=0[concatv]`,
  );

  // ── PIP Overlay (if narrator video provided) ──────────────────────────────
  if (narratorVideoPath && narratorInputIdx !== null && pipConfig) {
    // Calculate PIP dimensions
    const pipHeight = Math.floor(height * (pipConfig.heightPercent / 100));
    const pipWidth = Math.floor((pipHeight * 16) / 9); // Assume 16:9 aspect ratio for narrator video

    // Calculate position based on config
    let xPos: string;
    let yPos: string;
    const margin = 20; // pixels from edge

    if (pipConfig.position === "bottom-right") {
      xPos = `W-w-${margin}`;
      yPos = `H-h-${margin}`;
    } else if (pipConfig.position === "bottom-left") {
      xPos = String(margin);
      yPos = `H-h-${margin}`;
    } else if (pipConfig.position === "top-right") {
      xPos = `W-w-${margin}`;
      yPos = String(margin);
    } else {
      // top-left
      xPos = String(margin);
      yPos = String(margin);
    }

    // Scale narrator video, apply rounded corners, and overlay
    // Note: Rounded corners via sendcmd + geq is complex, so we'll use a simpler approach:
    // 1. Scale narrator video to PIP size
    // 2. Overlay directly (FFmpeg doesn't natively support rounded corners without complex filters)
    // For production, consider pre-processing narrator video with rounded corners or using drawbox
    filterParts.push(
      `[${narratorInputIdx}:v]scale=${pipWidth}:${pipHeight}:force_original_aspect_ratio=decrease[pip]`,
    );

    // Overlay PIP on concatenated scenes
    filterParts.push(`[concatv][pip]overlay=${xPos}:${yPos}[outv]`);
  } else {
    // No PIP, concat output is the final output
    // We'll just use [concatv] as [outv] by renaming in the concat step above
    // Actually, FFmpeg doesn't allow label reassignment, so we need to use null filter
    filterParts.push(`[concatv]null[outv]`);
  }

  // Burn ASS captions if a subtitle file was provided (omitted for formats like CASUALLY_EXPLAINED)
  if (assPath) {
    const normalizedAssPath = assPath.replace(/\\/g, "/");
    // fontsdir lets libass resolve the ASS Style Fontname to the actual resolved
    // font file instead of a host-installed font (spec §7d).
    const fontsDirArg = fontsDir
      ? `:fontsdir='${fontsDir.replace(/\\/g, "/")}'`
      : "";
    filterParts.push(
      `[outv]subtitles=filename='${normalizedAssPath}'${fontsDirArg}[finalv]`,
    );
  } else {
    filterParts.push(`[outv]null[finalv]`);
  }

  // ── Audio mixing (if background music provided) ──────────────────────────
  // If music is provided, add audio mixing filters to filter_complex
  let audioMap = "";
  if (backgroundMusicPath && musicInputIdx !== null) {
    // Extract TTS audio, apply volume adjustment
    const ttsVolumeDb = -14; // Standard TTS volume level
    filterParts.push(`[${audioInputIdx}:a]volume=${ttsVolumeDb}dB[tts_audio]`);

    // Extract music, apply volume adjustment and loop
    filterParts.push(
      `[${musicInputIdx}:a]volume=${backgroundMusicVolumeDb}dB,aloop=loop=-1:size=2e+09[music]`,
    );

    // Mix TTS and music
    filterParts.push(
      `[tts_audio][music]amix=inputs=2:duration=first:dropout_transition=0[mixed]`,
    );

    // Apply loudness normalization
    filterParts.push(`[mixed]loudnorm=I=-14:TP=-1.5:LRA=11[final_audio]`);

    audioMap = "[final_audio]";
  } else {
    // No music - use direct audio from narrator or TTS file
    const audioIdx = narratorVideoPath ? narratorInputIdx! : audioInputIdx;
    audioMap = `${audioIdx}:a`;
  }

  const filterComplex = filterParts.join(";");

  // ── Output args ────────────────────────────────────────────────────────────
  return [
    ...inputArgs,
    "-filter_complex",
    filterComplex,
    "-map",
    "[finalv]",
    "-map",
    audioMap,
    "-c:v",
    "libx264",
    "-crf",
    "20",
    "-preset",
    "faster",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    "-y",
    outputPath,
  ];
}
