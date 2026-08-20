import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink, stat } from "node:fs/promises";
import {
  requestVideoFromImage,
  downloadMedia,
} from "../../utils/media-gateway/index.js";
import { applySubtleKenBurnsToClip } from "./subtle-motion.js";

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";
const VEO_CLIP_DURATION_S = 8;
const LOOP_CROSSFADE_S = 0.5;

async function loopVideoToLength(
  inputPath: string,
  outputPath: string,
  targetSec: number,
): Promise<void> {
  const loopsNeeded = Math.ceil(targetSec / VEO_CLIP_DURATION_S);

  if (loopsNeeded <= 1) {
    await execFileAsync(FFMPEG_BIN, [
      "-y",
      "-i",
      inputPath,
      "-t",
      targetSec.toFixed(3),
      "-c",
      "copy",
      outputPath,
    ]);
    return;
  }

  const inputArgs: string[] = [];
  for (let i = 0; i < loopsNeeded; i++) {
    inputArgs.push("-i", inputPath);
  }

  let filterComplex = "";
  let prevLabel = "[0:v]";
  let offset = VEO_CLIP_DURATION_S - LOOP_CROSSFADE_S;

  for (let i = 1; i < loopsNeeded; i++) {
    const outLabel = i === loopsNeeded - 1 ? "[vout]" : `[xf${i}]`;
    filterComplex += `${prevLabel}[${i}:v]xfade=transition=fade:duration=${LOOP_CROSSFADE_S}:offset=${offset.toFixed(3)}${outLabel}`;
    if (i < loopsNeeded - 1) {
      filterComplex += ";";
      offset += VEO_CLIP_DURATION_S - LOOP_CROSSFADE_S;
    }
    prevLabel = outLabel;
  }

  const totalDuration =
    loopsNeeded * VEO_CLIP_DURATION_S - (loopsNeeded - 1) * LOOP_CROSSFADE_S;

  await execFileAsync(FFMPEG_BIN, [
    "-y",
    ...inputArgs,
    "-filter_complex",
    filterComplex,
    "-map",
    "[vout]",
    "-t",
    Math.min(targetSec, totalDuration).toFixed(3),
    "-c:v",
    "libx264",
    "-crf",
    "20",
    "-preset",
    "fast",
    "-an",
    outputPath,
  ]);
}

/**
 * Camera motion variations cycled per-clip so a 25-clip sequence doesn't
 * feel like 25 slow pushes in a row. Reality-TV / docudrama-flavoured —
 * no orbital crane shots or anamorphic dolly moves. The cycle index is
 * the clip_idx so adjacent clips never share the same motion.
 */
const MOTION_VARIATIONS = [
  "slow push in toward the subject's face, naturalistic handheld feel",
  "subtle pan left across the scene, eye-level, available light",
  "slow pull back revealing more of the room, observational documentary feel",
  "subtle pan right across the scene, slight handheld sway",
  "static frame with the subject moving or gesturing within it",
  "slow tilt down from the ceiling/wall to the subject, low energy",
  "slow arc around the subject, light handheld feel",
  "subtle handheld observational sway, no zoom, no pan, eye-level",
  "slow tilt up from the ground to the subject, low energy",
  "static wide shot with characters interacting, observational",
];

export function pickMotionPrompt(clipIdx: number): string {
  return MOTION_VARIATIONS[clipIdx % MOTION_VARIATIONS.length]!;
}

/**
 * Full per-clip SLOW_VIDEO pipeline: lab clone i2v (primary) with character
 * refs → VUP wrapper fallback on error → loop to scene duration. Produces
 * the final clip mp4 ready for assembly. Ken Burns is OFF — the VEO motion
 * prompt is the only camera move.
 *
 * Used by BOTH image-gen (inline, kicked off as each image lands — pipeline
 * parallelism) AND video-gen (cleanup pass for any clips image-gen didn't
 * finish). Both callers wrap this in their own try/catch so a single bad
 * clip never wedges the broader stage.
 */
export async function processSlowVideoClip(opts: {
  imagePath: string;
  characterRefs: string[];
  motionPrompt: string;
  durationSec: number;
  clipIdx: number;
  videoPath: string; // final output
}): Promise<void> {
  const { imagePath, characterRefs, motionPrompt, durationSec, clipIdx } = opts;
  const rawVideoPath = `${opts.videoPath}.raw.mp4`;
  const loopedPath = `${opts.videoPath}.looped.mp4`;

  // Idempotent resume: if the final video file already exists and is
  // non-trivial (>1 KB rules out half-written files from a crash),
  // skip this clip entirely. Lets a worker restart between video
  // creation and DB update without re-running the expensive i2v.
  try {
    const s = await stat(opts.videoPath);
    if (s.size > 1024) {
      console.log(
        JSON.stringify({
          level: "info",
          message: "Clip video already exists on disk, skipping i2v",
          clip_idx: clipIdx,
          video_path: opts.videoPath,
          size_bytes: s.size,
        }),
      );
      return;
    }
  } catch {
    // file doesn't exist or stat failed — proceed normally
  }

  // Generate video from image via the media gateway (handles backend
  // selection). The gateway accepts the local image path directly.
  try {
    const videoRef = await requestVideoFromImage(imagePath, {
      prompt: motionPrompt,
      format: "LONG_FORM_DRAMA",
      context: `drama:clip:${clipIdx}`,
    });
    await downloadMedia(videoRef, rawVideoPath);
  } catch (err) {
    throw new Error(
      `i2v generation failed for clip ${clipIdx}: ${String(err).slice(0, 200)}`,
    );
  }

  // Loop the 8s VEO output to scene length (single continuous mp4 — the
  // Ken Burns motion in the next step glides through every internal loop
  // boundary without interruption).
  if (durationSec > VEO_CLIP_DURATION_S) {
    await loopVideoToLength(rawVideoPath, loopedPath, durationSec);
  } else {
    await execFileAsync(FFMPEG_BIN, [
      "-y",
      "-i",
      rawVideoPath,
      "-t",
      durationSec.toFixed(3),
      "-c",
      "copy",
      loopedPath,
    ]);
  }
  await unlink(rawVideoPath).catch(() => {});

  // Ken Burns is intentionally OFF for the realistic-TV-style template.
  // The per-clip VEO motion prompt is the camera move; layering a
  // synthetic zoom on top reads as "still image with slow zoom" instead
  // of "real footage with real camera direction" — which is exactly the
  // problem we're trying to solve. Just rename the looped output and ship.
  await execFileAsync("mv", [loopedPath, opts.videoPath]);
}
