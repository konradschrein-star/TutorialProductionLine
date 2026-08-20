import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Probe video/audio file duration using ffprobe.
 *
 * Used by render workflows to get HeyGen footage duration before
 * computing scene pacing timings.
 *
 * @param filePath - Absolute path to the media file
 * @returns Duration in seconds (float)
 */
export async function probeMediaDuration(filePath: string): Promise<number> {
  const ffprobeBin = process.env["FFPROBE_PATH"] ?? "ffprobe";

  const { stdout } = await execFileAsync(ffprobeBin, [
    "-v", "quiet",
    "-print_format", "json",
    "-show_streams",
    "-select_streams", "v:0",
    filePath,
  ]);

  let parsed: any;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`ffprobe JSON parse failed for: ${filePath}`);
  }

  const stream = parsed?.streams?.[0];
  if (!stream) {
    // No video stream — try audio stream
    const { stdout: audioOut } = await execFileAsync(ffprobeBin, [
      "-v", "quiet",
      "-print_format", "json",
      "-show_streams",
      "-select_streams", "a:0",
      filePath,
    ]);
    const audioParsed = JSON.parse(audioOut);
    const audioStream = audioParsed?.streams?.[0];
    if (audioStream?.duration) return parseFloat(audioStream.duration);
    throw new Error(`No streams found in: ${filePath}`);
  }

  if (stream.duration) return parseFloat(stream.duration);

  // Fallback: use nb_frames / r_frame_rate
  if (stream.nb_frames && stream.r_frame_rate) {
    const [num, den] = stream.r_frame_rate.split("/").map(Number);
    const fps = num / den;
    return parseInt(stream.nb_frames, 10) / fps;
  }

  throw new Error(`Cannot determine duration for: ${filePath}`);
}

/**
 * Probe video file dimensions (width × height) using ffprobe.
 *
 * Used by render workflows to determine avatar aspect ratio for PIP overlay
 * sizing before passing props to Remotion.
 *
 * @param filePath - Absolute path to the media file
 * @returns Object with width and height in pixels
 */
export async function probeMediaDimensions(filePath: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const ffprobeBin = process.env["FFPROBE_PATH"] ?? "ffprobe";
    const ffprobe = spawn(ffprobeBin, [
      "-v", "quiet",
      "-print_format", "json",
      "-show_streams",
      "-select_streams", "v:0",
      filePath,
    ]);

    let stdout = "";
    ffprobe.stdout.on("data", (data) => { stdout += data.toString(); });
    ffprobe.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe dimensions failed with code ${code} for: ${filePath}`));
        return;
      }
      try {
        const info = JSON.parse(stdout);
        const stream = info.streams?.[0];
        if (!stream?.width || !stream?.height) {
          reject(new Error(`No video stream dimensions found in: ${filePath}`));
          return;
        }
        resolve({ width: stream.width, height: stream.height });
      } catch (e) {
        reject(new Error(`Failed to parse ffprobe output for ${filePath}: ${e}`));
      }
    });
  });
}
