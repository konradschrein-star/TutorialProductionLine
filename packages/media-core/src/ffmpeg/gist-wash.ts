import { spawn } from "node:child_process";

/**
 * Apply GIST (Gaussian noise + crop jitter) wash to video.
 * Anti-detection technique to create unique fingerprints per render.
 *
 * @param inputPath - Input video path
 * @param outputPath - Output video path
 */
export async function applyGistWash(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i",
      inputPath,
      "-vf",
      "noise=alls=10:allf=t+u,crop=iw-2:ih-2:1:1",
      "-c:v",
      "libx264",
      "-crf",
      "20",
      "-maxrate",
      "15M",
      "-bufsize",
      "30M",
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
        reject(new Error(`GIST wash failed with code ${code}: ${stderr}`));
        return;
      }
      console.log(`[ffmpeg] GIST wash complete: ${outputPath}`);
      resolve();
    });
  });
}
