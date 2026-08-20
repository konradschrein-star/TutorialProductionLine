import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";
const FPS = 25;
const CHUNK_SEC = 15;
const PRE_UPSCALE_W = 7680;
const PRE_UPSCALE_H = 4320;

// SLOW_VIDEO waypoints — same cinematic shape as the still Ken Burns but
// HALF the amplitudes so the camera drift never competes with the VEO clip's
// own ambient motion. Cyclic, so consecutive chunks wrap smoothly: chunk N's
// motion ends exactly where chunk N+1 begins, by Catmull-Rom construction.
interface Waypoint {
  z: number;
  x: number;
  y: number;
}
const WAYPOINTS: Waypoint[] = [
  { z: 1.0, x: 0.5, y: 0.5 },
  { z: 1.09, x: 0.42, y: 0.45 },
  { z: 1.07, x: 0.58, y: 0.48 },
  { z: 1.03, x: 0.52, y: 0.55 },
  { z: 1.1, x: 0.58, y: 0.58 },
  { z: 1.08, x: 0.42, y: 0.55 },
  { z: 1.04, x: 0.48, y: 0.5 },
  { z: 1.09, x: 0.55, y: 0.46 },
];

function catmullRom(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: string,
  t2: string,
  t3: string,
): string {
  const a = 2 * p1;
  const b = -p0 + p2;
  const c = 2 * p0 - 5 * p1 + 4 * p2 - p3;
  const d = -p0 + 3 * p1 - 3 * p2 + p3;
  return `(0.5*(${a}+(${b})*${t}+(${c})*${t2}+(${d})*${t3}))`;
}

function chunkZoompanFilter(
  globalChunkIdx: number,
  totalFrames: number,
): string {
  const N = WAYPOINTS.length;
  const w0 = WAYPOINTS[(globalChunkIdx - 1 + N) % N]!;
  const w1 = WAYPOINTS[globalChunkIdx % N]!;
  const w2 = WAYPOINTS[(globalChunkIdx + 1) % N]!;
  const w3 = WAYPOINTS[(globalChunkIdx + 2) % N]!;

  const t = `(on/${totalFrames})`;
  const t2 = `((on/${totalFrames})*(on/${totalFrames}))`;
  const t3 = `((on/${totalFrames})*(on/${totalFrames})*(on/${totalFrames}))`;

  const z = catmullRom(w0.z, w1.z, w2.z, w3.z, t, t2, t3);
  const xNorm = catmullRom(w0.x, w1.x, w2.x, w3.x, t, t2, t3);
  const yNorm = catmullRom(w0.y, w1.y, w2.y, w3.y, t, t2, t3);

  const x = `${xNorm}*iw*(1-1/${z})`;
  const y = `${yNorm}*ih*(1-1/${z})`;

  return `zoompan=z='${z}':x='${x}':y='${y}':d=${totalFrames}:s=1920x1080:fps=${FPS}`;
}

/**
 * Layer a chained, subtle Ken Burns motion on top of a video clip.
 *
 * The input is typically a VEO i2v clip that has already been looped to the
 * scene duration. We apply 15-second "chain links" of waypoint motion with
 * Catmull-Rom continuity at every boundary, so the camera drifts naturally
 * across the entire clip — and crucially, because `on` is the OUTPUT frame
 * number, the motion glides over the underlying loop boundaries without any
 * visible interruption or reset.
 *
 * Each chunk is rendered separately (parallel, fed via `-ss/-t` from the
 * already-looped source) and then concat-copied. Pre-upscale to 7680×4320
 * drops the zoompan rounding jitter floor below visible threshold.
 *
 * @param inputPath  - the looped VEO mp4 we want to drift over
 * @param outputPath - destination
 * @param durationSec - total clip length (matches inputPath duration)
 * @param clipOrdinal - drama_clips.clip_index — used to rotate the waypoint
 *                     starting phase so adjacent SCENES don't always start
 *                     their motion at the same waypoint.
 */
export async function applySubtleKenBurnsToClip(
  inputPath: string,
  outputPath: string,
  durationSec: number,
  clipOrdinal: number,
): Promise<void> {
  const numChunks = Math.max(1, Math.ceil(durationSec / CHUNK_SEC));
  const chunkDuration = durationSec / numChunks;

  if (numChunks === 1) {
    await renderChunkOverVideo(
      inputPath,
      outputPath,
      0,
      chunkDuration,
      clipOrdinal,
      false,
    );
    return;
  }

  const chunkPaths = Array.from(
    { length: numChunks },
    (_, i) => `${outputPath}.kbchunk-${i}.mp4`,
  );

  await Promise.all(
    chunkPaths.map((p, i) =>
      renderChunkOverVideo(
        inputPath,
        p,
        i * chunkDuration,
        chunkDuration,
        clipOrdinal + i,
        true,
      ),
    ),
  );

  const listPath = `${outputPath}.kblist.txt`;
  await writeFile(listPath, chunkPaths.map((p) => `file '${p}'`).join("\n"));
  await execFileAsync(FFMPEG_BIN, [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    outputPath,
  ]);

  for (const p of chunkPaths) await unlink(p).catch(() => {});
  await unlink(listPath).catch(() => {});
}

async function renderChunkOverVideo(
  inputPath: string,
  outputPath: string,
  startSec: number,
  durationSec: number,
  globalChunkIdx: number,
  isIntermediate: boolean,
): Promise<void> {
  const totalFrames = Math.ceil(durationSec * FPS);
  const zoompan = chunkZoompanFilter(globalChunkIdx, totalFrames);

  const vf = [
    `scale=${PRE_UPSCALE_W}:${PRE_UPSCALE_H}:force_original_aspect_ratio=decrease:flags=lanczos`,
    `pad=${PRE_UPSCALE_W}:${PRE_UPSCALE_H}:(ow-iw)/2:(oh-ih)/2:color=black`,
    zoompan,
    "format=yuv420p",
  ].join(",");

  await execFileAsync(FFMPEG_BIN, [
    "-y",
    "-ss",
    String(startSec),
    "-i",
    inputPath,
    "-t",
    String(durationSec),
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    isIntermediate ? "ultrafast" : "fast",
    "-crf",
    isIntermediate ? "23" : "20",
    "-r",
    String(FPS),
    "-an",
    outputPath,
  ]);
}
