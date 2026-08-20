import { spawn } from "node:child_process";
import {
  FilterGraph,
  fmtNumber,
  labelRef,
  type ChannelMixerMatrix,
  type Label,
} from "./filtergraph.js";

/**
 * Single-invocation FFmpeg layer compositor.
 *
 * A scene in the BUSINESS_PLAN_HUB format is a nested stack rendered back to
 * front:
 *
 * ```
 *   grade        (optional, over everything)
 *     foreground   props, desk edge, microphone
 *     presenter    suit plate + head mark (alpha)
 *     content      framed chart / paper / cards
 *     ground       mat + grid, blurred b-roll, or a rendered room
 * ```
 *
 * The entire stack becomes ONE ffmpeg process: one `-i` per layer, one
 * `filter_complex` built by {@link FilterGraph}, one encode. No intermediate
 * files, no per-layer re-encode, no browser.
 *
 * Fail-closed: every geometry and timing value is validated up front and a
 * violation throws {@link CompositeLayersError}. Nothing is defaulted past
 * missing data — a layer with no path, an opacity of 0, an odd output width or
 * an `enableTo` before its `enableFrom` is a planner bug and is reported as one.
 */

// ─── Errors ──────────────────────────────────────────────────────────────────

/** Thrown when a layer stack cannot be composited exactly as specified. */
export class CompositeLayersError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompositeLayersError";
  }
}

// ─── Layer model ─────────────────────────────────────────────────────────────

/**
 * A colour treatment. Usable in two places, and the difference matters:
 *
 *  - `CompositeLayersParams.grade` runs ONCE over the finished stack, so it
 *    also touches the type, the presenter and the watermark;
 *  - `LayerTransform.grade` runs on ONE layer before it is composited, which is
 *    what you want when only the source material needs correcting (a near-white
 *    stock photo dropped into a dark-navy format) and the typography over it
 *    must be left exactly as the plate author drew it.
 */
export interface GradeSpec {
  eq?: {
    contrast?: number;
    brightness?: number;
    saturation?: number;
    gamma?: number;
  };
  /** Channel matrix, e.g. a cool push: `{ rr: 0.95, bb: 1.06 }`. */
  channelMixer?: ChannelMixerMatrix;
  /** Gaussian blur sigma applied after the grade. */
  blur?: number;
}

/** Geometry, opacity and timing shared by every layer kind. */
export interface LayerTransform {
  /** Left edge in output pixels, or an FFmpeg overlay expression (`"(W-w)/2"`). Ignored on layer 0. */
  x: number | string;
  /** Top edge in output pixels, or an FFmpeg overlay expression (`"H-h-40"`). Ignored on layer 0. */
  y: number | string;
  /** Uniform scale factor applied to the source dimensions (`scale=iw*f:ih*f`). Not allowed on layer 0. */
  scale?: number;
  /** Clockwise rotation in degrees. Corners become transparent. Not allowed on layer 0. */
  rotate?: number;
  /** 0 < opacity <= 1. Applied with `colorchannelmixer=aa`. Not allowed on layer 0. */
  opacity?: number;
  /** Gaussian blur sigma. `0` is allowed and emits no filter. */
  blur?: number;
  /**
   * Colour treatment applied to THIS layer's own pixels, before `blur` and
   * before it is composited. Allowed on the ground.
   */
  grade?: GradeSpec;
  /** Seconds from the start of the scene at which the layer becomes visible. Not allowed on layer 0. */
  enableFrom?: number;
  /** Seconds at which the layer stops being visible. Not allowed on layer 0. */
  enableTo?: number;
}

/**
 * One entry in the stack, ordered back to front. Index 0 is the ground: it
 * defines the canvas, so it is scaled/cropped to fill the output frame and may
 * not carry position, scale, rotation, opacity or timing.
 */
export type CompositeLayer =
  | ({ kind: "video"; path: string } & LayerTransform)
  | ({ kind: "image"; path: string } & LayerTransform)
  /** A VP9/ProRes clip with a real alpha channel — composited with `overlay=format=auto`. */
  | ({ kind: "alpha-video"; path: string } & LayerTransform)
  /** A generated flat colour plate (`lavfi color`), sized to the output frame. */
  | ({ kind: "color"; color: string } & LayerTransform);

export interface CompositeLayersParams {
  /** Back-to-front stack. Must contain at least one layer. */
  layers: readonly CompositeLayer[];
  width: number;
  height: number;
  fps: number;
  /** Exact output length. Emitted as `-frames:v`, so the result is frame-deterministic. */
  durationFrames: number;
  outputPath: string;
  /** Optional grade over the whole stack. */
  grade?: GradeSpec;
  /**
   * Index of the layer that supplies the output audio track, mapped as
   * `-map <i>:a?`. Defaults to layer 0 when layer 0 is a `video` layer (the
   * audio-bearing base case), otherwise the output is silent.
   * Must reference a `video` layer.
   */
  audioFromLayerIndex?: number;
  /** Defaults to `libx264`. */
  videoCodec?: string;
  /** Defaults to `18`. */
  crf?: number;
  /** Defaults to `medium`. */
  preset?: string;
  /** Defaults to `yuv420p`. */
  pixelFormat?: string;
}

/** What {@link buildCompositeLayersArgs} produced — the argv plus the graph it embeds. */
export interface CompositeLayersPlan {
  /** Full ffmpeg argv, excluding the binary itself. */
  args: string[];
  /** The `filter_complex` string, for logging and assertions. */
  filterComplex: string;
  outputPath: string;
  /** `-map <i>:a?` source layer index, or null when the output is silent. */
  audioFromLayerIndex: number | null;
}

// ─── Validation ──────────────────────────────────────────────────────────────

function assertPositiveInt(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new CompositeLayersError(
      `[composite-layers] ${what} must be an integer >= 1, received ${String(value)}.`,
    );
  }
}

function layerPath(layer: CompositeLayer): string | null {
  switch (layer.kind) {
    case "video":
    case "image":
    case "alpha-video":
      return layer.path;
    case "color":
      return null;
    default: {
      const never: never = layer;
      throw new CompositeLayersError(
        `[composite-layers] unhandled layer kind: ${JSON.stringify(never)}`,
      );
    }
  }
}

function validate(params: CompositeLayersParams): void {
  const { layers, width, height, fps, durationFrames, outputPath } = params;

  if (layers.length === 0) {
    throw new CompositeLayersError(
      `[composite-layers] the layer stack is empty. A scene must have at least a ground layer; ` +
        `refusing to render an implicit black frame.`,
    );
  }
  assertPositiveInt(width, "width");
  assertPositiveInt(height, "height");
  if (width % 2 !== 0 || height % 2 !== 0) {
    throw new CompositeLayersError(
      `[composite-layers] output size ${width}x${height} has an odd dimension. yuv420p ` +
        `requires even width and height and the encode would fail at the very end of the render.`,
    );
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new CompositeLayersError(
      `[composite-layers] fps must be a positive finite number, received ${String(fps)}.`,
    );
  }
  assertPositiveInt(durationFrames, "durationFrames");
  if (outputPath.trim() === "") {
    throw new CompositeLayersError(`[composite-layers] outputPath is empty.`);
  }

  const durationSeconds = durationFrames / fps;

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    const where = `layer ${i} (${layer.kind})`;

    const path = layerPath(layer);
    if (path !== null && path.trim() === "") {
      throw new CompositeLayersError(
        `[composite-layers] ${where} has an empty path. The asset was never resolved upstream — ` +
          `fix the scene plan rather than substituting a placeholder.`,
      );
    }
    if (layer.kind === "color" && layer.color.trim() === "") {
      throw new CompositeLayersError(
        `[composite-layers] ${where} has an empty color.`,
      );
    }

    if (
      layer.scale !== undefined &&
      !(Number.isFinite(layer.scale) && layer.scale > 0)
    ) {
      throw new CompositeLayersError(
        `[composite-layers] ${where} scale must be a finite number > 0, received ${String(layer.scale)}.`,
      );
    }
    if (layer.rotate !== undefined && !Number.isFinite(layer.rotate)) {
      throw new CompositeLayersError(
        `[composite-layers] ${where} rotate must be a finite number of degrees, received ${String(layer.rotate)}.`,
      );
    }
    if (
      layer.opacity !== undefined &&
      !(layer.opacity > 0 && layer.opacity <= 1)
    ) {
      throw new CompositeLayersError(
        `[composite-layers] ${where} opacity must be in (0, 1], received ${String(layer.opacity)}. ` +
          `An opacity of 0 means the layer should not be in the stack at all.`,
      );
    }
    if (
      layer.blur !== undefined &&
      !(Number.isFinite(layer.blur) && layer.blur >= 0)
    ) {
      throw new CompositeLayersError(
        `[composite-layers] ${where} blur must be a finite number >= 0, received ${String(layer.blur)}.`,
      );
    }
    if (
      layer.grade?.blur !== undefined &&
      !(Number.isFinite(layer.grade.blur) && layer.grade.blur >= 0)
    ) {
      throw new CompositeLayersError(
        `[composite-layers] ${where} grade.blur must be a finite number >= 0, received ${String(layer.grade.blur)}.`,
      );
    }

    if (
      layer.enableFrom !== undefined &&
      !(Number.isFinite(layer.enableFrom) && layer.enableFrom >= 0)
    ) {
      throw new CompositeLayersError(
        `[composite-layers] ${where} enableFrom must be a finite number >= 0, received ${String(layer.enableFrom)}.`,
      );
    }
    if (layer.enableTo !== undefined && !Number.isFinite(layer.enableTo)) {
      throw new CompositeLayersError(
        `[composite-layers] ${where} enableTo must be a finite number, received ${String(layer.enableTo)}.`,
      );
    }
    if (
      layer.enableFrom !== undefined &&
      layer.enableTo !== undefined &&
      layer.enableTo <= layer.enableFrom
    ) {
      throw new CompositeLayersError(
        `[composite-layers] ${where} has enableTo (${layer.enableTo}s) <= enableFrom ` +
          `(${layer.enableFrom}s); the layer would never be visible.`,
      );
    }
    if (layer.enableFrom !== undefined && layer.enableFrom >= durationSeconds) {
      throw new CompositeLayersError(
        `[composite-layers] ${where} enableFrom (${layer.enableFrom}s) is at or past the scene ` +
          `duration (${durationSeconds.toFixed(3)}s = ${durationFrames} frames @ ${fps}fps); ` +
          `the layer would never be visible.`,
      );
    }

    if (i === 0) {
      // The ground defines the canvas. Anything that moves, resizes, fades or
      // times it is a planner mistake, not something to silently ignore.
      const forbidden: string[] = [];
      if (layer.scale !== undefined) forbidden.push("scale");
      if (layer.rotate !== undefined) forbidden.push("rotate");
      if (layer.opacity !== undefined) forbidden.push("opacity");
      if (layer.enableFrom !== undefined) forbidden.push("enableFrom");
      if (layer.enableTo !== undefined) forbidden.push("enableTo");
      if (forbidden.length > 0) {
        throw new CompositeLayersError(
          `[composite-layers] layer 0 is the ground: it is scaled to fill ${width}x${height} and ` +
            `is visible for the whole scene, so it may not set ${forbidden.join(", ")}. ` +
            `Put that content in a layer above the ground instead.`,
        );
      }
    }
  }

  const audioIdx = params.audioFromLayerIndex;
  if (audioIdx !== undefined) {
    if (
      !Number.isInteger(audioIdx) ||
      audioIdx < 0 ||
      audioIdx >= layers.length
    ) {
      throw new CompositeLayersError(
        `[composite-layers] audioFromLayerIndex ${String(audioIdx)} is out of range ` +
          `(stack has ${layers.length} layers).`,
      );
    }
    if (layers[audioIdx]!.kind !== "video") {
      throw new CompositeLayersError(
        `[composite-layers] audioFromLayerIndex ${audioIdx} points at a "${layers[audioIdx]!.kind}" ` +
          `layer, which can never carry an audio track. Only a "video" layer can supply audio.`,
      );
    }
  }

  if (
    params.crf !== undefined &&
    (!Number.isInteger(params.crf) || params.crf < 0 || params.crf > 63)
  ) {
    throw new CompositeLayersError(
      `[composite-layers] crf must be an integer in [0, 63], received ${String(params.crf)}.`,
    );
  }
  if (
    params.grade?.blur !== undefined &&
    !(Number.isFinite(params.grade.blur) && params.grade.blur >= 0)
  ) {
    throw new CompositeLayersError(
      `[composite-layers] grade.blur must be a finite number >= 0, received ${String(params.grade.blur)}.`,
    );
  }
}

// ─── Input args ──────────────────────────────────────────────────────────────

/**
 * One `-i` group per layer, in stack order, so the layer index IS the ffmpeg
 * input index. Still images and generated colour plates get an explicit `-t` so
 * they do not loop forever; real clips play out and `eof_action=pass` keeps the
 * base going once they end.
 */
function buildInputArgs(
  params: CompositeLayersParams,
  durationSeconds: string,
): string[] {
  const { layers, width, height, fps } = params;
  const rate = fmtNumber(fps, "fps");
  const args: string[] = [];
  for (const layer of layers) {
    switch (layer.kind) {
      case "image":
        args.push(
          "-loop",
          "1",
          "-framerate",
          rate,
          "-t",
          durationSeconds,
          "-i",
          layer.path,
        );
        break;
      case "color":
        args.push(
          "-f",
          "lavfi",
          "-t",
          durationSeconds,
          "-i",
          `color=c=${layer.color}:s=${width}x${height}:r=${rate}`,
        );
        break;
      case "video":
      case "alpha-video":
        args.push("-i", layer.path);
        break;
      default: {
        const never: never = layer;
        throw new CompositeLayersError(
          `[composite-layers] unhandled layer kind: ${JSON.stringify(never)}`,
        );
      }
    }
  }
  return args;
}

// ─── Filtergraph ─────────────────────────────────────────────────────────────

function enableExpr(layer: CompositeLayer): string | undefined {
  const from = layer.enableFrom;
  const to = layer.enableTo;
  if (from !== undefined && to !== undefined) {
    return `between(t,${fmtNumber(from, "enableFrom")},${fmtNumber(to, "enableTo")})`;
  }
  if (from !== undefined) return `gte(t,${fmtNumber(from, "enableFrom")})`;
  if (to !== undefined) return `lte(t,${fmtNumber(to, "enableTo")})`;
  return undefined;
}

/**
 * Ground: cover-fit to the canvas, then its own grade, then any blur (the
 * `broll-defocus` layout).
 *
 * Grade BEFORE blur on purpose: grading defocused pixels amplifies whatever the
 * blur already smeared, and a stock plate that is being pulled into the format's
 * palette should be corrected while its detail is still intact.
 */
function buildGround(
  graph: FilterGraph,
  layer: CompositeLayer,
  width: number,
  height: number,
): Label {
  const source = graph.source(0, "video");
  // A lavfi colour plate is already generated at exactly WxH; everything else
  // must be forced to cover the canvas.
  let current =
    layer.kind === "color"
      ? graph.setsar(source, 1)
      : graph.scaleCropToFill(source, { width, height });
  if (layer.grade !== undefined) {
    current = applyGrade(graph, current, layer.grade);
  }
  if (layer.blur !== undefined && layer.blur > 0) {
    current = graph.gblur(current, { sigma: layer.blur });
  }
  return current;
}

/** Overlay layer: scale → rotate → grade → blur → opacity, keeping alpha wherever it matters. */
function buildOverlayLayer(
  graph: FilterGraph,
  layer: CompositeLayer,
  index: number,
): Label {
  let current = graph.source(index, "video");

  if (layer.scale !== undefined && layer.scale !== 1) {
    current = graph.scaleBy(current, layer.scale);
  }

  const needsAlpha =
    (layer.rotate !== undefined && layer.rotate !== 0) ||
    (layer.opacity !== undefined && layer.opacity < 1);
  if (needsAlpha) {
    // rotate with a transparent fill and colorchannelmixer=aa both need a real
    // alpha channel. alpha-video already has one; force it for everything else.
    current = graph.format(current, "rgba");
  }

  if (layer.rotate !== undefined && layer.rotate !== 0) {
    current = graph.rotate(current, {
      angleDeg: layer.rotate,
      fillColor: "none",
      expandToFit: true,
    });
  }
  if (layer.grade !== undefined) {
    current = applyGrade(graph, current, layer.grade);
  }
  if (layer.blur !== undefined && layer.blur > 0) {
    current = graph.gblur(current, { sigma: layer.blur });
  }
  if (layer.opacity !== undefined && layer.opacity < 1) {
    current = graph.colorchannelmixer(current, { aa: layer.opacity });
  }
  return current;
}

function applyGrade(graph: FilterGraph, input: Label, grade: GradeSpec): Label {
  let current = input;
  if (grade.eq) {
    const eq = grade.eq;
    const hasAny =
      eq.contrast !== undefined ||
      eq.brightness !== undefined ||
      eq.saturation !== undefined ||
      eq.gamma !== undefined;
    if (hasAny) {
      current = graph.eq(current, {
        ...(eq.contrast !== undefined ? { contrast: eq.contrast } : {}),
        ...(eq.brightness !== undefined ? { brightness: eq.brightness } : {}),
        ...(eq.saturation !== undefined ? { saturation: eq.saturation } : {}),
        ...(eq.gamma !== undefined ? { gamma: eq.gamma } : {}),
      });
    }
  }
  if (grade.channelMixer && Object.keys(grade.channelMixer).length > 0) {
    current = graph.colorchannelmixer(current, grade.channelMixer);
  }
  if (grade.blur !== undefined && grade.blur > 0) {
    current = graph.gblur(current, { sigma: grade.blur });
  }
  return current;
}

// ─── Public: pure builder ────────────────────────────────────────────────────

/**
 * Build the ffmpeg argv for a layer stack without running anything.
 *
 * This is the whole compositor: everything {@link compositeLayers} does other
 * than spawning the process. Kept separate so the argv and the generated
 * filtergraph are unit-testable with no ffmpeg on the box.
 *
 * @throws {CompositeLayersError} on any invalid geometry, timing or stack shape.
 * @throws {FilterGraphError} if the generated graph is malformed (a builder bug —
 * these should be unreachable from valid params).
 */
export function buildCompositeLayersArgs(
  params: CompositeLayersParams,
): CompositeLayersPlan {
  validate(params);

  const {
    layers,
    width,
    height,
    fps,
    durationFrames,
    outputPath,
    grade,
    videoCodec = "libx264",
    crf = 18,
    preset = "medium",
    pixelFormat = "yuv420p",
  } = params;

  const durationSeconds = fmtNumber(durationFrames / fps, "duration seconds");
  const inputArgs = buildInputArgs(params, durationSeconds);

  const graph = new FilterGraph();
  let stack = buildGround(graph, layers[0]!, width, height);

  for (let i = 1; i < layers.length; i++) {
    const layer = layers[i]!;
    const plate = buildOverlayLayer(graph, layer, i);
    const enable = enableExpr(layer);
    stack = graph.overlay(stack, plate, {
      x: layer.x,
      y: layer.y,
      // format=auto preserves the overlay's alpha; without it FFmpeg may pick a
      // format that drops it and the presenter plate composites as a black box.
      format: "auto",
      // The stack length is owned by the ground; a short overlay must not end it.
      eofAction: "pass",
      shortest: false,
      ...(enable !== undefined ? { enable } : {}),
    });
  }

  if (grade) {
    stack = applyGrade(graph, stack, grade);
  }

  const formatted = graph.format(stack, pixelFormat);
  const outLabel = graph.output(formatted, "vout");
  const filterComplex = graph.build();

  const audioFromLayerIndex =
    params.audioFromLayerIndex !== undefined
      ? params.audioFromLayerIndex
      : layers[0]!.kind === "video"
        ? 0
        : null;

  const args: string[] = [
    ...inputArgs,
    "-filter_complex",
    filterComplex,
    "-map",
    labelRef(outLabel),
  ];

  if (audioFromLayerIndex !== null) {
    // `?` keeps the render alive when the base clip genuinely has no audio
    // track — that is a legitimate shape, unlike a missing asset.
    args.push("-map", `${audioFromLayerIndex}:a?`, "-c:a", "copy");
  } else {
    args.push("-an");
  }

  args.push(
    // -frames:v pins the video to an exact frame count; -t caps every stream
    // (a copied audio track is not bounded by -frames:v) to the same length.
    "-frames:v",
    String(durationFrames),
    "-t",
    durationSeconds,
    "-r",
    fmtNumber(fps, "fps"),
    "-c:v",
    videoCodec,
    "-pix_fmt",
    pixelFormat,
    "-crf",
    String(crf),
    "-preset",
    preset,
    "-movflags",
    "+faststart",
    "-y",
    outputPath,
  );

  return { args, filterComplex, outputPath, audioFromLayerIndex };
}

// ─── Public: runner ──────────────────────────────────────────────────────────

function runFfmpeg(args: string[]): Promise<void> {
  const ffmpegBin = process.env["FFMPEG_PATH"] ?? "ffmpeg";
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin, args);
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err: Error) => {
      reject(
        new CompositeLayersError(
          `[composite-layers] failed to spawn ffmpeg ("${ffmpegBin}"): ${err.message}`,
        ),
      );
    });
    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(
          new CompositeLayersError(
            `[composite-layers] ffmpeg exited ${String(code)}: ${stderr.slice(-2000)}`,
          ),
        );
        return;
      }
      resolve();
    });
  });
}

/**
 * Composite a back-to-front layer stack into `outputPath` with a single ffmpeg
 * invocation, and return the argv that was executed.
 *
 * The returned plan is the same object {@link buildCompositeLayersArgs}
 * produces, so callers can log the exact command that ran.
 *
 * @throws {CompositeLayersError} on invalid params, a spawn failure, or a
 * non-zero ffmpeg exit (the last 2000 chars of stderr are included).
 */
export async function compositeLayers(
  params: CompositeLayersParams,
): Promise<CompositeLayersPlan> {
  const plan = buildCompositeLayersArgs(params);
  console.log(
    `[composite-layers] ${params.layers.length} layers → ${params.width}x${params.height} ` +
      `@ ${params.fps}fps, ${params.durationFrames} frames → ${plan.outputPath}`,
  );
  await runFfmpeg(plan.args);
  return plan;
}
