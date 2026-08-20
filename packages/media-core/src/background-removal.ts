/**
 * Background Removal
 *
 * Two modes:
 *
 * 'colorkey'  — FFmpeg colorkey filter. Removes a solid white background and
 *               outputs an RGBA PNG with transparency. Fast (~50ms), zero ML
 *               dependencies. Ideal for stickman images which always have a
 *               pure white background.
 *
 * 'rmbg2'     — withoutbg open-source local model (Focus v1.0.0) via Python subprocess.
 *               Handles complex, real-world backgrounds (photos, illustrations with
 *               gradients, etc.). Uses 4-stage ONNX pipeline — no PyTorch, no API key,
 *               no license required. Models (~320MB, 4 ONNX files) are downloaded from
 *               HuggingFace and cached on first call. ~2–5s per image on CPU.
 *
 * Both modes return an RGBA PNG buffer with the background replaced by transparency.
 */

import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the Python script — works from both dist/ and src/
const RMBG_SCRIPT_PATH = resolve(__dirname, "../scripts/remove-bg.py");

export interface RemoveBackgroundOptions {
  /**
   * For 'colorkey' mode: similarity threshold (0–1).
   * 0 = exact white only, higher values remove near-white pixels too.
   * Default: 0.12 — removes pure white while preserving anti-aliased edges.
   */
  colorThreshold?: number;
}

/**
 * Remove the background from an image and return an RGBA PNG with transparency.
 *
 * @param input   - Input image buffer (PNG or JPEG)
 * @param mode    - 'colorkey' for solid white backgrounds (stickman),
 *                  'rmbg2' for complex backgrounds (photos, illustrations)
 * @param options - Mode-specific options
 * @returns RGBA PNG buffer with transparent background
 */
export async function removeBackground(
  input: Buffer,
  mode: "colorkey" | "rmbg2" = "colorkey",
  options: RemoveBackgroundOptions = {},
): Promise<Buffer> {
  if (mode === "colorkey") {
    return removeBackgroundColorkey(input, options.colorThreshold ?? 0.12);
  }
  return removeBackgroundRMBG2(input);
}

// ---------------------------------------------------------------------------
// Colorkey — FFmpeg-based, solid white background removal
// ---------------------------------------------------------------------------

async function removeBackgroundColorkey(
  input: Buffer,
  threshold: number,
): Promise<Buffer> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inPath = join(tmpdir(), `rmbg-in-${id}.png`);
  const outPath = join(tmpdir(), `rmbg-out-${id}.png`);

  try {
    await writeFile(inPath, input);

    // colorkey=color:similarity:blend
    // similarity: how close to white to consider background (0=exact, 1=everything)
    // blend: soft edge transition (same value as similarity for natural AA handling)
    await execFileAsync("ffmpeg", [
      "-y",
      "-i", inPath,
      "-vf", `colorkey=white:${threshold}:${threshold},format=rgba`,
      outPath,
    ]);

    return await readFile(outPath);
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// RMBG-2.0 — Python subprocess, neural network background removal
// ---------------------------------------------------------------------------

async function removeBackgroundRMBG2(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [RMBG_SCRIPT_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    const outputChunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => outputChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errorChunks.push(chunk));

    child.on("close", (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(errorChunks).toString("utf8").slice(0, 500);
        reject(new Error(`RMBG-2.0 subprocess exited ${code}: ${stderr}`));
        return;
      }
      const output = Buffer.concat(outputChunks);
      if (output.length === 0) {
        reject(new Error("RMBG-2.0 subprocess produced no output"));
        return;
      }
      resolve(output);
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn RMBG-2.0 subprocess: ${err.message}`));
    });

    // Write input image to subprocess stdin, then close to signal EOF
    child.stdin.write(input);
    child.stdin.end();
  });
}
