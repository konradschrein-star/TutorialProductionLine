import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";
const FPS = 25;
const CHUNK_SEC = 15;
const PRE_UPSCALE_W = 7680;
const PRE_UPSCALE_H = 4320;

// Hand-tuned cinematic motion sequence. Each waypoint is one "chain link"
// (~15 seconds). The mix is deliberately varied — slow zoom-in, pan, zoom-out,
// drift — so the camera never feels mechanical, but ALSO never has a hard
// corner: Catmull-Rom interpolation between four consecutive waypoints
// gives C1 continuity (smooth velocity through every transition).
//
// Coordinates:
//   z   = zoom factor (1.0 = no zoom, 1.25 = 25% zoom in)
//   x,y = normalized crop position in [0,1]. 0.5 = centered. Actual pixel
//         offset is x * iw * (1 - 1/z) (so the crop window always fits).
//
// The sequence is cyclic; chunks past the last waypoint wrap to the start
// with continuous tangents, so a 25-minute video keeps moving without
// repeating the same motion at the same point in the image.
interface Waypoint {
  z: number;
  x: number;
  y: number;
}
const WAYPOINTS: Waypoint[] = [
  { z: 1.0, x: 0.5, y: 0.5 }, // 0: establish, no zoom
  { z: 1.18, x: 0.35, y: 0.4 }, // 1: slow zoom into upper-left
  { z: 1.15, x: 0.65, y: 0.45 }, // 2: gentle pan right
  { z: 1.05, x: 0.55, y: 0.55 }, // 3: zoom out, drift down
  { z: 1.22, x: 0.65, y: 0.65 }, // 4: stronger zoom into lower-right
  { z: 1.16, x: 0.35, y: 0.6 }, // 5: pan left, hold zoom
  { z: 1.04, x: 0.45, y: 0.5 }, // 6: zoom out toward center
  { z: 1.2, x: 0.55, y: 0.42 }, // 7: re-zoom up; loops back to 0 smoothly
];

export type MotionPreset = "DEFAULT";

export function selectMotionPreset(
  _clipIndex?: number,
  _isFirst?: boolean,
): MotionPreset {
  return "DEFAULT";
}

/**
 * Catmull-Rom polynomial for one scalar dimension.
 * Returns an FFmpeg expression that interpolates from p1 to p2 as `tExpr`
 * goes 0→1, using p0 and p3 to set tangents (so consecutive chunks share
 * direction at the boundary — no kinks).
 *
 *   P(t) = 0.5 * ( 2p1 + (-p0+p2)t + (2p0-5p1+4p2-p3)t² + (-p0+3p1-3p2+p3)t³ )
 */
function catmullRom(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  tExpr: string,
  t2Expr: string,
  t3Expr: string,
): string {
  const a = 2 * p1;
  const b = -p0 + p2;
  const c = 2 * p0 - 5 * p1 + 4 * p2 - p3;
  const d = -p0 + 3 * p1 - 3 * p2 + p3;
  return `(0.5*(${a}+(${b})*${tExpr}+(${c})*${t2Expr}+(${d})*${t3Expr}))`;
}

function chunkZoompanFilter(chunkIdx: number, totalFrames: number): string {
  const N = WAYPOINTS.length;
  const w0 = WAYPOINTS[(chunkIdx - 1 + N) % N]!;
  const w1 = WAYPOINTS[chunkIdx % N]!;
  const w2 = WAYPOINTS[(chunkIdx + 1) % N]!;
  const w3 = WAYPOINTS[(chunkIdx + 2) % N]!;

  const t = `(on/${totalFrames})`;
  const t2 = `((on/${totalFrames})*(on/${totalFrames}))`;
  const t3 = `((on/${totalFrames})*(on/${totalFrames})*(on/${totalFrames}))`;

  const z = catmullRom(w0.z, w1.z, w2.z, w3.z, t, t2, t3);
  const xNorm = catmullRom(w0.x, w1.x, w2.x, w3.x, t, t2, t3);
  const yNorm = catmullRom(w0.y, w1.y, w2.y, w3.y, t, t2, t3);

  // x and y are top-left of the crop window in source pixels. Crop dims are
  // iw/z × ih/z. The valid range for x is [0, iw*(1-1/z)] (same for y).
  // Normalized position maps linearly into that range.
  const x = `${xNorm}*iw*(1-1/${z})`;
  const y = `${yNorm}*ih*(1-1/${z})`;

  return `zoompan=z='${z}':x='${x}':y='${y}':d=${totalFrames}:s=1920x1080:fps=${FPS}`;
}

/**
 * Render a Ken Burns motion segment from a still image. Long clips are
 * split into 15-second "chain links" — each chunk interpolates between
 * two consecutive waypoints, and the next chunk picks up exactly where
 * the previous one left off (Catmull-Rom guarantees both position and
 * velocity continuity at boundaries — no hard cuts, no kinks).
 *
 * Source is pre-upscaled to 7680×4320 before zoompan so the per-frame
 * integer-pixel rounding inside zoompan becomes 0.25 output px — well
 * below visible jitter threshold.
 */
export async function generateKenBurnsSegment(
  imagePath: string,
  outputPath: string,
  durationSeconds: number,
  _preset?: MotionPreset,
): Promise<void> {
  const numChunks = Math.max(1, Math.ceil(durationSeconds / CHUNK_SEC));
  const chunkDuration = durationSeconds / numChunks;

  if (numChunks === 1) {
    await renderChunk(imagePath, outputPath, chunkDuration, 0, false);
    return;
  }

  const chunkPaths = Array.from(
    { length: numChunks },
    (_, i) => `${outputPath}.chunk-${i}.mp4`,
  );

  // Chunks share endpoints by construction, so they can be rendered in
  // parallel — each only needs its own waypoint indices.
  await Promise.all(
    chunkPaths.map((chunkPath, i) =>
      renderChunk(imagePath, chunkPath, chunkDuration, i, true),
    ),
  );

  const listPath = `${outputPath}.list.txt`;
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

async function renderChunk(
  imagePath: string,
  outputPath: string,
  durationSeconds: number,
  chunkIdx: number,
  isIntermediate: boolean,
): Promise<void> {
  const totalFrames = Math.ceil(durationSeconds * FPS);
  const zoompan = chunkZoompanFilter(chunkIdx, totalFrames);

  const vfFilter = [
    `scale=${PRE_UPSCALE_W}:${PRE_UPSCALE_H}:force_original_aspect_ratio=decrease:flags=lanczos`,
    `pad=${PRE_UPSCALE_W}:${PRE_UPSCALE_H}:(ow-iw)/2:(oh-ih)/2:color=black`,
    zoompan,
    "format=yuv420p",
  ].join(",");

  await execFileAsync(FFMPEG_BIN, [
    "-y",
    "-loop",
    "1",
    "-framerate",
    String(FPS),
    "-i",
    imagePath,
    "-vf",
    vfFilter,
    "-c:v",
    "libx264",
    "-preset",
    isIntermediate ? "ultrafast" : "fast",
    "-crf",
    isIntermediate ? "23" : "20",
    "-t",
    String(durationSeconds),
    "-r",
    String(FPS),
    outputPath,
  ]);
}
