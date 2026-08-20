import { spawn } from "node:child_process";

/**
 * Upscale video to 1440p (2560x1440).
 * Forces YouTube to use VP9 codec for better quality and detection resistance.
 *
 * @param inputPath - Input video path
 * @param outputPath - Output video path
 */
export async function upscaleTo1440p(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i",
      inputPath,
      "-vf",
      "scale=2560:1440",
      "-c:v",
      "libx264",
      "-b:v",
      "15M",
      "-maxrate",
      "20M",
      "-bufsize",
      "40M",
      "-preset",
      "faster",
      "-c:a",
      "copy",
      "-y",
      outputPath,
    ]);

    let stderr = "";

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`1440p upscale failed with code ${code}: ${stderr}`));
        return;
      }
      console.log(`[ffmpeg] 1440p upscale complete: ${outputPath}`);
      resolve();
    });
  });
}
