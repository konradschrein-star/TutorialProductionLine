/**
 * Presenter overlay track — a browserless alpha video of the suit + pumping head.
 *
 * The presenter is a photographic headless torso (a static RGBA PNG) with a flat
 * circular logo for a head. The only audio-driven motion is a scale pump on the
 * head, driven by the narration RMS envelope (`../audio-envelope.ts`). No mouth
 * states, no lip sync (design §3.3).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OUTPUT FORMAT: VP9 `yuva420p` WebM, not a PNG sequence. Justification:
 *
 * 1. It is already the alpha interchange in this repo.
 *    `apps/worker-render/src/workflows/caption-overlay-pass.ts` renders VP9
 *    `yuva420p` and composites it in one pass with
 *    `[0:v][1:v]overlay=0:0:format=auto`. W1 can reuse that recipe verbatim
 *    instead of learning a second convention.
 * 2. A PNG sequence does not fit on disk. A 15-minute 1080p track is 27,000
 *    frames; RGBA PNG at that size is ~1-3 MB each, i.e. 30-80 GB per video on
 *    a box with a documented disk-pressure history. The measured VP9 alpha
 *    output for a mostly-transparent, mostly-static frame is ~100 KB per 3
 *    seconds at 960x540.
 * 3. It stays frame-exact. The head layer is fed through the ffmpeg concat
 *    demuxer at exactly 1/fps per entry plus an `fps` filter, so envelope frame
 *    N drives video frame N with no resampling drift.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW THE PER-FRAME SCALE IS DONE WITHOUT A BROWSER AND WITHOUT 27,000 FILES:
 *
 * ffmpeg's `scale` filter cannot take a per-frame expression, so the head is
 * QUANTISED into a small number of scale steps (default 33 across a 1.00-1.08
 * range = 0.25% per step, sub-pixel on a ~170px head). Each step is rasterised
 * ONCE and padded onto a CONSTANT canvas, so:
 *   - every head frame has identical dimensions => the concat demuxer is happy
 *     and the `overlay` x/y is a constant, not a per-frame expression;
 *   - the vertical "lift" that accompanies a loud frame is baked into the pad
 *     offset of each step, so it also needs no per-frame expression.
 * The concat list then names one of those K files per video frame.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FAIL-CLOSED: an uncalibrated pose throws (see `requireCalibratedPose`). All
 * 16 entries of `media/style-assets/presenter/poses/poses.json` currently read
 * `anchor_status: "needs-calibration"` with null anchors, so this WILL throw
 * until the Presenter Studio (task U1) writes real hitboxes. That is correct
 * and intended: a guessed head position is worse than a failed render.
 *
 * SCOPE NOTE: build one track per presenter SEGMENT, not one per video. The
 * presenter appears at the hook, the CTA, the close and on beats where he moves
 * (design §5) — not continuously. VP9 alpha encodes at well under realtime on
 * CPU, so a 15-minute single track would dominate render time.
 */

import { spawn } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CalibratedPose } from "@repo/contracts";
import {
  requireCalibratedPose,
  resolvePresenterLayout,
} from "./pose-normalise.js";
import type { PresenterLayout, PresenterPlacement } from "./pose-normalise.js";

/** Head scale multipliers at envelope 0 and envelope 1. */
export interface HeadScaleRange {
  /** Scale at silence. */
  min: number;
  /** Scale at the envelope's normalisation peak. */
  max: number;
}

/**
 * Design §4.3: "the envelope maps to head scale in roughly the 1.00-1.08 range".
 * Callers may override; this is the documented starting point, not a fallback
 * for missing data.
 */
export const DEFAULT_HEAD_SCALE_RANGE: HeadScaleRange = { min: 1.0, max: 1.08 };

/** Distinct head rasterisations. 33 across 1.00-1.08 is 0.25% per step. */
export const DEFAULT_HEAD_SCALE_STEPS = 33;

/** Where the head mark bitmap comes from. */
export type HeadMarkSource =
  | {
      kind: "png";
      /**
       * Absolute path to a pre-rasterised RGBA PNG of the head mark. Must be at
       * least the track's maximum head diameter in pixels or the mark upscales
       * and reads soft.
       */
      path: string;
    }
  | {
      kind: "svg";
      /** Absolute path to the head mark SVG. */
      path: string;
      /**
       * Rasteriser for the SVG. There is deliberately no default: ffmpeg in
       * this repo is built WITHOUT librsvg (verified 2026-08-15 — `-i
       * head-mark.svg` fails with "no decoder found for: svg"), and media-core
       * has no image library. The caller supplies one (hub-web already depends
       * on `sharp`), or passes `kind: "png"` with a mark exported by the
       * Presenter Studio.
       */
      rasterise: SvgRasteriser;
    };

/** Rasterise an SVG file to an RGBA PNG at an exact pixel size. */
export type SvgRasteriser = (params: {
  svgPath: string;
  widthPx: number;
  heightPx: number;
  outputPath: string;
}) => Promise<void>;

export interface PresenterTrackParams {
  /**
   * A `poses.json` entry. Typed `unknown` on purpose — it is parsed with
   * `CalibratedPoseSchema` so an uncalibrated pose throws instead of flowing
   * into layout math.
   */
  pose: unknown;
  /** Absolute path to the pose's matted RGBA PNG (`poses/<slug>.png`). */
  posePngPath: string;
  /** The head mark bitmap source. */
  headMark: HeadMarkSource;
  /** Normalised 0..1 loudness, one value per output frame (see computeRmsEnvelope). */
  envelope: number[];
  /** Output frame rate. Must match the envelope's fps. */
  fps: number;
  /** Output width in pixels. Must be even. */
  width: number;
  /** Output height in pixels. Must be even. */
  height: number;
  /** Figure placement and apparent-size normalisation. */
  placement: PresenterPlacement;
  /** Head scale at envelope 0 and 1. Default {@link DEFAULT_HEAD_SCALE_RANGE}. */
  headScaleRange?: HeadScaleRange;
  /** Distinct rasterised head sizes. Default {@link DEFAULT_HEAD_SCALE_STEPS}. */
  headScaleSteps?: number;
  /**
   * Maximum upward offset of the head, in output pixels, at envelope 1
   * ("a slight vertical offset", design §4.3). Default 0 — the caller decides
   * whether this scene wants the lift. Not a stand-in for missing data.
   */
  headLiftPx?: number;
  /** Scratch directory for the intermediate head PNGs and the concat list. */
  workDir: string;
  /** Absolute path of the `.webm` to write. */
  outputPath: string;
  /** libvpx-vp9 CRF. Default 32 — the track is flat colour over transparency. */
  crf?: number;
  /** libvpx-vp9 `-cpu-used`. Default 5; higher is faster and softer. */
  cpuUsed?: number;
}

export interface PresenterTrackResult {
  /** Path of the written alpha webm. */
  outputPath: string;
  /** Frames written — always `envelope.length`. */
  frameCount: number;
  /** Resolved figure/head geometry, for the compositor and for debugging. */
  layout: PresenterLayout;
  /** The head scale multiplier of each quantisation step. */
  stepScales: number[];
  /** Per-frame index into `stepScales`. */
  stepIndexPerFrame: number[];
  /** Square canvas size of each head step PNG, in pixels. */
  headCanvasPx: number;
  /** Size of the written file, in bytes. */
  sizeBytes: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure: quantisation
// ─────────────────────────────────────────────────────────────────────────────

function evenCeil(value: number): number {
  const ceiled = Math.ceil(value);
  return ceiled % 2 === 0 ? ceiled : ceiled + 1;
}

function evenRound(value: number): number {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

/**
 * The head scale multiplier of each quantisation step, evenly spaced from
 * `range.min` (step 0) to `range.max` (step `steps - 1`).
 *
 * @throws Error if `steps` is not an integer >= 2, if either bound is not
 *         finite and positive, or if `max < min`.
 */
export function buildHeadScaleSteps(
  range: HeadScaleRange,
  steps: number,
): number[] {
  if (!Number.isInteger(steps) || steps < 2) {
    throw new Error(
      `[presenter-track] headScaleSteps must be an integer >= 2, got ${steps}.`,
    );
  }
  if (!Number.isFinite(range.min) || range.min <= 0) {
    throw new Error(
      `[presenter-track] headScaleRange.min must be finite and > 0, got ${range.min}.`,
    );
  }
  if (!Number.isFinite(range.max) || range.max < range.min) {
    throw new Error(
      `[presenter-track] headScaleRange.max must be finite and >= min, got min=${range.min} max=${range.max}.`,
    );
  }
  const out: number[] = new Array<number>(steps);
  for (let i = 0; i < steps; i++) {
    out[i] = range.min + ((range.max - range.min) * i) / (steps - 1);
  }
  return out;
}

/**
 * Map each normalised envelope value to a quantisation step index.
 *
 * @throws Error if the envelope is empty, `steps` is not an integer >= 2, or any
 *         value is not a finite number in 0..1. An out-of-range value means the
 *         envelope was not produced by `normaliseEnvelope`, and clamping it
 *         silently would hide that.
 */
export function quantiseEnvelopeToSteps(
  envelope: number[],
  steps: number,
): number[] {
  if (envelope.length === 0) {
    throw new Error(
      "[presenter-track] quantiseEnvelopeToSteps: envelope is empty. A presenter " +
        "track needs one loudness value per frame — compute it with computeRmsEnvelope().",
    );
  }
  if (!Number.isInteger(steps) || steps < 2) {
    throw new Error(
      `[presenter-track] quantiseEnvelopeToSteps: steps must be an integer >= 2, got ${steps}.`,
    );
  }
  const out: number[] = new Array<number>(envelope.length);
  for (let i = 0; i < envelope.length; i++) {
    const v = envelope[i];
    if (v === undefined || !Number.isFinite(v) || v < 0 || v > 1) {
      throw new Error(
        `[presenter-track] quantiseEnvelopeToSteps: envelope[${i}] is ${String(v)}, ` +
          "expected a finite number in 0..1. This envelope did not come from " +
          "normaliseEnvelope() — refusing to guess what it means.",
      );
    }
    out[i] = Math.round(v * (steps - 1));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure: ffmpeg argv + concat list
// ─────────────────────────────────────────────────────────────────────────────

/** Filename of head quantisation step `index` inside the work directory. */
export function headStepFileName(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(
      `[presenter-track] headStepFileName: index must be a non-negative integer, got ${index}.`,
    );
  }
  return `head-step-${String(index).padStart(3, "0")}.png`;
}

/**
 * ffmpeg argv that renders one head quantisation step: scale the master mark to
 * `diameterPx` and pad it, transparent, onto a `canvasPx` square, shifted up by
 * `liftPx`.
 *
 * Padding to a constant canvas is what keeps the final overlay position a
 * constant instead of a per-frame expression.
 *
 * @throws Error if the diameter plus twice the lift does not fit the canvas —
 *         that would clip the mark, and clipping the head is not something to
 *         discover in the output.
 */
export function buildHeadStepArgs(params: {
  headMasterPngPath: string;
  canvasPx: number;
  diameterPx: number;
  liftPx: number;
  outputPath: string;
}): string[] {
  const { headMasterPngPath, canvasPx, diameterPx, liftPx, outputPath } =
    params;

  if (!Number.isInteger(canvasPx) || canvasPx < 2) {
    throw new Error(
      `[presenter-track] buildHeadStepArgs: canvasPx must be an integer >= 2, got ${canvasPx}.`,
    );
  }
  if (!Number.isInteger(diameterPx) || diameterPx < 2) {
    throw new Error(
      `[presenter-track] buildHeadStepArgs: diameterPx must be an integer >= 2, got ${diameterPx}.`,
    );
  }
  if (!Number.isFinite(liftPx) || liftPx < 0) {
    throw new Error(
      `[presenter-track] buildHeadStepArgs: liftPx must be finite and >= 0, got ${liftPx}.`,
    );
  }

  const padX = Math.round((canvasPx - diameterPx) / 2);
  const padY = Math.round((canvasPx - diameterPx) / 2 - liftPx);
  if (padX < 0 || padY < 0) {
    throw new Error(
      `[presenter-track] buildHeadStepArgs: a ${diameterPx}px mark lifted ${liftPx}px does not ` +
        `fit a ${canvasPx}px canvas (pad offset ${padX},${padY}). The canvas must be at least ` +
        "maxDiameter + 2 * headLiftPx.",
    );
  }

  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-y",
    "-i",
    headMasterPngPath,
    "-vf",
    `format=rgba,scale=${diameterPx}:${diameterPx}:flags=lanczos,` +
      `pad=${canvasPx}:${canvasPx}:${padX}:${padY}:color=black@0`,
    "-frames:v",
    "1",
    outputPath,
  ];
}

/** Escape a filename for a concat-demuxer single-quoted `file` line. */
function escapeConcatEntry(name: string): string {
  return name.replace(/'/g, "'\\''");
}

/**
 * Build the ffmpeg concat-demuxer list that plays one head step image per video
 * frame.
 *
 * Entries are BASENAMES: the concat demuxer resolves relative paths against the
 * list file's own directory, which sidesteps Windows drive letters, backslashes
 * and spaces entirely. Write the list into the same directory as the step PNGs.
 *
 * The final entry is repeated without a `duration` because the concat demuxer
 * ignores the duration of the last entry — without the repeat the track is one
 * frame short.
 *
 * @throws Error if the frame list is empty, references a step that does not
 *         exist, or `fps` is not finite and positive.
 */
export function buildConcatListText(params: {
  stepFileNames: string[];
  stepIndexPerFrame: number[];
  fps: number;
}): string {
  const { stepFileNames, stepIndexPerFrame, fps } = params;

  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(
      `[presenter-track] buildConcatListText: fps must be finite and > 0, got ${fps}.`,
    );
  }
  if (stepFileNames.length === 0) {
    throw new Error(
      "[presenter-track] buildConcatListText: no head step files were generated.",
    );
  }
  if (stepIndexPerFrame.length === 0) {
    throw new Error(
      "[presenter-track] buildConcatListText: stepIndexPerFrame is empty — nothing to render.",
    );
  }

  const frameDuration = (1 / fps).toFixed(9);
  const lines: string[] = ["ffconcat version 1.0"];

  for (let f = 0; f < stepIndexPerFrame.length; f++) {
    const index = stepIndexPerFrame[f];
    const name = index === undefined ? undefined : stepFileNames[index];
    if (name === undefined) {
      throw new Error(
        `[presenter-track] buildConcatListText: frame ${f} references head step ` +
          `${String(index)}, but only ${stepFileNames.length} steps exist.`,
      );
    }
    lines.push(`file '${escapeConcatEntry(name)}'`);
    lines.push(`duration ${frameDuration}`);
  }

  const lastIndex = stepIndexPerFrame[stepIndexPerFrame.length - 1];
  const lastName =
    lastIndex === undefined ? undefined : stepFileNames[lastIndex];
  if (lastName === undefined) {
    throw new Error(
      "[presenter-track] buildConcatListText: could not resolve the final head step.",
    );
  }
  lines.push(`file '${escapeConcatEntry(lastName)}'`);

  return `${lines.join("\n")}\n`;
}

/**
 * ffmpeg argv for the alpha presenter track.
 *
 * Graph:
 * ```
 * [0] color=black -> rgba -> alpha 0        transparent base, exact WxH @ fps
 * [1] suit PNG    -> rgba -> scale (-> hflip)
 * [2] concat of head step PNGs -> fps -> rgba
 * base <- overlay suit <- overlay head
 * ```
 * `colorchannelmixer=aa=0` forces the base fully transparent: `color=black@0`
 * alone is not reliable, because the colour source may negotiate a format with
 * no alpha plane and the request is silently dropped.
 *
 * `-auto-alt-ref 0` is REQUIRED: libvpx-vp9 alt-ref frames and the alpha plane
 * are mutually exclusive, and with alt-ref on the alpha is silently dropped.
 *
 * @throws Error on non-even or non-positive output dimensions, non-positive fps
 *         or frame count, or a non-positive suit size.
 */
export function buildPresenterTrackArgs(params: {
  suitPngPath: string;
  concatListPath: string;
  outputPath: string;
  fps: number;
  width: number;
  height: number;
  frameCount: number;
  layout: PresenterLayout;
  headCanvasPx: number;
  crf: number;
  cpuUsed: number;
}): string[] {
  const {
    suitPngPath,
    concatListPath,
    outputPath,
    fps,
    width,
    height,
    frameCount,
    layout,
    headCanvasPx,
    crf,
    cpuUsed,
  } = params;

  if (!Number.isInteger(width) || width < 2 || width % 2 !== 0) {
    throw new Error(
      `[presenter-track] width must be an even integer >= 2 (yuva420p chroma), got ${width}.`,
    );
  }
  if (!Number.isInteger(height) || height < 2 || height % 2 !== 0) {
    throw new Error(
      `[presenter-track] height must be an even integer >= 2 (yuva420p chroma), got ${height}.`,
    );
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(
      `[presenter-track] fps must be finite and > 0, got ${fps}.`,
    );
  }
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new Error(
      `[presenter-track] frameCount must be an integer >= 1, got ${frameCount}.`,
    );
  }
  if (layout.suit.widthPx < 2 || layout.suit.heightPx < 2) {
    throw new Error(
      `[presenter-track] resolved suit size ${layout.suit.widthPx}x${layout.suit.heightPx} is not renderable.`,
    );
  }
  if (!Number.isInteger(headCanvasPx) || headCanvasPx < 2) {
    throw new Error(
      `[presenter-track] headCanvasPx must be an integer >= 2, got ${headCanvasPx}.`,
    );
  }

  const suitChain =
    `[1:v]format=rgba,scale=${layout.suit.widthPx}:${layout.suit.heightPx}:flags=lanczos` +
    (layout.suit.mirrored ? ",hflip" : "") +
    "[suit]";

  const headX = Math.round(layout.head.centreXPx - headCanvasPx / 2);
  const headY = Math.round(layout.head.centreYPx - headCanvasPx / 2);

  const filterComplex = [
    "[0:v]format=rgba,colorchannelmixer=aa=0[bg]",
    suitChain,
    `[bg][suit]overlay=${layout.suit.xPx}:${layout.suit.yPx}:format=auto[body]`,
    `[2:v]fps=${fps},format=rgba[head]`,
    `[body][head]overlay=${headX}:${headY}:format=auto[v]`,
  ].join(";");

  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${width}x${height}:r=${fps}`,
    "-loop",
    "1",
    "-i",
    suitPngPath,
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatListPath,
    "-filter_complex",
    filterComplex,
    "-map",
    "[v]",
    "-frames:v",
    String(frameCount),
    "-c:v",
    "libvpx-vp9",
    "-pix_fmt",
    "yuva420p",
    "-auto-alt-ref",
    "0",
    "-b:v",
    "0",
    "-crf",
    String(crf),
    "-row-mt",
    "1",
    "-deadline",
    "good",
    "-cpu-used",
    String(cpuUsed),
    "-an",
    outputPath,
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Side-effecting
// ─────────────────────────────────────────────────────────────────────────────

function runFfmpeg(args: string[], label: string): Promise<void> {
  const ffmpegBin = process.env["FFMPEG_PATH"] ?? "ffmpeg";
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegBin, args);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("error", (e: Error) => {
      reject(
        new Error(
          `[presenter-track] failed to spawn ffmpeg ("${ffmpegBin}") for ${label}: ${e.message}`,
        ),
      );
    });
    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(
          new Error(
            `[presenter-track] ffmpeg ${label} exited ${code}: ${stderr.slice(-800)}`,
          ),
        );
        return;
      }
      resolve();
    });
  });
}

async function requireExistingFile(path: string, what: string): Promise<void> {
  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(path);
  } catch (error) {
    throw new Error(
      `[presenter-track] ${what} not found at "${path}". ` +
        `(${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (!stats.isFile()) {
    throw new Error(`[presenter-track] ${what} at "${path}" is not a file.`);
  }
  if (stats.size === 0) {
    throw new Error(`[presenter-track] ${what} at "${path}" is 0 bytes.`);
  }
}

/**
 * Resolve the head mark to a raster PNG on disk, rasterising the SVG if needed.
 *
 * Exhaustive over {@link HeadMarkSource} with a `never` check.
 */
async function resolveHeadMasterPng(params: {
  headMark: HeadMarkSource;
  masterPx: number;
  workDir: string;
}): Promise<string> {
  const { headMark, masterPx, workDir } = params;
  switch (headMark.kind) {
    case "png": {
      await requireExistingFile(headMark.path, "head mark PNG");
      return headMark.path;
    }
    case "svg": {
      await requireExistingFile(headMark.path, "head mark SVG");
      const outputPath = join(workDir, "head-master.png");
      await headMark.rasterise({
        svgPath: headMark.path,
        widthPx: masterPx,
        heightPx: masterPx,
        outputPath,
      });
      await requireExistingFile(
        outputPath,
        "rasterised head mark PNG (the injected SvgRasteriser returned without writing it)",
      );
      return outputPath;
    }
    default: {
      const exhaustive: never = headMark;
      throw new Error(
        `[presenter-track] unhandled head mark source: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

/**
 * Render the presenter overlay: a VP9 `yuva420p` WebM in which the suit is
 * static and the head mark scales per frame with the narration envelope.
 *
 * @returns The written track plus the geometry used to build it.
 * @throws Error if the pose is not calibrated, the pose PNG or head mark is
 *         missing, the envelope is empty or not normalised to 0..1, the output
 *         dimensions are odd, the resolved figure falls entirely outside the
 *         frame, any ffmpeg pass fails, or the output file is empty. Nothing
 *         here substitutes a placeholder or a default position.
 */
export async function buildPresenterTrack(
  params: PresenterTrackParams,
): Promise<PresenterTrackResult> {
  const {
    posePngPath,
    headMark,
    envelope,
    fps,
    width,
    height,
    placement,
    headScaleRange = DEFAULT_HEAD_SCALE_RANGE,
    headScaleSteps = DEFAULT_HEAD_SCALE_STEPS,
    headLiftPx = 0,
    workDir,
    outputPath,
    crf = 32,
    cpuUsed = 5,
  } = params;

  if (!Number.isFinite(headLiftPx) || headLiftPx < 0) {
    throw new Error(
      `[presenter-track] headLiftPx must be finite and >= 0, got ${headLiftPx}.`,
    );
  }

  // 1. Pose must be calibrated. This is the throw the design expects to fire
  //    until the Presenter Studio writes hitboxes.
  const pose: CalibratedPose = requireCalibratedPose(params.pose);

  // 2. Geometry.
  const layout = resolvePresenterLayout({
    pose,
    placement,
    frameWidth: width,
    frameHeight: height,
  });

  // 3. Quantise the envelope.
  const stepScales = buildHeadScaleSteps(headScaleRange, headScaleSteps);
  const stepIndexPerFrame = quantiseEnvelopeToSteps(envelope, headScaleSteps);
  const frameCount = stepIndexPerFrame.length;

  const maxScale = stepScales[stepScales.length - 1];
  if (maxScale === undefined) {
    throw new Error("[presenter-track] head scale steps resolved to nothing.");
  }
  const maxDiameterPx = layout.head.diameterPx * maxScale;
  if (maxDiameterPx < 2) {
    throw new Error(
      `[presenter-track] pose "${pose.slug}" resolves to a ${maxDiameterPx.toFixed(2)}px head at ` +
        `targetCollarPx=${placement.targetCollarPx}. Check the head radius hitbox and the placement.`,
    );
  }
  const headCanvasPx = evenCeil(maxDiameterPx + 2 * headLiftPx);
  const masterPx = evenCeil(maxDiameterPx);

  // 4. Inputs must exist before we spend time encoding.
  await requireExistingFile(posePngPath, `pose PNG for "${pose.slug}"`);
  await mkdir(workDir, { recursive: true });
  const headMasterPngPath = await resolveHeadMasterPng({
    headMark,
    masterPx,
    workDir,
  });

  // 5. One rasterisation per quantisation step.
  const stepFileNames: string[] = [];
  for (let i = 0; i < stepScales.length; i++) {
    const scale = stepScales[i];
    if (scale === undefined) {
      throw new Error(`[presenter-track] head scale step ${i} is missing.`);
    }
    const fileName = headStepFileName(i);
    const diameterPx = evenRound(layout.head.diameterPx * scale);
    const liftPx =
      headScaleSteps > 1 ? (headLiftPx * i) / (headScaleSteps - 1) : 0;
    await runFfmpeg(
      buildHeadStepArgs({
        headMasterPngPath,
        canvasPx: headCanvasPx,
        diameterPx,
        liftPx,
        outputPath: join(workDir, fileName),
      }),
      `head step ${i}`,
    );
    stepFileNames.push(fileName);
  }

  // 6. Concat list, written beside the step PNGs so the entries are basenames.
  const concatListPath = join(workDir, "head-frames.ffconcat");
  await writeFile(
    concatListPath,
    buildConcatListText({ stepFileNames, stepIndexPerFrame, fps }),
    "utf8",
  );

  // 7. Encode.
  console.log(
    JSON.stringify({
      level: "info",
      message: "Building presenter alpha track",
      pose: pose.slug,
      frame_count: frameCount,
      fps,
      size: `${width}x${height}`,
      suit: layout.suit,
      head_canvas_px: headCanvasPx,
      head_scale_range: headScaleRange,
      head_scale_steps: headScaleSteps,
      output_path: outputPath,
    }),
  );

  await runFfmpeg(
    buildPresenterTrackArgs({
      suitPngPath: posePngPath,
      concatListPath,
      outputPath,
      fps,
      width,
      height,
      frameCount,
      layout,
      headCanvasPx,
      crf,
      cpuUsed,
    }),
    "presenter track encode",
  );

  const outStats = await stat(outputPath).catch(() => null);
  if (outStats === null || !outStats.isFile() || outStats.size === 0) {
    throw new Error(
      `[presenter-track] ffmpeg reported success but "${outputPath}" is missing or empty.`,
    );
  }

  return {
    outputPath,
    frameCount,
    layout,
    stepScales,
    stepIndexPerFrame,
    headCanvasPx,
    sizeBytes: outStats.size,
  };
}
