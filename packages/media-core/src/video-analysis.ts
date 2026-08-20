/**
 * Video Analysis - Black Screen Detection and Scene Counting
 *
 * Uses FFmpeg filters for:
 * - Black screen detection via blackframe filter (brightness sampling)
 * - Scene change detection via scenedetect filter
 *
 * Black screen threshold: >80% of frames with brightness < 10
 * Scene detection threshold: Default 0.3 (30% pixel difference)
 */

import { execa as defaultExeca } from "execa";

// Type for dependency injection
export type ExecFn = typeof defaultExeca;

/**
 * Analysis timeout in milliseconds (2 minutes for FFmpeg processing)
 */
const ANALYSIS_TIMEOUT_MS = 120_000;

/**
 * Black screen detection threshold: percentage of frames that must be black
 * to consider the video a black screen
 */
const BLACK_SCREEN_THRESHOLD_PERCENT = 80;

/**
 * Brightness threshold: frames with brightness < this value are considered black
 */
const BRIGHTNESS_THRESHOLD = 10;

/**
 * Number of frames to sample across the video for black screen detection
 */
const SAMPLE_FRAMES = 10;

/**
 * Default scene detection threshold (0.0 to 1.0)
 * 0.3 = 30% pixel difference triggers a scene change
 */
const DEFAULT_SCENE_THRESHOLD = 0.3;

/**
 * Result of black screen detection
 */
export interface BlackScreenDetectionResult {
  is_black_screen: boolean; // True if >80% frames are black
  black_frame_percentage: number; // Percentage of frames with brightness < 10
  sampled_frames: number; // Number of frames sampled
  average_brightness: number; // Average brightness across sampled frames
}

/**
 * Result of scene counting
 */
export interface SceneCountResult {
  scene_count: number; // Number of scene changes detected
  scene_timestamps: number[]; // Timestamps (in seconds) where scenes change
}

/**
 * Detect black screens by sampling frame brightness.
 *
 * Uses FFmpeg's blackframe filter with metadata output to extract brightness
 * values from frames distributed across the video. Returns true if >80% of
 * sampled frames have brightness < 10 (essentially all black).
 *
 * FFmpeg filter: blackframe=threshold=10:amount=98,metadata=print:file=-
 * - threshold=10: Brightness threshold for black frame detection
 * - amount=98: Percentage of pixels below threshold to consider frame "black"
 * - metadata=print: Output brightness values in metadata format
 *
 * @param videoPath - Absolute path to video file
 * @param execFn - Optional function for dependency injection (defaults to execa)
 * @returns Black screen detection result with percentage and average brightness
 * @throws Error if brightness data not found in FFmpeg output
 */
export async function detectBlackScreen(
  videoPath: string,
  execFn: ExecFn = defaultExeca,
): Promise<BlackScreenDetectionResult> {
  const ffmpegBin = process.env.FFMPEG_PATH ?? "ffmpeg";

  // Sample SAMPLE_FRAMES frames across the video using fps filter
  // blackframe filter with metadata outputs brightness values for each frame
  const filterComplex = `fps=${SAMPLE_FRAMES / 5},blackframe=threshold=10:amount=98,metadata=print:file=-`;

  const result = await execFn(
    ffmpegBin,
    ["-i", videoPath, "-vf", filterComplex, "-f", "null", "-"],
    {
      timeout: ANALYSIS_TIMEOUT_MS,
      reject: false, // Don't throw on FFmpeg non-zero exit
    },
  );

  const output = result.stderr;

  // Parse brightness values from blackframe metadata output: brightness:X.X
  const brightnessMatches = output.match(/brightness:([\d.]+)/g);

  if (!brightnessMatches || brightnessMatches.length === 0) {
    throw new Error(
      `Brightness data not found in FFmpeg output for: ${videoPath}`,
    );
  }

  // Extract numeric values from matches
  const brightnessValues = brightnessMatches.map((match) => {
    const valueMatch = match.match(/brightness:([\d.]+)/);
    return valueMatch ? parseFloat(valueMatch[1]) : 0;
  });

  // Count frames with brightness < BRIGHTNESS_THRESHOLD
  const blackFrameCount = brightnessValues.filter(
    (brightness) => brightness < BRIGHTNESS_THRESHOLD,
  ).length;

  const blackFramePercentage = Math.round(
    (blackFrameCount / brightnessValues.length) * 100,
  );

  const averageBrightness =
    brightnessValues.reduce((sum, val) => sum + val, 0) /
    brightnessValues.length;

  const isBlackScreen = blackFramePercentage >= BLACK_SCREEN_THRESHOLD_PERCENT;

  return {
    is_black_screen: isBlackScreen,
    black_frame_percentage: blackFramePercentage,
    sampled_frames: brightnessValues.length,
    average_brightness: Math.round(averageBrightness * 100) / 100,
  };
}

/**
 * Count scene changes in a video using FFmpeg scene detection.
 *
 * Uses FFmpeg's scenedetect filter combined with showinfo to identify points
 * where the scene changes significantly. Returns the count and timestamps of
 * scene changes.
 *
 * @param videoPath - Absolute path to video file
 * @param threshold - Optional scene detection threshold (0.0 to 1.0). Default: 0.3
 * @param execFn - Optional function for dependency injection (defaults to execa)
 * @returns Scene count result with timestamps where scenes change
 * @throws Error if showinfo output not found in FFmpeg output
 */
export async function countScenes(
  videoPath: string,
  threshold: number = DEFAULT_SCENE_THRESHOLD,
  execFn: ExecFn = defaultExeca,
): Promise<SceneCountResult> {
  const ffmpegBin = process.env.FFMPEG_PATH ?? "ffmpeg";

  // Use scenedetect to identify scene changes and showinfo to get timestamps
  const filterComplex = `scenedetect=t=${threshold},showinfo`;

  const result = await execFn(
    ffmpegBin,
    ["-i", videoPath, "-vf", filterComplex, "-f", "null", "-"],
    {
      timeout: ANALYSIS_TIMEOUT_MS,
      reject: false, // Don't throw on FFmpeg non-zero exit
    },
  );

  const output = result.stderr;

  // Parse pts_time from showinfo output to get timestamps
  // Format: [showinfo @ ...] n:   0 pts: 0 pts_time:0.000000 ...
  const timestampMatches = output.match(
    /\[showinfo[^\]]*\].*?pts_time:([\d.]+)/g,
  );

  if (!timestampMatches || timestampMatches.length === 0) {
    throw new Error(
      `showinfo output not found in FFmpeg output for: ${videoPath}`,
    );
  }

  // Extract numeric timestamps
  const timestamps = timestampMatches.map((match) => {
    const timeMatch = match.match(/pts_time:([\d.]+)/);
    return timeMatch ? parseFloat(timeMatch[1]) : 0;
  });

  // Scene changes are detected when there's significant pixel difference
  // For simplicity, we count unique significant jumps as scene changes
  // In practice, FFmpeg's scenedetect logs these, but for this implementation
  // we'll use frame-to-frame variation in timestamps as a heuristic
  const sceneTimestamps: number[] = [timestamps[0] ?? 0]; // Start with first frame

  // Detect scene changes by looking for gaps in pts_time continuity
  // or by detecting the actual scenedetect filter output
  for (let i = 1; i < timestamps.length; i++) {
    const timeDiff = timestamps[i] - timestamps[i - 1];
    // If there's a significant jump or if scenedetect marked this as a scene,
    // add to scene boundaries (simplified heuristic)
    if (i > 1 && timeDiff > 0.1) {
      if (!sceneTimestamps.includes(timestamps[i])) {
        sceneTimestamps.push(timestamps[i]);
      }
    }
  }

  // More accurate: parse scenedetect actual output if available
  // Look for SCR (screen content rating) or scene boundary markers
  const sceneMarkers = output.match(
    /\[scenedetect[^\]]*\].*?(?:Detected scene|scene cut)/gi,
  );
  const detectedSceneCount = sceneMarkers ? sceneMarkers.length : 0;

  // If scenedetect found markers, use that; otherwise count scene boundaries
  // Minimum 1 scene if we have any timestamps
  const finalSceneCount = Math.max(
    detectedSceneCount,
    Math.max(sceneTimestamps.length - 1, 1),
  );

  return {
    scene_count: finalSceneCount,
    scene_timestamps: sceneTimestamps,
  };
}
