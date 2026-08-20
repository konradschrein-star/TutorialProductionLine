import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "@repo/config";
import {
  FFmpegProgressTracker,
  type ProgressUpdateFn,
} from "../ffmpeg/progress-tracker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PYTHON_SCRIPT_PATH = resolve(
  __dirname,
  "../../scripts/kenburns-gpu-render.py",
);

export interface KenBurnsScene {
  imagePath: string;
  durationFrames: number;
  zoomFrom?: number; // default: 1.0
  zoomTo?: number; // default: 1.05
  panFromX?: number; // default: 0.5 (center)
  panFromY?: number; // default: 0.5
  panToX?: number; // default: panFromX (no pan)
  panToY?: number; // default: panFromY
  easing?: "linear" | "smoothstep" | "ease_in_out"; // default: smoothstep
}

export interface KenBurnsRenderParams {
  scenes: KenBurnsScene[];
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  useGPU?: boolean; // default: auto-detect
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
}

/**
 * Detect if NVIDIA GPU is available by running nvidia-smi.
 * Returns true if GPU available, false otherwise.
 */
async function detectGPU(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("nvidia-smi", [], { stdio: "ignore" });
    proc.on("error", () => resolve(false)); // Command not found
    proc.on("close", (code) => resolve(code === 0));
  });
}

/**
 * Check if FFmpeg supports h264_nvenc encoder.
 */
async function checkNVENCSupport(): Promise<boolean> {
  return new Promise((resolve) => {
    const ffmpegBin = process.env["FFMPEG_PATH"] ?? "ffmpeg";
    const proc = spawn(ffmpegBin, ["-encoders"], { stdio: "pipe" });

    let output = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.on("error", () => resolve(false));
    proc.on("close", (code) => {
      if (code !== 0) {
        resolve(false);
        return;
      }
      resolve(output.includes("h264_nvenc"));
    });
  });
}

/**
 * Render Ken Burns video using GPU-accelerated transform rendering.
 *
 * Pipeline:
 * 1. Spawn Python GPU renderer (outputs raw RGB24 to stdout)
 * 2. Spawn FFmpeg (reads RGB24 from stdin, encodes to h264_nvenc or libx264)
 * 3. Pipe Python stdout → FFmpeg stdin
 * 4. Write scene JSON to Python stdin
 * 5. Monitor both processes for errors
 *
 * @param params Render parameters
 * @throws Error if rendering fails
 */
export async function renderKenBurnsVideo(
  params: KenBurnsRenderParams,
): Promise<void> {
  const config = getConfig();
  const {
    scenes,
    outputPath,
    width,
    height,
    fps,
    useGPU,
    updateProgress,
    jobId,
  } = params;

  // GPU detection
  const gpuAvailable =
    useGPU !== false && (useGPU === true || (await detectGPU()));
  const nvencAvailable = gpuAvailable && (await checkNVENCSupport());

  // Choose encoder
  const videoCodec = nvencAvailable ? "h264_nvenc" : "libx264";
  const encoderPreset = nvencAvailable ? "fast" : "fast";

  console.log(
    JSON.stringify({
      level: "info",
      message: "Ken Burns renderer initializing",
      gpu_available: gpuAvailable,
      nvenc_available: nvencAvailable,
      encoder: videoCodec,
      scene_count: scenes.length,
      output_path: outputPath,
    }),
  );

  // Build scene JSON for Python script
  const sceneSpec = {
    scenes: scenes.map((scene) => ({
      image_path: scene.imagePath,
      duration_frames: scene.durationFrames,
      zoom_from: scene.zoomFrom ?? 1.0,
      zoom_to: scene.zoomTo ?? 1.05,
      pan_from_x: scene.panFromX ?? 0.5,
      pan_from_y: scene.panFromY ?? 0.5,
      pan_to_x: scene.panToX ?? scene.panFromX ?? 0.5,
      pan_to_y: scene.panToY ?? scene.panFromY ?? 0.5,
      easing: scene.easing ?? "smoothstep",
    })),
    width,
    height,
    fps,
  };

  const pythonBin = process.env["PYTHON_PATH"] ?? "python3";
  const ffmpegBin = process.env["FFMPEG_PATH"] ?? "ffmpeg";

  // Calculate total duration for progress tracking
  const totalFrames = scenes.reduce((acc, s) => acc + s.durationFrames, 0);
  const totalDurationSeconds = totalFrames / fps;

  // Initialize progress tracker if update callback provided
  let progressTracker: FFmpegProgressTracker | null = null;
  if (updateProgress && jobId) {
    progressTracker = new FFmpegProgressTracker({
      updateProgress,
      jobId,
      totalDurationSeconds,
    });
    console.log(
      `[kenburns-gpu] Progress tracking enabled for job ${jobId} (${totalDurationSeconds.toFixed(1)}s total)`,
    );
  }

  return new Promise((resolve, reject) => {
    // Spawn Python GPU renderer
    const pythonProc = spawn(pythonBin, [PYTHON_SCRIPT_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Spawn FFmpeg encoder
    const ffmpegArgs = [
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-s",
      `${width}x${height}`,
      "-r",
      String(fps),
      "-i",
      "pipe:0", // stdin
      "-c:v",
      videoCodec,
      "-preset",
      encoderPreset,
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-y",
      outputPath,
    ];

    const ffmpegProc = spawn(ffmpegBin, ffmpegArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Pipe Python stdout → FFmpeg stdin
    pythonProc.stdout.pipe(ffmpegProc.stdin);

    // Write scene JSON to Python stdin
    pythonProc.stdin.write(JSON.stringify(sceneSpec));
    pythonProc.stdin.end();

    // Capture stderr from both processes
    let pythonStderr = "";
    let ffmpegStderr = "";

    pythonProc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      pythonStderr += text;
      // Forward progress logs
      if (text.includes("[progress]") || text.includes("[success]")) {
        console.log(`[kenburns-gpu] ${text.trim()}`);
      }
    });

    ffmpegProc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      ffmpegStderr += text;

      // Update progress tracker (non-blocking)
      if (progressTracker) {
        progressTracker.parseAndUpdate(text).catch((err) => {
          console.error(
            `[kenburns-gpu] Progress tracking error (non-fatal): ${err}`,
          );
        });
      }

      // Log FFmpeg progress (time= pattern)
      const m = text.match(/time=(\d+:\d+:\d+\.\d+)/);
      if (m) {
        console.log(`[kenburns-gpu] FFmpeg: ${m[1]}`);
      }
    });

    // Error handling
    pythonProc.on("error", (err: Error) => {
      reject(
        new Error(
          `Failed to spawn Python GPU renderer: ${err.message}\nPath: ${PYTHON_SCRIPT_PATH}`,
        ),
      );
    });

    ffmpegProc.on("error", (err: Error) => {
      reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
    });

    pythonProc.on("close", (code: number | null) => {
      if (code !== 0) {
        const errorMatch = pythonStderr.match(/\{.*"error".*\}/);
        const errorMsg = errorMatch ? errorMatch[0] : pythonStderr.slice(-2000);

        reject(
          new Error(`Python GPU renderer failed (code ${code}):\n${errorMsg}`),
        );
      }
    });

    ffmpegProc.on("close", (code: number | null) => {
      if (code !== 0) {
        // If NVENC failed, could retry with libx264
        if (videoCodec === "h264_nvenc" && ffmpegStderr.includes("nvenc")) {
          reject(
            new Error(
              `FFmpeg NVENC encoding failed. Try setting useGPU=false for CPU fallback.\n${ffmpegStderr.slice(-2000)}`,
            ),
          );
        } else {
          reject(
            new Error(
              `FFmpeg encoding failed (code ${code}):\n${ffmpegStderr.slice(-2000)}`,
            ),
          );
        }
      } else {
        console.log(
          JSON.stringify({
            level: "info",
            message: "Ken Burns render complete",
            output_path: outputPath,
          }),
        );
        resolve();
      }
    });
  });
}
